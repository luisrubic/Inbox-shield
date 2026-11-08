'use strict';
// Dal indirizzo email ricava i server IMAP/SMTP. Nessuna rete: tabella dei provider noti.
const PROVIDER = {
  gmail: { nome: 'Gmail', imap: ['imap.gmail.com', 993], smtp: ['smtp.gmail.com', 465], nota: 'Serve la verifica in 2 passaggi e una "Password per le app" (myaccount.google.com/apppasswords).', dom: ['gmail.com', 'googlemail.com'] },
  outlook: { nome: 'Outlook/Hotmail', imap: ['outlook.office365.com', 993], smtp: ['smtp-mail.outlook.com', 587], oauth: true, nota: 'Microsoft ha disattivato la password semplice per gli account personali: serve OAuth (non incluso in questa versione).', dom: ['outlook.com', 'outlook.it', 'hotmail.com', 'hotmail.it', 'live.com', 'live.it', 'msn.com'] },
  icloud: { nome: 'iCloud', imap: ['imap.mail.me.com', 993], smtp: ['smtp.mail.me.com', 587], nota: 'Serve una password specifica per app (appleid.apple.com).', dom: ['icloud.com', 'me.com', 'mac.com'] },
  yahoo: { nome: 'Yahoo', imap: ['imap.mail.yahoo.com', 993], smtp: ['smtp.mail.yahoo.com', 465], nota: 'Serve una password per le app (Sicurezza account Yahoo).', dom: ['yahoo.com', 'yahoo.it', 'ymail.com'] },
  libero: { nome: 'Libero', imap: ['imapmail.libero.it', 993], smtp: ['smtp.libero.it', 465], nota: '', dom: ['libero.it', 'inwind.it', 'iol.it', 'blu.it', 'giallo.it'] },
  virgilio: { nome: 'Virgilio', imap: ['in.virgilio.it', 993], smtp: ['out.virgilio.it', 465], nota: '', dom: ['virgilio.it', 'tin.it', 'alice.it'] },
  aruba: { nome: 'Aruba', imap: ['imaps.aruba.it', 993], smtp: ['smtps.aruba.it', 465], nota: '', dom: ['aruba.it'] },
  pec: { nome: 'PEC Aruba', imap: ['imaps.pec.aruba.it', 993], smtp: ['smtps.pec.aruba.it', 465], nota: '', dom: ['pec.it'] },
  fastmail: { nome: 'Fastmail', imap: ['imap.fastmail.com', 993], smtp: ['smtp.fastmail.com', 465], nota: 'Serve una password per le app.', dom: ['fastmail.com'] },
  proton: { nome: 'Proton Mail', imap: ['127.0.0.1', 1143], smtp: ['127.0.0.1', 1025], nota: 'Richiede Proton Mail Bridge sul computer: non utilizzabile da server remoto.', dom: ['proton.me', 'protonmail.com'] },
};
const RE_EMAIL = /^[^\s@<>()]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

function dominio(email) {
  const m = RE_EMAIL.exec(String(email || '').trim());
  return m ? m[1].toLowerCase() : null;
}

function configura(email) {
  const dom = dominio(email);
  if (!dom) throw new Error('Indirizzo email non valido');
  for (const p of Object.values(PROVIDER)) {
    if (p.dom.includes(dom)) {
      return { provider: p.nome, imap: { host: p.imap[0], port: p.imap[1], secure: p.imap[1] === 993 }, smtp: { host: p.smtp[0], port: p.smtp[1], secure: p.smtp[1] === 465 }, oauth: !!p.oauth, nota: p.nota, sicuro: true };
    }
  }
  // Dominio sconosciuto (aziendale, hosting): tentativo standard, da verificare con il test di connessione.
  return { provider: dom, imap: { host: `imap.${dom}`, port: 993, secure: true }, smtp: { host: `smtp.${dom}`, port: 465, secure: true }, oauth: false, nota: 'Impostazioni ipotizzate: se il collegamento fallisce inseriscile a mano.', sicuro: false };
}

module.exports = { configura, dominio };
