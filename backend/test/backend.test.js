'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { configura } = require('../src/autoconfig');
const rules = require('../src/rules');
const c = require('../src/crypto');
const { apri } = require('../src/db');
const { creaApp } = require('../src/app');

const SEGRETO = 'x'.repeat(40);

test('autoconfig provider noti e sconosciuti', () => {
  assert.equal(configura('a@gmail.com').imap.host, 'imap.gmail.com');
  assert.equal(configura('a@libero.it').smtp.port, 465);
  assert.equal(configura('a@hotmail.it').oauth, true);
  const x = configura('mario@azienda.it');
  assert.equal(x.imap.host, 'imap.azienda.it');
  assert.equal(x.sicuro, false);
  assert.throws(() => configura('non-una-mail'));
});

test('crypto: password, cifratura, token', () => {
  const h = c.hashPassword('segretissima1');
  assert.ok(c.verificaPassword('segretissima1', h));
  assert.ok(!c.verificaPassword('altra', h));
  const d = c.cifra('pw-app', SEGRETO);
  assert.equal(c.decifra(d, SEGRETO), 'pw-app');
  assert.throws(() => c.decifra(d, 'y'.repeat(40)));
  const t = c.creaToken(7, SEGRETO);
  assert.equal(c.leggiToken(t, SEGRETO), 7);
  assert.equal(c.leggiToken(t + 'x', SEGRETO), null);
  assert.equal(c.leggiToken(t, 'y'.repeat(40)), null);
  assert.equal(c.leggiToken(c.creaToken(7, SEGRETO, 10, 0), SEGRETO, 11000), null);
});

test('regole: validazione e applicazione', () => {
  assert.throws(() => rules.validaRegola({ nome: 'a', campo: 'da', valore: 'x', azione: 'sposta' }));
  assert.throws(() => rules.validaRegola({ nome: 'a', campo: 'zzz', valore: 'x', azione: 'cestina' }));
  const r1 = rules.validaRegola({ nome: 'Newsletter', campo: 'da', valore: 'news@', azione: 'sposta', cartella: 'Newsletter' });
  const r2 = rules.validaRegola({ nome: 'Capo', campo: 'da', operatore: 'uguale', valore: 'capo@x.it', azione: 'importante' });
  assert.deepEqual(rules.applica([r1, r2], { da: 'News@shop.it', oggetto: '' }).map((a) => a.azione), ['sposta']);
  assert.deepEqual(rules.applica([r1, r2], { da: 'CAPO@x.it' }).map((a) => a.azione), ['importante']);
  assert.deepEqual(rules.applica([{ ...r1, attiva: 0 }], { da: 'news@a' }), []);
});

function finto() {
  const log = [];
  return {
    log,
    verifica: async (cfg, u, p) => { if (p !== 'buona') throw new Error('AUTHENTICATIONFAILED'); },
    elenca: async () => [{ uid: 1, da: 'news@shop.it', a: 'me', oggetto: 'Offerte', letto: false }, { uid: 2, da: 'amico@x.it', a: 'me', oggetto: 'Ciao', letto: false }],
    leggi: async (cfg, u, p, uid) => ({ uid, da: 'Marco <marco@x.it>', a: u, oggetto: 'Cena?', messageId: '<m1@x>', riferimenti: [], testo: 'Ci sei?' }),
    invia: async (cfg, u, p, m) => { log.push(['invia', m]); return { id: 'ok' }; },
    azione: async (cfg, u, p, uid, tipo, cart) => { log.push(['azione', uid, tipo, cart]); },
  };
}
async function chiama(app, metodo, percorso, corpo, token, extra = {}) {
  try { return await app.gestisci({ metodo, percorso, corpo, query: extra.query || {}, headers: token ? { authorization: `Bearer ${token}` } : {}, ip: '1.1.1.1' }); }
  catch (e) { return { errore: e.message, stato: e.stato }; }
}

test('flusso completo API', async () => {
  const mail = finto();
  const app = creaApp({ db: apri(), segreto: SEGRETO, mail });
  assert.equal((await chiama(app, 'POST', '/auth/registra', { email: 'a@b.it', password: 'corta' })).stato, 400);
  const { token } = await chiama(app, 'POST', '/auth/registra', { email: 'luigi@b.it', password: 'passwordlunga1' });
  assert.ok(token);
  assert.equal((await chiama(app, 'POST', '/auth/registra', { email: 'luigi@b.it', password: 'passwordlunga1' })).stato, 409);
  assert.equal((await chiama(app, 'GET', '/caselle', null, null)).stato, 401);
  assert.equal((await chiama(app, 'POST', '/auth/login', { email: 'luigi@b.it', password: 'passwordlunga1' })).token.length > 10, true);

  assert.equal((await chiama(app, 'GET', '/caselle/autoconfig', null, token, { query: { email: 'x@gmail.com' } })).provider, 'Gmail');
  assert.equal((await chiama(app, 'POST', '/caselle', { indirizzo: 'x@gmail.com', password: 'sbagliata' }, token)).stato, 400);
  assert.equal((await chiama(app, 'POST', '/caselle', { indirizzo: 'x@outlook.com', password: 'buona' }, token)).stato, 400);
  const cas = await chiama(app, 'POST', '/caselle', { indirizzo: 'x@gmail.com', password: 'buona' }, token);
  assert.equal(cas.provider, 'Gmail');
  assert.equal(JSON.stringify(await chiama(app, 'GET', '/caselle', null, token)).includes('buona'), false);

  assert.equal((await chiama(app, 'GET', `/caselle/${cas.id}/mail`, null, token)).mail.length, 2);
  assert.equal((await chiama(app, 'POST', `/caselle/${cas.id}/rispondi/1`, { testo: '' }, token)).stato, 400);
  await chiama(app, 'POST', `/caselle/${cas.id}/rispondi/1`, { testo: 'Arrivo tardi' }, token);
  assert.deepEqual([mail.log[0][1].a, mail.log[0][1].oggetto, mail.log[0][1].inRispostaA], ['marco@x.it', 'Re: Cena?', '<m1@x>']);

  assert.equal((await chiama(app, 'POST', `/caselle/${cas.id}/invia`, { a: 'sbagliato', testo: 'x' }, token)).stato, 400);

  await chiama(app, 'POST', '/regole', { nome: 'News', campo: 'da', valore: 'news@', azione: 'sposta', cartella: 'Newsletter' }, token);
  const ap = await chiama(app, 'POST', `/caselle/${cas.id}/regole/applica`, {}, token);
  assert.equal(ap.fatte.length, 1);
  assert.deepEqual(mail.log.at(-1), ['azione', 1, 'sposta', 'Newsletter']);
});

test('isolamento tra utenti e blocco login', async () => {
  const app = creaApp({ db: apri(), segreto: SEGRETO, mail: finto() });
  const a = (await chiama(app, 'POST', '/auth/registra', { email: 'a@b.it', password: 'passwordlunga1' })).token;
  const b = (await chiama(app, 'POST', '/auth/registra', { email: 'b@b.it', password: 'passwordlunga2' })).token;
  const cas = await chiama(app, 'POST', '/caselle', { indirizzo: 'x@gmail.com', password: 'buona' }, a);
  assert.equal((await chiama(app, 'GET', `/caselle/${cas.id}/mail`, null, b)).stato, 404);
  assert.equal((await chiama(app, 'DELETE', `/caselle/${cas.id}`, null, b)).stato, 404);
  for (let i = 0; i < 5; i++) await chiama(app, 'POST', '/auth/login', { email: 'a@b.it', password: 'no' });
  assert.equal((await chiama(app, 'POST', '/auth/login', { email: 'a@b.it', password: 'passwordlunga1' })).stato, 429);
});
