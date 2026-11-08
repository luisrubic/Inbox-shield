'use strict';
// Parla con i server di posta (IMAP/SMTP). Le librerie si caricano solo quando servono:
// così il resto del backend si testa senza rete. Questo file NON è stato provato con caselle vere.
// `password` è una stringa (password per le app) oppure { accessToken } (OAuth2, XOAUTH2).
function credenziali(utente, password) {
  return typeof password === 'string' ? { user: utente, pass: password } : { user: utente, accessToken: password.accessToken };
}
function imap(cfg, utente, password) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({ host: cfg.imap.host, port: cfg.imap.port, secure: cfg.imap.secure, auth: credenziali(utente, password), logger: false });
}
async function conImap(cfg, utente, password, fn) {
  const c = imap(cfg, utente, password);
  c.on('error', () => {});
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => {}); }
}
const indirizzi = (l) => (l || []).map((x) => x.address).filter(Boolean).join(', ');

async function verifica(cfg, utente, password) {
  await conImap(cfg, utente, password, async () => true);
  return true;
}

async function elenca(cfg, utente, password, { cartella = 'INBOX', limite = 20, soloNonLette = false } = {}) {
  return conImap(cfg, utente, password, async (c) => {
    const lock = await c.getMailboxLock(cartella);
    try {
      const totale = c.mailbox.exists;
      if (!totale) return [];
      const da = Math.max(1, totale - Math.min(limite, 50) + 1);
      const out = [];
      for await (const m of c.fetch(`${da}:*`, { uid: true, envelope: true, flags: true })) {
        const letto = m.flags.has('\\Seen');
        if (soloNonLette && letto) continue;
        out.push({ uid: m.uid, da: indirizzi(m.envelope.from), a: indirizzi(m.envelope.to), oggetto: m.envelope.subject || '(senza oggetto)', data: m.envelope.date, letto });
      }
      return out.reverse();
    } finally { lock.release(); }
  });
}

async function leggi(cfg, utente, password, uid, cartella = 'INBOX') {
  const { simpleParser } = require('mailparser');
  return conImap(cfg, utente, password, async (c) => {
    const lock = await c.getMailboxLock(cartella);
    try {
      const m = await c.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
      if (!m) throw new Error('Mail non trovata');
      const p = await simpleParser(m.source);
      await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      return { uid, da: p.from?.text || '', a: p.to?.text || '', oggetto: p.subject || '(senza oggetto)', data: p.date, messageId: p.messageId || '', riferimenti: p.references || [], testo: (p.text || '').slice(0, 20000) };
    } finally { lock.release(); }
  });
}

async function invia(cfg, utente, password, { a, oggetto, testo, inRispostaA, riferimenti }) {
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: typeof password === 'string' ? { user: utente, pass: password } : { type: 'OAuth2', user: utente, accessToken: password.accessToken } });
  const info = await t.sendMail({ from: utente, to: a, subject: oggetto, text: testo, inReplyTo: inRispostaA || undefined, references: riferimenti || undefined });
  return { id: info.messageId };
}

async function azione(cfg, utente, password, uid, tipo, cartellaDest) {
  return conImap(cfg, utente, password, async (c) => {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const o = { uid: true };
      if (tipo === 'segna_letto') await c.messageFlagsAdd(String(uid), ['\\Seen'], o);
      else if (tipo === 'importante') await c.messageFlagsAdd(String(uid), ['\\Flagged'], o);
      else if (tipo === 'sposta') await c.messageMove(String(uid), cartellaDest, o);
      else if (tipo === 'cestina') await c.messageMove(String(uid), '[Gmail]/Trash', o).catch(() => c.messageMove(String(uid), 'Trash', o));
      else throw new Error('Azione sconosciuta');
    } finally { lock.release(); }
  });
}

module.exports = { verifica, elenca, leggi, invia, azione };
