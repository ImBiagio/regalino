# Estensione Chrome di Regalino

Aggiunge un regalo alla lista dalla pagina del negozio, o importa una lista
desideri Amazon / una lista o un profilo Elfster interi. Perché è fatta così:
[ADR 0016](../docs/decisions/0016-estensione-chrome.md).

## Installare

1. In Chrome apri `chrome://extensions` e accendi **Modalità sviluppatore**.
2. **Carica estensione non pacchettizzata** → scegli questa cartella
   (`extension/`).
3. Tocca l'icona di Regalino → **Collega a Regalino**: si apre l'app, entra e
   tocca **Collega l'estensione**.

In sviluppo, nel popup "Un altro indirizzo" → `http://localhost:5176` (l'API
`http://localhost:8020` è già tra gli `host_permissions`). Dopo una modifica ai
file: ↻ sulla card dell'estensione in `chrome://extensions`.

## File

| | |
|---|---|
| `manifest.json` | Manifest V3: `activeTab`, `scripting`, `storage`, host di Regalino |
| `popup.html/.css/.js` | il popup: regalo compilato dalla pagina, scelta della lista, import |
| `background.js` | service worker: segue la lettura delle liste da importare (minuti) |
| `api.js` | chiamate a `/api/extension/...` con `Authorization: Token <chiave>` |
| `connect.js` | content script solo sulle pagine di Regalino: riceve la chiave da `/estensione` |

Le icone sono copie di quelle dell'app (`frontend/public`).
