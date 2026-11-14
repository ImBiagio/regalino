# 0018 — Registrazione su invito (`SIGNUP_CODE`)

Regalino è per famiglia e amici, ma sta su un indirizzo pubblico: con la
registrazione aperta chiunque lo trovi crea un account e può usare ciò che
costa (letture col browser dello scraper, Gemini, mail di conferma). Come in
cinemino, un **codice d'invito** facoltativo.

- `SIGNUP_CODE` nel `.env`. **Vuoto o assente: registrazione aperta, come
  prima.** Impostato: `POST /api/auth/register` vuole `invite_code` uguale,
  altrimenti 400 sul campo `invite_code`.
- Il confronto è a tempo costante (`constant_time_compare`) e viene **prima**
  degli altri campi: chi non ha il codice non scopre, dall'errore
  sull'email, chi è già registrato. I tentativi sono limitati da
  `THROTTLE_AUTH` (10 al minuto per IP), come il login.
- Il form lo sa da `GET /api/auth/signup-config` → `{invite_code_required}`
  (pubblico; dice solo *se* serve) e mostra il campo "Codice d'invito" solo
  allora. Se quella richiesta fallisce il campo compare al primo rifiuto.
- Un codice solo, uguale per tutti, che si cambia nel `.env` (e riavviando il
  backend). Chi è già registrato non ne risente: login, reset della password
  e link condivisi non lo chiedono.

**Scartato:** inviti personali a uso singolo (tabella, schermata per crearli,
scadenze): per una decina di persone è più di quanto serve; se il codice gira
troppo lo si cambia. Scartato anche chiudere del tutto la registrazione e
creare gli account dall'admin: toglie a chi è invitato la conferma email e la
scelta della password.

**Costo accettato:** il codice è un segreto condiviso, non un controllo di
identità; chi lo riceve può passarlo. Vive solo nel `.env` del server e nel
vault ("Credenziali e accessi").
