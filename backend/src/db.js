'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function apri(cartella) {
  let file = ':memory:';
  if (cartella) {
    fs.mkdirSync(cartella, { recursive: true });
    file = path.join(cartella, 'inbox.db');
  }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS utenti (
      id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, creato INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS caselle (
      id INTEGER PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
      indirizzo TEXT NOT NULL, provider TEXT NOT NULL, config TEXT NOT NULL, segreto TEXT NOT NULL,
      UNIQUE(utente, indirizzo));
    CREATE TABLE IF NOT EXISTS regole (
      id INTEGER PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
      nome TEXT NOT NULL, campo TEXT NOT NULL, operatore TEXT NOT NULL, valore TEXT NOT NULL,
      azione TEXT NOT NULL, cartella TEXT NOT NULL DEFAULT '', attiva INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS oauth_stati (
      stato TEXT PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, verifier TEXT NOT NULL, scade INTEGER NOT NULL);
  `);
  try { db.exec("ALTER TABLE caselle ADD COLUMN tipo TEXT NOT NULL DEFAULT 'password'"); } catch { /* già presente */ }
  return db;
}
module.exports = { apri };
