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

Con `.env.example` la verifica email è disattivata (`REQUIRE_EMAIL_VERIFICATION=0`):
ci si registra ed entra subito. Le mail finiscono nei log del worker:
`docker compose logs -f worker`. Il codice è montato come volume (hot reload);
dopo nuove migrazioni ricostruisci l'immagine: `docker compose build backend`.

---

## Cosa fa

**Le mie liste** (`/`, `/liste/:id`). Una lista ha nome, data facoltativa
(mostra quanto manca; le liste sono in ordine di data, la prossima in cima) e
due righe per chi la apre. I regali hanno titolo, link al negozio, prezzo
indicativo e note: si vedono come card in griglia, un tocco apre il form (dove
c'è anche "Elimina"), e in testa c'è il totale indicativo.

**Condivisione** (`/l/<token>`). Il link è un token casuale (`WishList.share_token`):
chi lo ha vede la lista **senza account** (quanti regali restano, filtri "Da
prendere" / "Tutti"), e tocca "Lo regalo io" lasciando il nome se vuole. Il regalo risulta preso per tutti. Rigenerare il link spegne
quello vecchio; eliminare la lista lo spegne del tutto.

**Scritta in due** ([ADR 0007](docs/decisions/0007-liste-scritte-insieme.md)).
Una lista si può scrivere con altri: dal riquadro "La scrivi solo tu" si crea
un link d'invito (`/unisciti/<token>`), chi lo apre con un account entra e
aggiunge e modifica i regali come il proprietario (e sul link pubblico, come
lui, non spunta e non vede le spunte). Solo il proprietario elimina la lista,
rigenera il link pubblico e toglie gli altri; un membro può uscire. Il link
d'invito si spegne e si rinnova.

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
restano da caricare a mano. Sulla lista condivisa la foto si tocca per vederla grande.

**Dal link al form** ([ADR 0006](docs/decisions/0006-dati-del-regalo-dal-link.md)).
Incollato il link, il form si compila da solo nei campi ancora liberi: nome,
prezzo, note e foto (sotto i campi compilati: "Dal link del negozio"). Quello
che si è scritto a mano non si tocca; se il link cambia, cambia anche quello
che aveva messo il link. Il server legge i dati che i negozi dichiarano
(`og:*`, JSON-LD, microdata) e, con `GEMINI_API_KEY`, fa leggere a Gemini il
testo della pagina per un nome corto, il prezzo e una nota con la variante:
funziona con qualsiasi negozio, non solo con quelli che dichiarano i dati. I
dati della pagina arrivano subito, quelli di Gemini dopo ("Miglioro nome e
note…"), senza toccare i campi che intanto si sono scritti.

**Da regalare** (`/da-regalare`). Idee per gli altri: per chi (testo libero,
con suggerimenti dai nomi già usati), cosa, occasione, prezzo, link, note e
stato `idea → comprato → regalato` (un tocco sulla pill passa al successivo).
Raggruppate per persona, con il totale; filtri Da fare / Idee / Comprati /
Regalati / Tutte. Private: le vede solo chi le scrive.

**Account e lingue**: come soldino. Registrazione, conferma email, password
dimenticata (link 2 ore, una volta sola), cambio password che chiude le altre
sessioni, nome, italiano/inglese con il gettext di Django anche nel frontend.

---

## Da soldino

Presi così come sono ([ADR 0001](docs/decisions/0001-stack-da-soldino.md)):

- **Auth JWT ibrida**: access token (15 min) in memoria, refresh (14 giorni) in
  cookie `httpOnly` su `/api/auth`, blacklist a logout e cambio password, un
  solo refresh in volo nel client (`frontend/src/lib/api.ts`). Rate limit su
  login/registrazione (`THROTTLE_AUTH`), sulle pagine condivise
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
scan con Gemini, open banking, ordine personalizzato del menu.

---

## Struttura

```
backend/
├── config/settings/     base · dev · prod · test
└── apps/
    ├── core/            BaseModel, methods (token, hash, mail), i18n, task mail
    ├── users/           User custom + auth JWT + mail dell'account
    └── gifts/           WishList, Wish, GiftIdea, GiftImage, lista condivisa,
                         images.py (foto, rete), links.py (pagina del link), ai.py (Gemini)
scraper/                 Chromium headless (Playwright + FastAPI): POST /scrape {url}, guard.py
frontend/src/
├── api/hooks.ts         hook TanStack Query (e le claim_key in localStorage)
├── lib/                 client HTTP, auth, i18n, format (prezzi, date), tipi
├── components/          UI M3, layout, dialog di conferma, pezzi dei regali
└── features/            lists · ideas · shared · auth · account
docs/decisions/          ADR
```

### API

| | |
|---|---|
| `GET/POST /api/lists`, `GET/PATCH/DELETE /api/lists/{id}` | le mie liste |
| `POST /api/lists/{id}/regenerate-link` | link nuovo, il vecchio muore (solo il proprietario) |
| `POST/DELETE /api/lists/{id}/invite-link` | crea/rinnova o spegne il link d'invito |
| `DELETE /api/lists/{id}/members/{user_id}` | toglie un membro (proprietario) o se stessi |
| `GET /api/invites/{token}` · `POST /api/invites/{token}` | anteprima dell'invito ed entrata nella lista (serve il login) |
| `GET/POST /api/lists/{id}/items`, `…/items/{id}` | i regali di una lista |
| `DELETE /api/lists/{id}/items/{id}/gift` | togli spunta (solo con `show_gifted`) |
| `GET/POST /api/ideas`, `…/ideas/{id}` (`?status=`, `?recipient=`) | Da regalare |
| `POST /api/images` (multipart `file`) · `POST /api/images/from-url` `{url}` | foto, poi `image_id` su regalo o idea |
| `POST /api/links/read` `{url, image}` | nome, prezzo e foto dichiarati dalla pagina, subito, più `describe_id` |
| `POST /api/links/describe` `{describe_id}` | nome, prezzo e note di Gemini per la pagina appena letta (dopo, anche 30 s) |
| `GET /api/shared/{token}` | lista condivisa, pubblica |
| `POST/DELETE /api/shared/{token}/items/{id}/gift` | spunta / togli spunta |

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
scraper) va ricopiato a mano in `~/regalino` e poi `docker compose -f
compose.prod.yaml up -d`.

Primo avvio sul server (già fatto):

1. DNS: record A `regal` → `104.167.28.163` (come `cinem` e `sold`);
2. `~/regalino/compose.prod.yaml` (da `deploy/`) e `~/regalino/.env` (modello
   `deploy/.env.prod.example`, SMTP Brevo come soldino) — già fatto;
3. il blocco `regal.inoo.it` del Caddyfile dell'edge (`deploy/edge/`, condiviso:
   è anche nel repo di soldino) copiato in `~/edge/` e ricaricato con
   `docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile`, che
   non ferma cinemino e soldino;
4. `git push origin main:prod`, poi `cd ~/regalino && docker compose -f
   compose.prod.yaml up -d` e `createsuperuser`.

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
(sorgenti in `soldino/deploy/offsite/`) manda ogni notte alle 01:30 UTC le
cartelle `backups` di cinemino, soldino e regalino su Google Drive, cifrate con
rclone crypt. Chiavi, ripristino e controllo nel vault, nota "Backup offsite".

## Test

110 test backend (`pytest` + `factory-boy`): mail dell'account e lingue (da soldino),
isolamento fra utenti su liste, regali e idee, link condiviso (spunta, doppia
spunta → 409, togliere la spunta solo con la chiave o da loggato, proprietario
che non spunta e non vede), sorpresa, link rigenerato o lista eliminata che
spengono il link, regali eliminati che spariscono. Liste scritte insieme:
invito col link (serve il login, due volte non fa due membri, link spento o
rinnovato → 404), il membro scrive e invita ma non elimina, non rigenera e non
toglie gli altri, esce da solo, sul link pubblico è come il proprietario. Foto: WebP ridotto senza
EXIF/GPS, file non immagine o troppo grandi rifiutati, foto altrui non
collegabili, `og:image` e JSON-LD, connessione all'IP verificato, indirizzi
non pubblici e redirect verso la LAN rifiutati (rete finta, nessuna richiesta
vera), pulizia delle orfane; ripiego sullo scraper quando il sito blocca o la
pagina è in JavaScript, stop davanti al captcha, foto dello scraper verso la LAN
rifiutate, errore diretto se lo scraper è giù. Dal link al form: dati dichiarati
(JSON-LD, meta, `#productTitle`), prezzi in tutti i formati (e niente prezzi in
altre valute), titoli ripuliti, browser quando manca il prezzo o il testo,
Gemini finto che scrive nome e note, prezzo dichiarato che vince, Gemini in
errore che non blocca. Lo scraper ha i suoi test delle
regole di rete (`scraper/tests`); il browser vero si prova a mano con un link
Amazon e uno IKEA.
