'use strict';
const crypto = require('node:crypto');
const auth = require('./crypto');
const { configura, dominio } = require('./autoconfig');
const rules = require('./rules');

class Errore extends Error { constructor(stato, msg) { super(msg); this.stato = stato; } }
const RE_EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

// Crea il gestore delle richieste. `mail` è l'adattatore IMAP/SMTP (iniettabile nei test).
function creaApp({ db, segreto, mail, oauth, adesso = () => Date.now() }) {
  const tentativi = new Map(); // anti forza bruta sul login

  function limite(chiave) {
    const t = tentativi.get(chiave);
    if (t && t.n >= 5 && adesso() - t.ultimo < 15 * 60 * 1000) throw new Errore(429, 'Troppi tentativi: riprova tra qualche minuto');
  }
  const sbagliato = (k) => { const t = tentativi.get(k) || { n: 0 }; tentativi.set(k, { n: t.n + 1, ultimo: adesso() }); };

  const utenteDa = (req) => {
    const h = req.headers.authorization || '';
    const uid = auth.leggiToken(h.replace(/^Bearer /, ''), segreto, adesso());
    if (!uid) throw new Errore(401, 'Accesso scaduto: rifai il login');
    return uid;
  };
  function casella(uid, id) {
    const c = db.prepare('SELECT * FROM caselle WHERE id = ? AND utente = ?').get(Number(id), uid);
    if (!c) throw new Errore(404, 'Casella non trovata');
    return { ...c, cfg: JSON.parse(c.config), password: auth.decifra(c.segreto, segreto) };
  }
  // password per le app oppure access token OAuth appena rinnovato
  async function cred(c) {
    if (c.tipo !== 'oauth') return c.password;
    return { accessToken: await oauth.accessToken(c.cfg.oauthProvider, c.id, c.password) };
  }
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pagina = (titolo, testo) => ({ __html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:32px;text-align:center"><h2>${esc(titolo)}</h2><p>${esc(testo)}</p></body>` });
  const pubblica = (c) => ({ id: c.id, indirizzo: c.indirizzo, provider: c.provider });

  async function gestisci(req) {
    const { metodo, percorso, query = {}, corpo = {} } = req;
    const p = percorso.split('/').filter(Boolean);

    if (metodo === 'GET' && percorso === '/stato') return { ok: true };

    if (metodo === 'POST' && percorso === '/auth/registra') {
      const email = String(corpo.email || '').trim().toLowerCase();
      const password = String(corpo.password || '');
      if (!RE_EMAIL.test(email)) throw new Errore(400, 'Email non valida');
      if (password.length < 10) throw new Errore(400, 'La password deve avere almeno 10 caratteri');
      if (db.prepare('SELECT 1 FROM utenti WHERE email = ?').get(email)) throw new Errore(409, 'Email già registrata');
      const r = db.prepare('INSERT INTO utenti (email, password, creato) VALUES (?, ?, ?)').run(email, auth.hashPassword(password), adesso());
      return { token: auth.creaToken(Number(r.lastInsertRowid), segreto, undefined, adesso()) };
    }
    if (metodo === 'POST' && percorso === '/auth/login') {
      const email = String(corpo.email || '').trim().toLowerCase();
      const k = `${req.ip || ''}|${email}`;
      limite(k);
      const u = db.prepare('SELECT * FROM utenti WHERE email = ?').get(email);
      // verifica comunque un hash finto se l'utente non esiste, per non rivelare quali email sono registrate
      const ok = u ? auth.verificaPassword(String(corpo.password || ''), u.password) : (auth.verificaPassword('x', auth.hashPassword('y')), false);
      if (!ok) { sbagliato(k); throw new Errore(401, 'Email o password sbagliate'); }
      tentativi.delete(k);
      return { token: auth.creaToken(u.id, segreto, undefined, adesso()) };
    }

    // ritorno da Google/Microsoft: l'utente è nel browser, senza il nostro token; lo identifica `stato`
    if (metodo === 'GET' && percorso === '/oauth/callback') {
      if (!oauth) return pagina('OAuth non configurato', 'Il server non ha le chiavi OAuth.');
      const riga = db.prepare('SELECT * FROM oauth_stati WHERE stato = ?').get(String(query.state || ''));
      if (riga) db.prepare('DELETE FROM oauth_stati WHERE stato = ?').run(riga.stato); // monouso
      if (!riga || riga.scade < adesso()) return pagina('Collegamento scaduto', 'Torna nell\'app e riprova.');
      if (query.error || !query.code) return pagina('Collegamento annullato', String(query.error_description || query.error || 'Nessun codice ricevuto'));
      try {
        const r = await oauth.scambia(riga.provider, query.code, riga.verifier);
        const cfg = JSON.stringify({ ...r.cfg, oauthProvider: riga.provider });
        const cifrato = auth.cifra(r.refresh, segreto);
        const esiste = db.prepare('SELECT id FROM caselle WHERE utente = ? AND indirizzo = ?').get(riga.utente, r.email);
        if (esiste) db.prepare("UPDATE caselle SET segreto = ?, config = ?, tipo = 'oauth', provider = ? WHERE id = ?").run(cifrato, cfg, r.provider, esiste.id);
        else db.prepare("INSERT INTO caselle (utente, indirizzo, provider, config, segreto, tipo) VALUES (?, ?, ?, ?, ?, 'oauth')").run(riga.utente, r.email, r.provider, cfg, cifrato);
        return pagina('Casella collegata', `${r.email} è collegata. Puoi tornare nell'app.`);
      } catch (e) { return pagina('Collegamento non riuscito', e.message); }
    }

    // da qui serve il login
    const uid = utenteDa(req);

    if (metodo === 'GET' && percorso === '/caselle/oauth/provider') {
      return { provider: oauth ? oauth.disponibili() : [] };
    }
    if (metodo === 'POST' && percorso === '/caselle/oauth/avvia') {
      if (!oauth) throw new Errore(400, 'OAuth non configurato sul server');
      let a;
      try { a = oauth.avvia(String(corpo.provider || '')); } catch (e) { throw new Errore(400, e.message); }
      db.prepare('DELETE FROM oauth_stati WHERE scade < ?').run(adesso());
      db.prepare('INSERT INTO oauth_stati (stato, utente, provider, verifier, scade) VALUES (?, ?, ?, ?, ?)').run(a.stato, uid, corpo.provider, a.verifier, a.scade);
      return { url: a.url };
    }
    if (metodo === 'GET' && percorso === '/caselle/autoconfig') {
      if (!dominio(query.email)) throw new Errore(400, 'Email non valida');
      return configura(query.email);
    }
    if (metodo === 'GET' && percorso === '/caselle') {
      return { caselle: db.prepare('SELECT id, indirizzo, provider FROM caselle WHERE utente = ?').all(uid) };
    }
    if (metodo === 'POST' && percorso === '/caselle') {
      const indirizzo = String(corpo.indirizzo || '').trim().toLowerCase();
      if (!RE_EMAIL.test(indirizzo)) throw new Errore(400, 'Indirizzo non valido');
      if (!corpo.password) throw new Errore(400, 'Serve la password (per Gmail: password per le app)');
      const cfg = configura(indirizzo);
      if (cfg.oauth) throw new Errore(400, 'Questo provider richiede l\'accesso con OAuth: usa "Accedi con Microsoft".');
      // impostazioni manuali, solo se l'utente le dà (host, porte)
      if (corpo.imap?.host) cfg.imap = { host: String(corpo.imap.host), port: Number(corpo.imap.port) || 993, secure: (Number(corpo.imap.port) || 993) === 993 };
      if (corpo.smtp?.host) cfg.smtp = { host: String(corpo.smtp.host), port: Number(corpo.smtp.port) || 465, secure: (Number(corpo.smtp.port) || 465) === 465 };
      try { await mail.verifica(cfg, indirizzo, corpo.password); }
      catch (e) { throw new Errore(400, `Collegamento non riuscito (${e.message}). ${cfg.nota}`.trim()); }
      try {
        const r = db.prepare('INSERT INTO caselle (utente, indirizzo, provider, config, segreto) VALUES (?, ?, ?, ?, ?)')
          .run(uid, indirizzo, cfg.provider, JSON.stringify(cfg), auth.cifra(corpo.password, segreto));
        return { id: Number(r.lastInsertRowid), indirizzo, provider: cfg.provider };
      } catch { throw new Errore(409, 'Casella già collegata'); }
    }
    if (p[0] === 'caselle' && p[1]) {
      const c = casella(uid, p[1]);
      if (metodo === 'DELETE' && p.length === 2) {
        db.prepare('DELETE FROM caselle WHERE id = ?').run(c.id);
        return { ok: true };
      }
      if (metodo === 'GET' && p[2] === 'mail' && !p[3]) {
        const mails = await mail.elenca(c.cfg, c.indirizzo, await cred(c), { limite: Math.min(Number(query.limite) || 20, 50), soloNonLette: query.nonLette === '1' });
        return { mail: mails };
      }
      if (metodo === 'GET' && p[2] === 'mail' && p[3]) {
        return await mail.leggi(c.cfg, c.indirizzo, await cred(c), Number(p[3]));
      }
      if (metodo === 'POST' && p[2] === 'invia') {
        const a = String(corpo.a || '').trim();
        if (!RE_EMAIL.test(a)) throw new Errore(400, 'Destinatario non valido');
        if (!String(corpo.testo || '').trim()) throw new Errore(400, 'Testo vuoto');
        return await mail.invia(c.cfg, c.indirizzo, await cred(c), { a, oggetto: String(corpo.oggetto || '(senza oggetto)').slice(0, 200), testo: String(corpo.testo) });
      }
      if (metodo === 'POST' && p[2] === 'rispondi' && p[3]) {
        if (!String(corpo.testo || '').trim()) throw new Errore(400, 'Testo vuoto');
        const m = await mail.leggi(c.cfg, c.indirizzo, await cred(c), Number(p[3]));
        const mittente = (/<([^>]+)>/.exec(m.da) || [null, m.da])[1].trim();
        const oggetto = /^re:/i.test(m.oggetto) ? m.oggetto : `Re: ${m.oggetto}`;
        const rif = [...[].concat(m.riferimenti || []), m.messageId].filter(Boolean);
        return await mail.invia(c.cfg, c.indirizzo, await cred(c), { a: mittente, oggetto, testo: String(corpo.testo), inRispostaA: m.messageId, riferimenti: rif });
      }
      if (metodo === 'POST' && p[2] === 'regole' && p[3] === 'applica') {
        const elenco = db.prepare('SELECT * FROM regole WHERE utente = ? AND attiva = 1').all(uid);
        const nuove = await mail.elenca(c.cfg, c.indirizzo, await cred(c), { limite: 50, soloNonLette: true });
        const fatte = [];
        for (const m of nuove) {
          for (const az of rules.applica(elenco, { da: m.da, a: m.a, oggetto: m.oggetto, testo: '' })) {
            await mail.azione(c.cfg, c.indirizzo, await cred(c), m.uid, az.azione, az.cartella);
            fatte.push({ uid: m.uid, oggetto: m.oggetto, ...az });
          }
        }
        return { fatte };
      }
    }
    if (metodo === 'GET' && percorso === '/regole') {
      return { regole: db.prepare('SELECT id, nome, campo, operatore, valore, azione, cartella, attiva FROM regole WHERE utente = ?').all(uid) };
    }
    if (metodo === 'POST' && percorso === '/regole') {
      let r;
      try { r = rules.validaRegola(corpo); } catch (e) { throw new Errore(400, e.message); }
      const x = db.prepare('INSERT INTO regole (utente, nome, campo, operatore, valore, azione, cartella) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid, r.nome, r.campo, r.operatore, r.valore, r.azione, r.cartella);
      return { id: Number(x.lastInsertRowid), ...r, attiva: 1 };
    }
    if (p[0] === 'regole' && p[1] && metodo === 'DELETE') {
      db.prepare('DELETE FROM regole WHERE id = ? AND utente = ?').run(Number(p[1]), uid);
      return { ok: true };
    }
    if (p[0] === 'regole' && p[1] && metodo === 'PATCH') {
      db.prepare('UPDATE regole SET attiva = ? WHERE id = ? AND utente = ?').run(corpo.attiva ? 1 : 0, Number(p[1]), uid);
      return { ok: true };
    }
    throw new Errore(404, 'Percorso inesistente');
  }

  // adattatore per il modulo http di Node
  async function http(req, res) {
    const invia = (stato, dati) => {
      const b = JSON.stringify(dati);
      res.writeHead(stato, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(b);
    };
    try {
      const url = new URL(req.url, 'http://x');
      let testo = '';
      let size = 0;
      for await (const pezzo of req) {
        size += pezzo.length;
        if (size > 1_000_000) throw new Errore(413, 'Richiesta troppo grande');
        testo += pezzo;
      }
      let corpo = {};
      if (testo) { try { corpo = JSON.parse(testo); } catch { throw new Errore(400, 'JSON non valido'); } }
      const esito = await gestisci({ metodo: req.method, percorso: url.pathname, query: Object.fromEntries(url.searchParams), corpo, headers: req.headers, ip: req.socket.remoteAddress });
      if (esito && esito.__html) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(esito.__html);
      }
      invia(200, esito);
    } catch (e) {
      if (e instanceof Errore) return invia(e.stato, { errore: e.message });
      console.error(e);
      invia(500, { errore: 'Errore interno' });
    }
  }
  return { gestisci, http, Errore };
}
module.exports = { creaApp };
