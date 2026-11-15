# Regalino

Liste dei regali. Ognuno scrive la sua lista (compleanno, Natale, quello che
vuole) e la condivide con un link: chi ha il link vede i regali e spunta
"lo regalo io", così nessuno fa doppioni. Accanto, la lista **Da regalare**:
le idee che ho in mente per gli altri, e per chi.

Stesso stack e stesse fondamenta di [soldino](https://github.com/ImBiagio/soldino)
(e di cinemino per mail e deploy): Django + DRF + Postgres + Celery/Redis +
React (Vite) + Tailwind con token Material 3, tutto in Docker Compose.

---

## Avvio

```bash
cp .env.example .env && docker compose up --build
```

| | |
|---|---|
| App | http://localhost:5176 |
| API | http://localhost:8020/api |
| Docs OpenAPI | http://localhost:8020/api/docs/ |
| Admin Django | http://localhost:8020/admin/ |

Le porte sono diverse da soldino (`5173`/`8000`/`5433`) per far girare i due
progetti insieme; per lo stesso motivo il cookie di refresh si chiama
`regalino_refresh`.

Per entrare serve cornhub in locale (repo cornhub: `docker compose up`, su
http://localhost:8095) con l'app registrata
([ADR 0020](docs/decisions/0020-cornhub.md)):

```bash
docker compose -f ../cornhub/compose.yaml exec backend python manage.py register_app regalino --name Regalino --url http://localhost:5176 --extra-redirect http://localhost:8020/api/auth/sso/callback
```

`CORNHUB_CLIENT_ID`, `CORNHUB_CLIENT_SECRET` e `CORNHUB_APP_TOKEN` stampati
vanno nel `.env` (senza il token l'AI resta spenta); l'account si crea su
http://localhost:8095/registrati. Le mail dell'app (avvisi di prezzo)
finiscono nei log del worker:
`docker compose logs -f worker`. Il codice è montato come volume (hot reload);
dopo nuove migrazioni ricostruisci l'immagine: `docker compose build backend`.

---

## Cosa fa

**Le mie liste** (`/`, `/liste/:id`). Una lista ha nome, data facoltativa
(mostra quanto manca; le liste sono in ordine di data, la prossima in cima) e
due righe per chi la apre. I regali hanno titolo, link al negozio, prezzo
indicativo, quanti ne servono e note: si vedono come card in griglia, un tocco
apre il form (dove c'è anche "Elimina"), e in testa c'è il totale indicativo.
Quanti ne servono ([ADR 0012](docs/decisions/0012-quantita-di-un-regalo.md)):
un contatore accanto al prezzo ("6 bicchieri", da 1 a 99); il prezzo è quello
del pezzo, la card e il totale mostrano `prezzo × quantità` ("3 × 18,90 €"),
anche sul link condiviso. La spunta resta una sola, per tutto l'insieme. Il link si salva
ripulito dal tracciamento (`utm_*`, `fbclid`, `gclid`…; su Amazon resta solo
`/dp/<codice>`) e può arrivare a 2000 caratteri.

**Condivisione** (`/l/<token>`). Il link è un token casuale (`WishList.share_token`):
chi lo ha vede la lista **senza account** (quanti regali restano, filtri "Da
prendere" / "Tutti"), e tocca "Lo regalo io" lasciando il nome se vuole. Il regalo risulta preso per tutti. Rigenerare il link spegne
quello vecchio; eliminare la lista lo spegne del tutto.

**Liste salvate** ([ADR 0014](docs/decisions/0014-liste-salvate.md)). Sul
link di una lista di un altro, da loggati, "Salva lista" la mette in "Le mie
liste" sotto **Liste salvate** (di chi è, la data, quanti regali restano), così
non si cerca più il messaggio. Si salva il link: se il proprietario lo rigenera
o elimina la lista, resta solo il titolo e "Il link non vale più".

**Importa** ([ADR 0015](docs/decisions/0015-import-di-liste.md)). Da "Le
mie liste" → Importa si incolla il link di una lista desideri Amazon pubblica,
di una lista o di un profilo Elfster (o di un'altra pagina di lista; più link,
uno per riga) oppure si sceglie un file CSV/JSON. Amazon si legge con un parser
dedicato (pagine "mostra altro" comprese); Elfster e le altre pagine si aprono
col browser dello scraper e l'AI di cornhub ne estrae i regali (link e foto solo se
sono davvero nella pagina). Si vede un'anteprima, si tolgono le liste che non
servono e si importa. La lettura con l'AI è una funzione **grande** di
cornhub (`import_list`): la paga la chiave AI di chi importa, e accanto a
"Leggi la lista" si vede la stima prima di premere. Più liste in una sorgente (il profilo con più wishlist,
`lists` annidate nel JSON, `Natale > Libri` nella colonna `lista` del CSV)
diventano liste incluse, oppure tutte dentro una lista nuova. Le foto le
scarica il worker dopo. Limiti: 20 liste, 300 regali, file da 2 MB,
`THROTTLE_IMPORTS` (20/ora).

**Estensione per Chrome** ([ADR 0016](docs/decisions/0016-estensione-chrome.md),
cartella [`extension/`](extension/README.md)). Sulla pagina di un prodotto si
tocca l'icona di Regalino: il regalo arriva compilato (nome, prezzo, foto, note
dell'AI) dalla pagina che si sta guardando, si sceglie la lista e si
aggiunge. Su una lista desideri Amazon o una lista/profilo Elfster propone di
importarla tutta (scorre la pagina fino in fondo e segue la lettura anche a
popup chiuso). Si installa a mano ("Carica estensione non pacchettizzata") e
si collega da `/estensione` con un tocco: l'app crea una chiave
(`ExtensionToken`, sul server solo l'hash) che vale solo per
`/api/extension/...`; i browser collegati si vedono e si scollegano in Account.

**Scritta in due** ([ADR 0007](docs/decisions/0007-liste-scritte-insieme.md)).
Una lista si può scrivere con altri: dal riquadro "La scrivi solo tu" si crea
un link d'invito (`/unisciti/<token>`), chi lo apre con un account entra e
aggiunge e modifica i regali come il proprietario (e sul link pubblico, come
lui, non spunta e non vede le spunte). Solo il proprietario elimina la lista,
rigenera il link pubblico e toglie gli altri; un membro può uscire. Il link
d'invito si spegne e si rinnova.

**Una lista dentro un'altra** ([ADR 0008](docs/decisions/0008-liste-incluse.md)).
Da "Includi un'altra lista" si scelgono liste proprie da mettere dentro questa:
i loro regali compaiono qui e nel link pubblico, in una sezione per lista, e la
spunta vale una volta sola. Un solo livello: una lista inclusa non ne include
altre, ma può stare in più liste. Le liste incluse restano liste normali.

**Regali che vanno insieme** ([ADR 0009](docs/decisions/0009-regali-che-vanno-insieme.md)).
Nel form di un regalo si sceglie "Va con un altro regalo" (la custodia con le
cuffie): sul link la card lo dice, e "Lo regalo io" si accende solo dopo che
l'altro è stato preso (il server rifiuta con 409 prima). Stessa lista, niente giri.

**Dove trovarlo.** Dal link il server legge anche codice a barre (EAN/ISBN) e
marca, se la pagina li dichiara. Su ogni regalo (delle proprie liste e del
link condiviso) e su ogni idea c'è "Dove trovarlo": il negozio indicato e la ricerca dello stesso
prodotto (per codice, altrimenti marca e nome) su Google Shopping, Amazon,
eBay e Trovaprezzi. Solo link di ricerca: nessuna API, nessuna pagina letta.

**Ispirami** ([ADR 0010](docs/decisions/0010-ispirami-con-gemini.md)). In
"Da regalare", un wizard (per chi, gusti e budget) e l'AI propone otto idee
con il perché e un prezzo indicativo: un tocco e l'idea è in lista, o si cerca
nei negozi. Sul link condiviso, un regalo già preso ha "Alternative", idee
simili partendo dalla lista. Passa da cornhub (funzioni piccole `suggest` e, anche senza account,
`shared_suggest`); limite `THROTTLE_SUGGEST`
(30/ora).

**Animazioni** ([ADR 0013](docs/decisions/0013-animazioni-e-segno-dell-ai.md)).
Card e idee entrano in fila, i dialog salgono, col mouse il fiocco del pacco si
muove. Dove lavora l'AI c'è l'oro del nastro: mentre pensa un pacco salta e
un messaggio cambia ("Scarto i soliti calzini…"), e i campi del form che ha
appena scritto lui hanno una passata di luce. "Lo regalo io" lancia i
coriandoli. Tutto in CSS (`index.css`, sezione "moto") e `components/motion.tsx`;
con "riduci movimento" del sistema non si muove niente.

**Andamento del prezzo e campanella** ([ADR 0011](docs/decisions/0011-andamento-prezzo-e-campanella.md)).
Ogni regalo o idea con un link ha la storia dei prezzi: il primo è quello di
quando entra in lista, poi un task notturno rilegge la pagina (con un tetto:
`PRICE_CHECKS_PER_NIGHT`, `PRICE_CHECK_GAP`) e sulla card compare "−17% da
quando è in lista"; un tocco apre il grafico (attuale, minimo, massimo,
linea nel tempo e tabella). La campanella sul regalo (dalla lista, dal link con un
account, dalle idee) avvisa quando il prezzo scende: nell'app ("Avvisi", col
contatore), per email o entrambi, come si sceglie in Account. In "Avvisi" la
vista **Campanelle** elenca tutti i regali e le idee con la campanella (di chi è
la lista o per chi è l'idea, prezzo di oggi, andamento, se è già preso) e la
toglie con un tocco (`GET /api/watches`, `DELETE /api/watches/<id>`).

**La sorpresa** ([ADR 0002](docs/decisions/0002-sorpresa-e-chiavi-di-spunta.md)).
Di default il proprietario **non vede** cosa è stato regalato, né nella sua
area né aprendo il proprio link (e lì non può spuntare). Se preferisce saperlo
accende "Mostrami cosa è stato regalato" (l'interruttore sotto la testata della
lista, con conferma) e da lì può anche togliere una spunta sbagliata.

**Togliere la spunta.** Solo chi ha spuntato: lo spunto restituisce una
`claim_key` che il browser tiene in `localStorage` (sul server ne resta solo
l'hash); un utente loggato può toglierla anche da un altro dispositivo.

**Foto** ([ADR 0003](docs/decisions/0003-foto-dei-regali.md)). Ogni regalo e
ogni idea possono avere una foto: si carica dal telefono o dal computer, oppure
"Dal link" la prende dalla pagina del negozio (`og:image` e simili) o da un
link diretto a un'immagine; di default la prende da sola appena si scrive o
incolla il link del regalo, se una foto non c'è. Il server la riduce a 1280 px,
la salva in WebP e toglie i metadati (niente GPS nelle foto fatte in casa).
Leggendo i link il server non raggiunge mai indirizzi non pubblici (LAN,
localhost, Docker): ogni redirect si ricontrolla e la connessione va all'IP
verificato. Se la lettura diretta non basta (Amazon, pagine fatte in
JavaScript) la pagina si apre col browser headless del servizio `scraper`
([ADR 0005](docs/decisions/0005-scraper-col-browser.md)), con le stesse regole
di rete; i siti che bloccano anche il browser o chiedono un captcha (Zalando)
restano da caricare a mano. Chromium gira con la sua sandbox, in un container
senza capability e in sola lettura ([ADR 0017](docs/decisions/0017-sandbox-di-chromium-e-container-chiusi.md)).
Sulla lista condivisa la foto si tocca per vederla grande.

**Dal link al form** ([ADR 0006](docs/decisions/0006-dati-del-regalo-dal-link.md)).
Incollato il link, il form si compila da solo nei campi ancora liberi: nome,
prezzo, note e foto (sotto i campi compilati: "Dal link del negozio"). Quello
che si è scritto a mano non si tocca; se il link cambia, cambia anche quello
che aveva messo il link. Il server legge i dati che i negozi dichiarano
(`og:*`, JSON-LD, microdata) e, con l'AI di cornhub (funzione piccola `describe`), fa leggere all'AI il
testo della pagina per un nome corto, il prezzo e una nota con la variante:
funziona con qualsiasi negozio, non solo con quelli che dichiarano i dati. I
dati della pagina arrivano subito, quelli dell'AI dopo ("Miglioro nome e
note…"), senza toccare i campi che intanto si sono scritti.

**Da regalare** (`/da-regalare`). Idee per gli altri: per chi (testo libero,
con suggerimenti dai nomi già usati), cosa, occasione, prezzo, link, note e
stato `idea → comprato → regalato` (un tocco sulla pill passa al successivo).
Raggruppate per persona, con il totale; filtri Da fare / Idee / Comprati /
Regalati / Tutte. Private: le vede solo chi le scrive.

**Account e lingue** ([ADR 0020](docs/decisions/0020-cornhub.md)): si entra
con l'account unico della suite su **cornhub** (OpenID Connect con PKCE,
`backend/apps/users/sso.py`): niente registrazione, password o conferma
email nell'app; chi può entrare in regalino lo decide cornhub. Gli account
di prima si agganciano al primo login per email verificata e tengono tutto.
In Account nome ed email si vedono soltanto, con i link all'account della
suite e a "Chiavi e limiti AI"; restano qui avvisi, estensioni collegate e
italiano/inglese, con il gettext di Django anche nel frontend.

---

## Da soldino

Presi così come sono ([ADR 0001](docs/decisions/0001-stack-da-soldino.md)):

- **Auth JWT ibrida**: access token (15 min) in memoria, refresh (14 giorni) in
  cookie `httpOnly` su `/api/auth`, blacklist al logout, un
  solo refresh in volo nel client (`frontend/src/lib/api.ts`). Rate limit su
  login (`THROTTLE_AUTH`), sulle pagine condivise
  (`THROTTLE_SHARED`, 120/min per IP) e sulle foto (`THROTTLE_IMAGES`, 60/ora).
- **Mail** dal worker Celery dopo il commit, con retry, testo + HTML su un solo
  layout (`backend/templates/emails/`). In produzione SMTP di **Brevo, lo stesso
  account di cinemino e soldino** (mittente `messagg@inoo.it`).
- **Soft delete + audit**: `BaseModel` (UUID, `deleted_at`) e `django-simple-history`.
- **Material 3**: ruoli M3 mappati in Tailwind, Roboto Flex, Roboto Mono per i
  prezzi, Material Symbols Rounded. Rail su desktop, bottom bar e FAB sotto i
  768px, dialog di conferma M3 (`useConfirm()`), niente `window.confirm`.

Proprio di regalino ([ADR 0004](docs/decisions/0004-design-da-lista-regali.md)):
palette dal seed `#a8433f` (rosso ciliegia spento, solo sugli accenti) con
superfici neutre calde, oro per il nastro e un ruolo `success` per "preso";
i regali sono card in griglia con la foto o, se manca, un pacco disegnato
(`.wrap` / `GiftWrap`); la testata della lista ha il conto alla rovescia.
- **i18n**: italiano sorgente, inglese in `backend/locale/en/LC_MESSAGES/`.

Lasciati fuori perché qui non servono: tracker/membri, soldi e ripartizioni,
scan di scontrini, open banking, ordine personalizzato del menu.

---

## Struttura

```
backend/
├── config/settings/     base · dev · prod · test
├── config/sentry.py     errori verso GlitchTip, solo con SENTRY_DSN (ADR 0019)
└── apps/
    ├── core/            BaseModel, methods (token, hash, mail), i18n, task mail,
    │                    cornhub.py (client di login e AI, uguale in tutte le app)
    ├── users/           User custom, login con cornhub (sso.py), sessione JWT,
    │                    export_cornhub_users
    └── gifts/           WishList, Wish, GiftIdea, GiftImage, lista condivisa,
                         images.py (foto, rete), links.py (pagina del link), ai.py (AI via cornhub),
                         prices.py (andamento prezzo e avvisi), imports.py (import di liste)
scraper/                 Chromium headless (Playwright + FastAPI): POST /scrape {url}, guard.py
frontend/src/
├── api/hooks.ts         hook TanStack Query (e le claim_key in localStorage)
├── lib/                 client HTTP, auth, i18n, format (prezzi, date), tipi
├── components/          UI M3, layout, dialog di conferma, pezzi dei regali, animazioni
└── features/            lists · ideas · shared · auth · account
extension/               estensione Chrome (Manifest V3, senza build)
docs/decisions/          ADR
```

### API

| | |
|---|---|
| `GET /api/auth/sso/start?next=` · `sso/callback` | login con cornhub (OIDC + PKCE), poi di nuovo su `next` |
| `POST /api/auth/refresh` · `logout` | sessione (refresh nel cookie, controllo dell'account su cornhub); il logout risponde con l'uscita da cornhub |
| `GET /api/auth/config` · `GET/PATCH /api/me` | indirizzi di account e chiavi AI su cornhub · profilo dell'app (`notify_by`, lingua) |
| `GET /api/ai/quote?features=import_list:2` | chi paga e quanto una funzione AI (per `AiCost`) |
| `GET/POST /api/lists`, `GET/PATCH/DELETE /api/lists/{id}` | le mie liste (`included_list_ids` in scrittura, `included_lists` / `included_in` in lettura) |
| `POST /api/lists/{id}/regenerate-link` | link nuovo, il vecchio muore (solo il proprietario) |
| `POST/DELETE /api/lists/{id}/invite-link` | crea/rinnova o spegne il link d'invito |
| `DELETE /api/lists/{id}/members/{user_id}` | toglie un membro (proprietario) o se stessi |
| `GET /api/invites/{token}` · `POST /api/invites/{token}` | anteprima dell'invito ed entrata nella lista (serve il login) |
| `GET/POST /api/lists/{id}/items`, `…/items/{id}` | i regali di una lista (`quantity` 1–99, `requires_id` per "va con") |
| `DELETE /api/lists/{id}/items/{id}/gift` | togli spunta (solo con `show_gifted`) |
| `POST/DELETE /api/lists/{id}/items/{id}/watch` · `…/ideas/{id}/watch` · `…/shared/{token}/items/{id}/watch` | campanella (sul link serve il login) |
| `GET /api/notifications` · `POST /api/notifications` | avvisi (ultimi 50, non letti) · segna tutti letti |
| `GET/POST /api/ideas`, `…/ideas/{id}` (`?status=`, `?recipient=`) | Da regalare |
| `POST /api/ideas/suggest` · `POST /api/shared/{token}/suggest` `{item_id}` | idee regalo dall'AI (`suggest` / `shared_suggest`): wizard "Ispirami" e alternative a un regalo preso |
| `POST /api/images` (multipart `file`) · `POST /api/images/from-url` `{url}` | foto, poi `image_id` su regalo o idea |
| `POST /api/links/read` `{url, image}` | nome, prezzo, codice a barre, marca e foto dichiarati dalla pagina, subito, più `describe_id` |
| `POST /api/links/describe` `{describe_id}` | nome, prezzo e note dell'AI (`describe`) per la pagina appena letta (dopo, anche 30 s) |
| `POST /api/imports/read` `{url}` o multipart `file` · `GET /api/imports/read/{job_id}` | anteprima dell'import: un file subito (`{status: done, lists}`), un link nel worker (202 `{job_id}`, poi `reading` → `done`/`error`) |
| `POST /api/imports` `{lists, group_title}` | crea le liste dell'anteprima (sotto-liste = liste incluse; con `group_title` tutte dentro una lista nuova) |
| `GET/POST /api/extension/tokens`, `DELETE …/tokens/{id}` | chiavi dell'estensione (dall'app, col login): `POST` torna `key` una volta sola |
| `/api/extension/me` · `lists` · `read` `{url, html, images?, price?, currency?}` · `describe` · `lists/{id}/items` · `imports`, `imports/read[/{job_id}]` | per l'estensione, con `Authorization: Token <chiave>`: chi è collegato, le liste che scrive, la pagina aperta letta, il regalo aggiunto, l'import |
| `GET /api/shared/{token}` | lista condivisa, pubblica (`items` più `sections` delle liste incluse) |
| `POST/DELETE /api/shared/{token}/items/{id}/gift` | spunta / togli spunta (anche i regali delle liste incluse; 409 se "va con" un regalo non ancora preso) |

---

## Comandi

```bash
docker compose run --rm -e DJANGO_SETTINGS_MODULE=config.settings.test backend pytest
```

```bash
docker compose run --rm --no-deps backend ruff check apps config
```

```bash
docker compose run --rm --no-deps -v "$PWD/scraper:/app" scraper python -m pytest -q -p no:cacheprovider tests
```

```bash
docker compose run --rm --no-deps frontend sh -c "npx tsc -b && npx eslint src --ext .ts,.tsx"
```

```bash
docker compose run --rm --no-deps backend python manage.py createsuperuser
```

Traduzioni, come soldino: estrai, traduci in `backend/locale/en/LC_MESSAGES/*.po`,
ricompila e committa `.po` e `.mo`.

```bash
docker compose run --rm --no-deps backend python manage.py makemessages -l en -i staticfiles --no-obsolete
```

```bash
docker compose exec frontend npm run i18n:js
```

```bash
docker compose run --rm --no-deps -v "$PWD/frontend/.i18n:/i18n:ro" -w /i18n backend python /app/manage.py makemessages -d djangojs -l en -e js --no-location --no-obsolete
```

```bash
docker compose run --rm --no-deps backend python manage.py compilemessages -l en
```

---

## Deploy (produzione)

**https://regal.inoo.it** (dal 2026-11-03), sul homeserver accanto a soldino e
cinemino. Stesso schema: push sul branch `prod` → la GitHub
Action (`.github/workflows/prod.yml`) fa ruff, pytest, tsc ed eslint e pubblica
`regalino-backend:prod`, `regalino-web:prod` e `regalino-scraper:prod` su
ghcr.io → Watchtower (quello di cinemino) ricrea i container. Le migrazioni
girano all'avvio del backend. Watchtower aggiorna le immagini ma non aggiunge
servizi né reti: quando cambia `deploy/compose.prod.yaml` (es. l'arrivo dello
scraper) va ricopiato a mano in `~/regalino`, insieme a
`deploy/seccomp-chromium.json` (il profilo seccomp dello scraper, ADR 0017: se
manca il compose non parte), e poi `docker compose -f compose.prod.yaml up -d`.
Dopo: `docker compose -f compose.prod.yaml exec scraper python -c "import
urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read())"`
deve dire `"sandbox":true`.

Primo avvio sul server (già fatto):

1. DNS: record A `regal` → `104.167.28.163` (come `cinem` e `sold`);
2. `~/regalino/compose.prod.yaml` e `~/regalino/seccomp-chromium.json` (da
   `deploy/`) e `~/regalino/.env` (modello
   `deploy/.env.prod.example`, SMTP Brevo come soldino) — già fatto;
3. il blocco `regal.inoo.it` nel Caddyfile dell'edge, che sta nel repo
   [homeserver](https://github.com/ImBiagio/homeserver) (`edge/`) ed è
   applicato con `./deploy.sh edge`, che non ferma cinemino e soldino;
4. `git push origin main:prod`, poi `cd ~/regalino && docker compose -f
   compose.prod.yaml up -d` e `createsuperuser`.

**Errori** ([ADR 0019](docs/decisions/0019-errori-su-glitchtip.md)). Con
`SENTRY_DSN` nel `.env` le eccezioni non gestite di backend, worker, beat e
scraper arrivano a GlitchTip (SDK di Sentry), senza dati personali e senza
tracce; `SENTRY_ENVIRONMENT` è il nome dell'ambiente (default `production`).
Vuota: niente segnalazioni. Il frontend (`src/lib/sentry.ts`, `@sentry/react`)
manda i suoi errori a un progetto GlitchTip a parte: la DSN è la variabile del
repo `SENTRY_DSN_FRONTEND` su GitHub, passata alla build di `regalino-web`
(`VITE_SENTRY_DSN`); vuota, niente segnalazioni.

**cornhub** ([ADR 0020](docs/decisions/0020-cornhub.md)). Backend, worker e
beat stanno anche sulla rete Docker esterna `cornhub` (creata dal compose di
cornhub): da lì parlano con `http://cornhub-backend:8000` per token, stato
degli account e AI. Una volta sul server di cornhub: `manage.py register_app
regalino --name Regalino --url https://regal.inoo.it`, e client, secret e
token vanno nel `.env` (`CORNHUB_*`, modello `deploy/.env.prod.example`) e nel
vault. Gli utenti di prima si portano su cornhub con
`docker compose -f compose.prod.yaml exec -T backend python manage.py
export_cornhub_users > utenti.json` e `manage.py import_users utenti.json --app
regalino` su cornhub (il file ha gli hash delle password: si cancella dopo).
Il compose è cambiato (rete `cornhub`): va ricopiato a mano in `~/regalino`.

Backup notturni, entrambi a ogni avvio e poi ogni notte, sul disco del server:

- **Postgres** (servizio `backup`, come soldino) in `~/regalino/backups/{daily,weekly,monthly,last}`;
- **foto** (servizio `media-backup`): il volume `regalino_media` in tar.gz alle
  23:30 UTC, in `~/regalino/backups/media/{daily,weekly,last}` (7 giorni, 4
  settimane).

Restore delle foto, con lo stack fermo o almeno senza upload in corso:

```bash
docker run --rm -v regalino_media:/m -v ~/regalino/backups/media/last:/b:ro alpine sh -c "tar xzf /b/media-latest.tar.gz -C /m && chown -R 10001:10001 /m"
```

**Copia fuori dal server** (dal 2026-11-03): lo stack condiviso `~/offsite`
(sorgenti nel repo homeserver, `offsite/`) manda ogni notte alle 01:30 UTC le
cartelle `backups` di ogni app su Google Drive, cifrate con
rclone crypt. Chiavi, ripristino e controllo nel vault, nota "Backup offsite".

## Test

197 test backend (`pytest` + `factory-boy`): login con cornhub finto
(id_token firmati nel test: firma, state, nonce, redirect solo interni,
aggancio per email verificata, account spento che perde la sessione e la
chiave dell'estensione, logout verso cornhub), client AI di cornhub, export
degli utenti, lingue, isolamento fra utenti su liste, regali e idee, link condiviso (spunta, doppia
spunta → 409, togliere la spunta solo con la chiave o da loggato, proprietario
che non spunta e non vede), sorpresa, link rigenerato o lista eliminata che
spengono il link, regali eliminati che spariscono. Liste scritte insieme:
invito col link (serve il login, due volte non fa due membri, link spento o
rinnovato → 404), il membro scrive e invita ma non elimina, non rigenera e non
toglie gli altri, esce da solo, sul link pubblico è come il proprietario. Liste
incluse: sezioni sul link, spunta dal link della madre che vale anche su quello
della inclusa, un solo livello, solo liste proprie, chi scrive la lista inclusa
non ne spunta i regali dal link della madre, lista inclusa eliminata che
sparisce. Regali che vanno insieme: stessa lista, niente giri (anche a tre),
409 finché l'altro non è preso, poi 201, regalo madre eliminato che libera
l'altro. Quantità: default 1, 0 e 100 rifiutati, visibile sul link. Link lunghi
salvati puliti (Amazon → `/dp/ASIN`, via `utm_*`), fino a 2000 caratteri. Ispirami: cornhub finto che propone idee (quelle senza titolo si
scartano), prompt con interessi ed esclusioni, funzione e utente giusti,
503 senza AI, con risposta strana o con l'errore di cornhub (e il suo link),
alternative dal link senza account (`shared_suggest`, utente nullo) e senza
nomi nel prompt. Prezzi:
primo punto al salvataggio, punto nuovo solo se cambia, campanella sul link
(401 da ospite), sulla lista e sulle idee, prezzo sceso che avvisa nell'app o
per mail secondo `notify_by` (e non chi non ha la campanella), cosa si
rilegge di notte, avvisi letti, preferenza nel profilo. Foto: WebP ridotto senza
EXIF/GPS, file non immagine o troppo grandi rifiutati, foto altrui non
collegabili, `og:image` e JSON-LD, connessione all'IP verificato, indirizzi
non pubblici e redirect verso la LAN rifiutati (rete finta, nessuna richiesta
vera), pulizia delle orfane; ripiego sullo scraper quando il sito blocca o la
pagina è in JavaScript, stop davanti al captcha, foto dello scraper verso la LAN
rifiutate, errore diretto se lo scraper è giù. Dal link al form: dati dichiarati
(JSON-LD, meta, `#productTitle`), prezzi in tutti i formati (e niente prezzi in
altre valute), titoli ripuliti, browser quando manca il prezzo o il testo,
AI finta che scrive nome e note, prezzo dichiarato che vince, AI in
errore o quota finita che non blocca. Import: lista Amazon con le pagine successive (quantità,
note, foto, prezzo assente o in dollari), lista privata, pagina Elfster letta
col browser e AI finti (link e foto inventati scartati), profilo con più
liste solo dello stesso sito, `ItemList` senza AI, pagina già costruita
dall'estensione, CSV con `Natale > Libri`, JSON annidato, file rotti, liste
create con le incluse a un livello, tutto dentro una lista nuova, foto prese
dal worker. Estensione: chiave vista una volta e salvata come hash, valida solo
su `/api/extension/...`, tolta o sbagliata → 401, liste scrivibili, pagina
mandata dal browser letta senza riaprirla, regalo aggiunto con link pulito e
primo prezzo, solo nelle proprie liste, import; liste Amazon collegate (le
altre liste della persona) come sotto-liste. Lo scraper ha i suoi test delle
regole di rete (`scraper/tests`); il browser vero si prova a mano con un link
Amazon e uno IKEA.
