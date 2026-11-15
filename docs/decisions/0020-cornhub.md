# 0020 — Account unico e AI tramite cornhub

Regalino non ha piu' login, registrazione, password, conferma email ne'
chiavi Gemini proprie. L'account vive su **cornhub** (https://cornhub.it,
repo cornhub), che e' un provider OpenID Connect e un gateway AI per tutta
la suite. Stesso schema di templatino (la sua ADR 0002): il client
`backend/apps/core/cornhub.py` e' identico in tutte le app e non si tocca qui.
Sostituisce la registrazione su invito ([ADR 0018](0018-registrazione-su-invito.md)):
chi puo' entrare in regalino lo decide cornhub (flag dell'app sull'account).

## Login

1. Il frontend senza sessione va su `/accedi`, che manda da solo (al massimo
   una volta ogni 30 secondi, per non girare in tondo se cornhub non
   risponde) a `/api/auth/sso/start?next=<percorso>`.
2. Il backend crea state, nonce e PKCE (S256), li mette in un cookie firmato
   httpOnly (`regalino_refresh_sso_login`, 10 minuti, path `/api/auth/sso`)
   e rimanda a `CORNHUB_URL/o/authorize/`.
3. cornhub fa entrare l'utente (o lo fa registrare) e torna su
   `API_PUBLIC_URL/api/auth/sso/callback?code&state`.
4. Il backend controlla lo state, scambia il codice sulla rete interna
   (`CORNHUB_INTERNAL_URL/o/token/`), verifica l'id_token (RS256, JWKS,
   `iss`, `aud`, `exp`, `nonce`) e trova l'utente: per `cornhub_sub`, poi per
   email **solo se cornhub la dichiara verificata** (cosi' gli account di
   prima si agganciano e tengono liste, regali, idee, campanelle e chiavi
   dell'estensione), altrimenti lo crea senza password. Nome, email e lingua
   si aggiornano a ogni login. Poi rimanda a `FRONTEND_BASE_URL + next`:
   un invito (`/unisciti/...`), una lista condivisa da salvare (`/l/...`) o
   `/estensione`, la pagina che l'estensione Chrome apre per collegarsi.
5. Da li' la sessione e' quella di sempre (access token in memoria, refresh
   nel cookie httpOnly `regalino_refresh`). A ogni refresh si chiede a
   cornhub `GET /internal/users/<sub>` (cache 2 minuti): account spento o
   senza accesso a regalino = sessione chiusa e refresh in blacklist. Se
   cornhub non risponde si lascia passare.
6. Logout: blacklist del refresh, poi `logout_url` di cornhub, che chiede se
   uscire anche dall'account della suite.

**Estensione Chrome** ([ADR 0016](0016-estensione-chrome.md)): resta la sua
chiave (`Authorization: Token`), creata dall'app. In piu', a ogni chiamata
`ExtensionTokenAuthentication` fa lo stesso controllo del refresh
(`still_allowed`): account spento su cornhub → 401, e l'estensione chiede
di ricollegarsi. Un utente mai entrato da cornhub (senza `cornhub_sub`) non
passa: le chiavi create prima tornano buone dopo il primo login da cornhub.

**Account** (`/account`): nome ed email si vedono soltanto, con i link
all'account della suite e a "Chiavi e limiti AI" su cornhub
(`GET /api/auth/config`); restano qui gli avvisi (`notify_by`), le
estensioni collegate e la lingua. `PATCH /api/me` non cambia piu' il nome.

**Passaggio degli utenti di prima**: `manage.py export_cornhub_users`
stampa in JSON email, hash della password, nome diviso in nome e cognome,
lingua, email verificata, attivo, date; su cornhub `import_users` li crea
con la stessa password.

## AI

Mai Gemini (o altri) dall'app: `apps/gifts/ai.py` costruisce prompt e
schemi (modelli pydantic) e chiama `cornhub.generate(...)` con l'utente che
ha chiesto. Le funzioni nel listino di cornhub (`regalino` in
`backend/apps/ai/features.py`):

| Funzione | Dove | Livello | Chi paga |
|---|---|---|---|
| `describe` | nome, prezzo e note dal link (`links/describe`, anche dall'estensione) | piccola | la casa, in pannocchie |
| `suggest` | "Ispirami" (`ideas/suggest`) | piccola | la casa |
| `shared_suggest` | "Alternative" sul link condiviso, anche senza account (unica `anon_ok`) | piccola | la casa |
| `import_list` | import di una pagina-lista (Elfster e altre; nel worker, fino a 11 pagine) | **grande** | la chiave dell'utente |

Tutte con `fast=True` (prima era sempre flash-lite). I ripieghi fra modelli
e provider li fa cornhub: il secondo tentativo locale su 429/503 non c'e'
piu'. Errori (`cornhub.AIError`): il riassunto del link resta un di piu'
(si tengono i dati dichiarati, come prima); idee e import mostrano il
messaggio di cornhub e, per `needs_key`/`limit`/`house_empty`, il link
"Apri cornhub" (`account_url`) nel banner d'errore. Accanto a "Leggi la
lista" nell'import da link, `<AiCost feature="import_list" count={link}>`
mostra chi paga e la stima prima di premere. Restano i limiti di frequenza
delle view (`THROTTLE_LINKS`, `THROTTLE_SUGGEST`, `THROTTLE_IMPORTS`); i
tetti di spesa li tiene cornhub. Senza `CORNHUB_APP_TOKEN` l'AI e' spenta
come prima senza `GEMINI_API_KEY`.

**Nell'interfaccia** (`frontend/src/components/Ai.tsx`): `<CornCounter />`
mostra le pannocchie 🌽 rimaste oggi (`/api/ai/wallet`, proxy di
`cornhub.wallet`) in fondo al rail su desktop e in una riga sticky in alto a
destra su mobile, sopra le azioni delle pagine invece che addosso; porta
alla pagina AI di cornhub, si aggiorna ogni minuto e subito dopo `describe`,
`suggest`, `shared_suggest` e la lettura dell'import (`useRefreshAi()`). I
bottoni delle funzioni grandi hanno la chiave (`<AiKeyIcon />`) e si
spengono con `useAiGate(feature).allowed` falso. Eccezione: "Leggi la
lista" (`import_list`) mostra la chiave solo per i link ma resta acceso,
perche' Amazon, le pagine con JSON-LD e i file non passano dall'AI e prima
di leggere non si sa: se l'AI serve e manca la chiave, decide l'errore di
cornhub (col link), e `AiCost` accanto lo dice gia'.

**Perche':** un account e una password per tutta la suite invece di copie
del codice di login in ogni app; chiavi API in un solo posto, che le app
non vedono mai; spesa con limiti veri. L'import, che legge pagine intere,
pesa sulla chiave di chi lo usa e non sulla casa.

**Costo accettato:** se cornhub e' giu' non si entra (le sessioni aperte
continuano) e l'AI si ferma; i link condivisi e le spunte restano pubblici e
funzionano lo stesso. Le mail dell'account (conferma, reset) le manda
cornhub; regalino manda solo gli avvisi di prezzo.

**Quando rivederla:** se regalino deve funzionare da solo, fuori dalla suite.
