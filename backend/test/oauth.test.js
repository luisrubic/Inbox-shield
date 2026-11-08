'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { creaOauth } = require('../src/oauth');
const { apri } = require('../src/db');
const { creaApp } = require('../src/app');

const SEGRETO = 'x'.repeat(40);
const idToken = (c) => `a.${Buffer.from(JSON.stringify(c)).toString('base64url')}.b`;

function fetchFinto(log, risposte) {
  return async (url, o) => {
    const p = Object.fromEntries(new URLSearchParams(o.body));
    log.push({ url, p });
    const r = risposte(url, p);
    return { ok: !r.error, status: r.error ? 400 : 200, json: async () => r };
  };
}
const env = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', MS_CLIENT_ID: 'mid' };

test('URL di autorizzazione con PKCE e redirect', () => {
  const o = creaOauth({ env, urlPubblico: 'https://pc.tail1.ts.net' });
  const a = o.avvia('google');
  const u = new URL(a.url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://pc.tail1.ts.net/oauth/callback');
  assert.equal(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.ok(u.searchParams.get('scope').includes('https://mail.google.com/'));
  assert.equal(u.searchParams.get('state'), a.stato);
  assert.throws(() => creaOauth({ env: {}, urlPubblico: 'https://x.it' }).avvia('google'), /GOOGLE_CLIENT_ID/);
  assert.throws(() => creaOauth({ env, urlPubblico: 'http://192.168.1.5:8080' }).avvia('google'), /https/);
  assert.throws(() => o.avvia('yahoo'), /sconosciuto/);
  assert.deepEqual(o.disponibili().map((x) => x.provider), ['google', 'microsoft']);
});

test('scambio codice, rinnovo token con cache, errori', async () => {
  const log = [];
  let t = 0;
  const f = fetchFinto(log, (url, p) => {
    if (p.grant_type === 'authorization_code') return p.code === 'ko' ? { error: 'invalid_grant', error_description: 'Codice scaduto' } : { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, id_token: idToken({ email: 'Luigi@Gmail.com' }) };
    return { access_token: `A${++t + 1}`, expires_in: 3600 };
  });
  let ora = 1000;
  const o = creaOauth({ env, urlPubblico: 'https://pc.ts.net', fetch: f, adesso: () => ora });
  const r = await o.scambia('google', 'ok', 'ver');
  assert.deepEqual([r.email, r.refresh, r.cfg.imap.host], ['luigi@gmail.com', 'R1', 'imap.gmail.com']);
  assert.equal(log[0].p.code_verifier, 'ver');
  assert.equal(log[0].p.client_secret, 'gsec');
  await assert.rejects(o.scambia('google', 'ko', 'v'), /Codice scaduto/);
  assert.equal(await o.accessToken('google', 1, 'R1'), 'A2');
  assert.equal(await o.accessToken('google', 1, 'R1'), 'A2'); // cache
  ora += 3600 * 1000;
  assert.equal(await o.accessToken('google', 1, 'R1'), 'A3'); // scaduto: rinnovo
  const senza = creaOauth({ env, urlPubblico: 'https://x.it', fetch: fetchFinto([], () => ({ access_token: 'a', id_token: idToken({ email: 'a@b.it' }) })) });
  await assert.rejects(senza.scambia('google', 'c', 'v'), /refresh token/);
});

test('flusso completo: avvia, callback, lettura con access token', async () => {
  const chiamate = [];
  const mail = {
    elenca: async (cfg, u, cred) => { chiamate.push(cred); return []; },
    verifica: async () => {},
  };
  const f = fetchFinto([], (url, p) => p.grant_type === 'authorization_code'
    ? { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, id_token: idToken({ preferred_username: 'gigi@outlook.it' }) }
    : { access_token: 'ACCESS-NUOVO', expires_in: 3600 });
  const oauth = creaOauth({ env, urlPubblico: 'https://pc.ts.net', fetch: f });
  const db = apri();
  const app = creaApp({ db, segreto: SEGRETO, mail, oauth });
  const g = (metodo, percorso, corpo, token, query) => app.gestisci({ metodo, percorso, corpo, query: query || {}, headers: token ? { authorization: `Bearer ${token}` } : {} }).catch((e) => ({ errore: e.message, stato: e.stato }));
  const { token } = await g('POST', '/auth/registra', { email: 'a@b.it', password: 'passwordlunga1' });

  assert.equal((await g('GET', '/caselle/oauth/provider', null, token)).provider.length, 2);
  assert.equal((await g('POST', '/caselle/oauth/avvia', { provider: 'yahoo' }, token)).stato, 400);
  const { url } = await g('POST', '/caselle/oauth/avvia', { provider: 'microsoft' }, token);
  const stato = new URL(url).searchParams.get('state');

  assert.match((await g('GET', '/oauth/callback', null, null, { state: 'inventato', code: 'x' })).__html, /scaduto/);
  assert.match((await g('GET', '/oauth/callback', null, null, { state: stato, code: 'c1' })).__html, /gigi@outlook\.it è collegata/);
  assert.match((await g('GET', '/oauth/callback', null, null, { state: stato, code: 'c1' })).__html, /scaduto/); // monouso

  const lista = (await g('GET', '/caselle', null, token)).caselle;
  assert.equal(lista[0].indirizzo, 'gigi@outlook.it');
  assert.equal(JSON.stringify(lista).includes('R1'), false);
  assert.equal(db.prepare('SELECT segreto FROM caselle').get().segreto.includes('R1'), false); // cifrato
  await g('GET', `/caselle/${lista[0].id}/mail`, null, token);
  assert.deepEqual(chiamate[0], { accessToken: 'ACCESS-NUOVO' });
  // la password semplice non è accettata per Outlook
  assert.equal((await g('POST', '/caselle', { indirizzo: 'x@hotmail.it', password: 'p' }, token)).stato, 400);
});

test('callback: errore del provider e HTML sicuro', async () => {
  const oauth = creaOauth({ env, urlPubblico: 'https://pc.ts.net', fetch: fetchFinto([], () => ({ error: 'x', error_description: '<script>alert(1)</script>' })) });
  const db = apri();
  const app = creaApp({ db, segreto: SEGRETO, mail: {}, oauth });
  const { token } = await app.gestisci({ metodo: 'POST', percorso: '/auth/registra', corpo: { email: 'a@b.it', password: 'passwordlunga1' }, headers: {} });
  const { url } = await app.gestisci({ metodo: 'POST', percorso: '/caselle/oauth/avvia', corpo: { provider: 'google' }, headers: { authorization: `Bearer ${token}` } });
  const r = await app.gestisci({ metodo: 'GET', percorso: '/oauth/callback', query: { state: new URL(url).searchParams.get('state'), code: 'c' }, headers: {} });
  assert.ok(!r.__html.includes('<script>'));
  assert.match(r.__html, /&lt;script&gt;/);
});
