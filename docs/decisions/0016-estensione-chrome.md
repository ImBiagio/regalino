# 0016 — Estensione Chrome: aggiungere un regalo dalla pagina del negozio

Come il bottone "Wish It!" di Elfster: si è sulla pagina di un prodotto, si
tocca l'icona di Regalino nella barra di Chrome e il regalo è già compilato
(nome, prezzo, foto, note di Gemini); si sceglie la lista e si aggiunge. Su una
lista desideri Amazon o una lista/profilo Elfster il popup propone invece di
importarla tutta (ADR 0015). La cartella è `extension/` (Manifest V3, niente
build: HTML, CSS e JS semplici).

## Come parla con l'API

- **Una chiave sua** (`ExtensionToken`), non il login dell'app. Il login
  dell'app è un cookie di refresh `httpOnly` sul dominio di Regalino più un JWT
  di 15 minuti in memoria: non si porta in un'estensione. La chiave è casuale,
  sul server ne resta solo l'hash (come le chiavi di spunta, ADR 0002), e vale
  **solo** per `/api/extension/...`: leggere una pagina, vedere le liste che si
  scrivono, aggiungere un regalo, importare. Non apre il resto dell'API (né
  idee, né account, né eliminare liste), quindi una chiave rubata fa poco
  danno; si scollega da Account.
- **Collegare senza copiare chiavi**: il popup apre `/estensione` sull'app; chi
  è entrato tocca "Collega", l'app crea la chiave e la passa all'estensione con
  `window.postMessage` sulla stessa origine. Il content script (`connect.js`)
  gira solo sulle pagine di Regalino, la salva in `chrome.storage.local` e
  risponde; se non risponde entro 4 secondi l'app cancella la chiave appena
  creata. Lo stesso content script segna la pagina (`data-regalino-extension`),
  così l'app sa se l'estensione c'è e altrimenti spiega come installarla.
- **La pagina la manda il browser**: il popup legge l'HTML della scheda attiva
  (permesso `activeTab`, solo quando lo si apre), senza script, stili e svg, e
  lo manda al server, che usa gli stessi parser del link (ADR 0006). È la
  pagina vera che vede l'utente: funziona anche dove il server trova un captcha
  (Zalando) o una pagina fatta in JavaScript. Se la pagina non dice niente il
  server rilegge il link come fa l'app. La foto la scarica comunque il server,
  con le difese SSRF.
- Per le liste il popup scorre la pagina fino in fondo prima di leggerla (le
  liste lunghe caricano scorrendo) e l'import lo segue il service worker, che
  sopravvive alla chiusura del popup; lo stato sta in `chrome.storage.session`.

## Perché così

- Il gesto conta: chi trova un regalo su un negozio non deve copiare il link,
  aprire Regalino, incollarlo e aspettare. Elfster lo fa così e funziona.
- La pagina nel browser dell'utente è più affidabile della lettura dal server
  (ADR 0005 resta il ripiego) e non serve aggirare niente.
- Permessi minimi: `activeTab` (nessun accesso alle pagine finché non si tocca
  l'icona), `scripting`, `storage`, e gli host di Regalino (prod e sviluppo).
- Testi dentro il DOM sempre come testo (`textContent`/`value`), mai come HTML:
  titoli e note vengono da pagine qualsiasi.

**Costo accettato:** per ora si installa a mano ("Carica estensione non
pacchettizzata"), niente Chrome Web Store: serve un account sviluppatore, una
privacy policy e la revisione. L'estensione parla solo con
`https://regal.inoo.it` (e `localhost` in sviluppo): un altro indirizzo va
aggiunto agli `host_permissions` del manifest.

**Quando rivederla:** se la usano altre persone (store), se serve anche Firefox
o Safari, o un menu contestuale "Aggiungi a Regalino" sulle immagini.
