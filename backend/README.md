# Inbox Shield – backend (Node.js ≥ 22.5)

## Avvio sul portatile
1. `npm install`
2. Copia `.env.example` in `.env` e metti in `INBOX_SECRET` 32+ caratteri casuali
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. `npm start`  → ascolta sulla porta 8080.
4. Test: `npm test`

Fuori casa si usa come Jarvis: Tailscale (indirizzo `http://100.x.y.z:8080`), niente porte aperte sul router.

## Sicurezza
- Password utenti: scrypt + sale. Token di login firmati (HMAC), scadenza 30 giorni.
- Password delle caselle email: cifrate AES-256-GCM con `INBOX_SECRET` (perso il segreto, vanno ricollegate).
- Blocco dopo 5 login sbagliati (15 minuti). Mai caricare `.env` o `data/` su GitHub.

## Caselle
Configurazione automatica dall'indirizzo (Gmail, iCloud, Yahoo, Libero, Virgilio, Aruba, Fastmail, domini aziendali "ipotizzati").
- Gmail/iCloud/Yahoo/Fastmail: serve una **password per le app**.
- Outlook/Hotmail personali: richiedono OAuth, **non supportato** in questa versione.

## API (JSON, `Authorization: Bearer <token>`)
POST /auth/registra, /auth/login · GET /caselle/autoconfig?email= · GET/POST /caselle · DELETE /caselle/:id
GET /caselle/:id/mail?nonLette=1 · GET /caselle/:id/mail/:uid · POST /caselle/:id/invia · POST /caselle/:id/rispondi/:uid
GET/POST /regole · PATCH/DELETE /regole/:id · POST /caselle/:id/regole/applica

## OAuth (Gmail e Outlook/Hotmail con accesso "vero")
Il flusso è Authorization Code + PKCE: nel telefono si apre il browser su Google/Microsoft, accedi lì (la password non passa mai da noi) e il server riceve i token. Cifrati nel database, rinnovati da soli.

**Indirizzo https.** Google e Microsoft accettano come redirect solo `https://…` (o `http://localhost`). Il modo più semplice, restando privati: sul portatile con Tailscale
`tailscale serve --bg 8080` → ti dà `https://NOME-PC.tuarete.ts.net`. Mettilo in `PUBLIC_URL`. Il telefono deve avere Tailscale acceso.
Redirect da registrare: `PUBLIC_URL/oauth/callback`.

**Google (Gmail)**
1. console.cloud.google.com → nuovo progetto → API e servizi → abilita "Gmail API".
2. Schermata consenso OAuth: tipo Esterno; aggiungi te stesso come utente di prova; aggiungi lo scope `https://mail.google.com/`.
3. Credenziali → ID client OAuth → "Applicazione web" → URI di reindirizzamento = redirect sopra. Copia ID e segreto in `GOOGLE_CLIENT_ID/SECRET`.
4. IMPORTANTE: finché l'app resta in "Test", Google fa scadere il collegamento ogni 7 giorni. Per uso personale premi "Pubblica app" (resta "non verificata": al primo accesso clicca Avanzate → continua).

**Microsoft (Outlook/Hotmail/Live)**
1. portal.azure.com → Microsoft Entra ID → Registrazioni app → Nuova; tipi di account: "qualsiasi directory e account Microsoft personali".
2. Autenticazione → Web → URI di reindirizzamento = redirect sopra.
3. Autorizzazioni API → Microsoft Graph/Office 365 Exchange Online delegate: `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`.
4. Certificati e segreti → nuovo segreto → `MS_CLIENT_ID` (ID applicazione) e `MS_CLIENT_SECRET` (valore).
Se `SMTP.Send` dà errore, l'organizzazione/account può avere l'SMTP AUTH disattivato.

## Jarvis
Nel `.env` del server Jarvis metti `INBOX_URL`, `INBOX_EMAIL`, `INBOX_PASSWORD` (account Inbox Shield): Jarvis legge e risponde tramite il backend, quindi anche per caselle OAuth. Gli invii restano soggetti a conferma.
