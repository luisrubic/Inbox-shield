'use strict';
const crypto = require('node:crypto');

function chiave(segreto) {
  if (!segreto || segreto.length < 32) throw new Error('INBOX_SECRET deve avere almeno 32 caratteri');
  return crypto.createHash('sha256').update(segreto).digest();
}

// --- password degli utenti: scrypt con sale casuale
function hashPassword(password) {
  const sale = crypto.randomBytes(16);
  const h = crypto.scryptSync(password, sale, 64);
  return `${sale.toString('hex')}:${h.toString('hex')}`;
}
function verificaPassword(password, salvata) {
  const [s, h] = String(salvata).split(':');
  if (!s || !h) return false;
  const calc = crypto.scryptSync(password, Buffer.from(s, 'hex'), 64);
  const atteso = Buffer.from(h, 'hex');
  return calc.length === atteso.length && crypto.timingSafeEqual(calc, atteso);
}

// --- password delle caselle email: AES-256-GCM (vanno rimandate al server di posta, quindi cifrate e non "hashate")
function cifra(testo, segreto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chiave(segreto), iv);
  const enc = Buffer.concat([c.update(testo, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decifra(dato, segreto) {
  const [iv, tag, enc] = String(dato).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', chiave(segreto), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// --- token di accesso firmati (HMAC-SHA256), con scadenza
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firma(parte, segreto) {
  return crypto.createHmac('sha256', chiave(segreto)).update(parte).digest('base64url');
}
function creaToken(uid, segreto, durataSec = 30 * 24 * 3600, adesso = Date.now()) {
  const corpo = b64({ uid, exp: Math.floor(adesso / 1000) + durataSec });
  return `${corpo}.${firma(corpo, segreto)}`;
}
function leggiToken(token, segreto, adesso = Date.now()) {
  const [corpo, f] = String(token || '').split('.');
  if (!corpo || !f) return null;
  const atteso = firma(corpo, segreto);
  if (f.length !== atteso.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(atteso))) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return d.exp * 1000 > adesso ? d.uid : null;
  } catch { return null; }
}

module.exports = { hashPassword, verificaPassword, cifra, decifra, creaToken, leggiToken };
