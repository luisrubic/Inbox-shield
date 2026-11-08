'use strict';
// Motore delle regole: funzione pura, testabile senza rete.
const AZIONI = ['segna_letto', 'sposta', 'cestina', 'importante'];
const CAMPI = ['da', 'a', 'oggetto', 'testo'];
const OPERATORI = ['contiene', 'uguale', 'inizia'];

function validaRegola(r) {
  if (!r || typeof r !== 'object') throw new Error('Regola mancante');
  const nome = String(r.nome || '').trim();
  if (!nome || nome.length > 80) throw new Error('Nome regola mancante o troppo lungo');
  if (!CAMPI.includes(r.campo)) throw new Error('Campo non valido (da, a, oggetto, testo)');
  const op = r.operatore || 'contiene';
  if (!OPERATORI.includes(op)) throw new Error('Operatore non valido');
  const valore = String(r.valore || '').trim();
  if (!valore || valore.length > 200) throw new Error('Valore mancante o troppo lungo');
  if (!AZIONI.includes(r.azione)) throw new Error('Azione non valida');
  const cartella = String(r.cartella || '').trim();
  if (r.azione === 'sposta' && (!cartella || cartella.length > 100)) throw new Error('Indica la cartella di destinazione');
  return { nome, campo: r.campo, operatore: op, valore, azione: r.azione, cartella: r.azione === 'sposta' ? cartella : '' };
}

function corrisponde(regola, mail) {
  const v = regola.valore.toLowerCase();
  const h = String(mail[regola.campo] || '').toLowerCase();
  if (regola.operatore === 'uguale') return h === v;
  if (regola.operatore === 'inizia') return h.startsWith(v);
  return h.includes(v);
}

// Ritorna le azioni da fare per una mail (tutte le regole che corrispondono, in ordine).
function applica(regole, mail) {
  const fatte = [];
  for (const r of regole) {
    if (r.attiva === 0 || r.attiva === false) continue;
    if (corrisponde(r, mail)) {
      fatte.push({ regola: r.nome, azione: r.azione, cartella: r.cartella });
      if (r.azione === 'cestina' || r.azione === 'sposta') break; // dopo lo spostamento la mail non è più in posta in arrivo
    }
  }
  return fatte;
}

module.exports = { validaRegola, applica, corrisponde };
