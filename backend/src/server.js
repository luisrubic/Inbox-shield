'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env assente: usa le variabili del sistema */ }
const { apri } = require('./db');
const { creaApp } = require('./app');
const mail = require('./mail');

const segreto = process.env.INBOX_SECRET || '';
if (segreto.length < 32) { console.error('Imposta INBOX_SECRET (almeno 32 caratteri) nel file .env'); process.exit(1); }
const dati = process.env.INBOX_DATA || path.join(__dirname, '..', 'data');
const { creaOauth } = require('./oauth');
const urlPubblico = process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 8080}`;
const oauth = creaOauth({ env: process.env, urlPubblico });
const app = creaApp({ db: apri(dati), segreto, mail, oauth });
console.log('OAuth attivo per:', oauth.disponibili().map((p) => p.nome).join(', ') || 'nessun provider (vedi README)', '| redirect:', oauth.redirect());
const porta = Number(process.env.PORT) || 8080;
http.createServer((q, r) => app.http(q, r)).listen(porta, () => console.log(`Inbox Shield in ascolto sulla porta ${porta}`));
