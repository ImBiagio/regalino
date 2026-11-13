# 0015 — Importare liste da Amazon, Elfster e da un file

Chi arriva a Regalino ha spesso già una lista altrove: la lista desideri di
Amazon, una wishlist Elfster, un foglio di calcolo. Riscriverla regalo per
regalo è il motivo per cui non si cambia app. Da "Le mie liste" → **Importa**
si incolla un link (anche più di uno) o si sceglie un file CSV/JSON; si vede
un'anteprima e si importano le liste scelte.

## Come si legge

- **Amazon** (`/hz/wishlist/ls/<id>`): la lista è HTML scritto dal server, con
  un `<li data-itemid>` per regalo. Un parser dedicato prende nome, link
  (ripulito a `/dp/<ASIN>`), prezzo (`data-price`, solo sulle Amazon in euro),
  quantità richiesta, commento e foto, e segue le pagine "mostra altro"
  (`showMoreUrl`, al massimo 15).
- **Elfster e le altre pagine**: Elfster costruisce la pagina con JavaScript, i
  dati non sono nell'HTML. La pagina si apre col browser dello scraper (nuova
  opzione `html`: scorre fino in fondo e restituisce l'HTML costruito) e
  Gemini legge una versione compatta della pagina — testo con `[testo](link)`
  e `![alt](foto)` — e restituisce titolo, regali e le altre liste collegate.
  Se la pagina dichiara una `ItemList` in JSON-LD basta quella, senza Gemini.
- **File**: CSV (colonne riconosciute in italiano e inglese: nome/title,
  link/url, prezzo/price, quantità/quantity, note/notes, lista/list) o JSON
  (`{"lists": [{"title", "items", "lists"}]}` o un elenco di regali).

## Liste dentro liste

Una sorgente può portare più liste: il profilo Elfster che elenca le sue
wishlist (si aprono anche quelle, al massimo 10, solo sullo stesso sito), il
JSON con `lists` annidate, la colonna `lista` del CSV con `Natale > Libri`.
All'import l'albero diventa liste incluse (ADR 0008), che hanno un solo
livello: i nipoti salgono a figli della lista in cima. In alternativa
"Mettile tutte dentro una lista nuova" crea una lista contenitore che le
include tutte. Una lista tolta nell'anteprima resta solo come contenitore delle
sotto-liste scelte; le liste rimaste vuote non si creano.

## Perché così

- **Niente API private dei siti.** Elfster ha un'API interna, ma non è
  pubblica né documentata: usarla sarebbe aggirare il sito. Si legge solo
  quello che vede una persona che apre il link, con le regole di rete dello
  scraper (ADR 0005); se il sito blocca o chiede un captcha ci si ferma e si
  suggerisce l'estensione (ADR 0016), che legge la pagina già aperta nel
  browser di chi importa.
- **Gemini per le pagine che non si conoscono**, come per i prodotti (ADR
  0006): un parser per sito si rompe al primo restyling, un LLM legge
  qualunque lista. Link e foto restituiti da Gemini si tengono solo se sono
  davvero nella pagina: quelli inventati si scartano.
- **Anteprima prima di salvare**: quello che si legge da un altro sito può
  essere sbagliato; l'utente vede e sceglie. Il server non salva niente finché
  non arriva la conferma (`POST /api/imports`, con l'albero dell'anteprima).
- **Lettura nel worker**: browser, scorrimento, Gemini e liste collegate
  possono superare il minuto. `POST /api/imports/read` restituisce un
  `job_id`, il worker scrive il risultato in cache (30 minuti, solo per chi
  l'ha chiesto) e il browser lo chiede ogni 2 secondi. I file invece si
  leggono subito.
- **Foto dopo**: i regali si creano subito; le foto le scarica il worker, una
  ogni 4 secondi, dal link della foto se il sito la mostra o dalla pagina del
  prodotto (le stesse difese SSRF di sempre).

## Limiti

20 liste e 300 regali per import, file fino a 2 MB, throttle `imports`
(20/ora). Le Amazon non in euro arrivano senza prezzo. Senza `GEMINI_API_KEY`
si importano Amazon, i file e le pagine con `ItemList` dichiarata, non Elfster.

**Quando rivederla:** se un sito offre un export o un'API pubblica (meglio di
Gemini), o se gli import diventano tanti da pesare su Gemini e scraper.
