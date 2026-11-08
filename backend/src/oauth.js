'use strict';
// OAuth2 (Authorization Code + PKCE) per Google e Microsoft. Connessioni vere: i token
// arrivano dai server di Google/Microsoft; qui non c'è nulla di simulato.
const crypto = require('node:crypto');

const PROVIDER = {
  google: {
    nome: 'Gmail',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://mail.google.com/',
    extra: { access_type: 'offline', prompt: 'consent' }, // senza questi Google non dà il refresh token
    id: 'GOOGLE_CLIENT_ID', segreto: 'GOOGLE_CLIENT_SECRET',
    cfg: { imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
  },
  microsoft: {
    nome: 'Outlook/Hotmail',
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    extra: { prompt: 'select_account' },
    id: 'MS_CLIENT_ID', segreto: 'MS_CLIENT_SECRET',
    cfg: { imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false } },
  },
};

const b64u = (b) => Buffer.from(b).toString('base64url');

function creaOauth({ env, urlPubblico, fetch: f = globalThis.fetch, adesso = () => Date.now() }) {
  const redirect = () => `${String(urlPubblico || '').replace(/\/+$/, '')}/oauth/callback`;
  function prov(nome) {
    const p = PROVIDER[nome];
    if (!p) throw new Error('Provider OAuth sconosciuto (google o microsoft)');
    if (!env[p.id]) throw new Error(`${p.nome}: manca ${p.id} nel file .env (vedi README, sezione OAuth)`);
    if (!/^https:\/\//.test(redirect()) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(redirect())) {
      throw new Error('PUBLIC_URL deve essere https (o http://localhost): vedi README, sezione OAuth');
    }
    return p;
  }
  const disponibili = () => Object.entries(PROVIDER).filter(([, p]) => env[p.id]).map(([k, p]) => ({ provider: k, nome: p.nome }));

  // passo 1: URL a cui mandare l'utente. Ritorna anche verifier e stato da salvare.
  function avvia(nome) {
    const p = prov(nome);
    const stato = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const q = new URLSearchParams({
      client_id: env[p.id], redirect_uri: redirect(), response_type: 'code', scope: p.scope, state: stato,
      code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', ...p.extra,
    });
    return { url: `${p.auth}?${q}`, stato, verifier, scade: adesso() + 10 * 60 * 1000 };
  }

  async function chiediToken(p, corpo) {
    const params = new URLSearchParams({ client_id: env[p.id], ...(env[p.segreto] ? { client_secret: env[p.segreto] } : {}), ...corpo });
    const r = await f(p.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(`${p.nome}: ${d.error_description || d.error || r.status}`);
    return d;
  }

  // passo 2: scambia il codice con i token e legge l'indirizzo email dall'id_token
  async function scambia(nome, code, verifier) {
    const p = prov(nome);
    const d = await chiediToken(p, { grant_type: 'authorization_code', code, redirect_uri: redirect(), code_verifier: verifier });
    if (!d.refresh_token) throw new Error(`${p.nome} non ha dato il permesso di accesso continuato (refresh token): riprova e accetta tutti i permessi`);
    if (!d.id_token) throw new Error(`${p.nome}: risposta senza identità`);
    let corpo;
    try { corpo = JSON.parse(Buffer.from(d.id_token.split('.')[1], 'base64url').toString()); } catch { throw new Error('id_token non leggibile'); }
    const email = String(corpo.email || corpo.preferred_username || '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indirizzo email non presente nella risposta');
    return { email, refresh: d.refresh_token, provider: p.nome, cfg: { ...p.cfg, provider: p.nome, oauth: true }, access: d.access_token, scade: adesso() + (d.expires_in || 3600) * 1000 };
  }

  // access token valido dal refresh token (con cache fino a un minuto dalla scadenza)
  const cache = new Map();
  async function accessToken(nome, chiaveCache, refresh) {
    const c = cache.get(chiaveCache);
    if (c && c.scade - 60000 > adesso()) return c.token;
    const p = prov(nome);
    const d = await chiediToken(p, { grant_type: 'refresh_token', refresh_token: refresh, scope: p.scope });
    cache.set(chiaveCache, { token: d.access_token, scade: adesso() + (d.expires_in || 3600) * 1000 });
    return d.access_token;
  }

  return { avvia, scambia, accessToken, disponibili, redirect };
}
module.exports = { creaOauth, PROVIDER };
