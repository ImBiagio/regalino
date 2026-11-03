# 0006 — Nome, prezzo e note dal link, con Gemini

Quando nel form di un regalo (o di un'idea) si incolla un link, il frontend
chiama `POST /api/links/read` e compila da solo i campi **ancora liberi**:
nome, prezzo, note e foto. "Libero" vuol dire vuoto, o con il valore che ci
aveva messo il link di prima: se il link cambia cambiano anche quelli, ma
quello che l'utente ha scritto non si tocca mai. Sotto i campi compilati c'è
"Dal link del negozio". Col link già salvato (aprire un regalo per correggerlo)
non parte nulla.

**Come si legge la pagina.** La stessa strada della foto (ADR 0003, 0005):
lettura diretta, poi il browser dello scraper se il sito blocca, se mancano
foto o prezzo, o se con Gemini il testo letto direttamente è quasi vuoto
(pagina fatta in JavaScript). Dalla pagina si prendono i dati che i negozi
dichiarano secondo standard comuni (`og:*`, JSON-LD `Product`/`Offer`,
microdata `itemprop`), più il testo visibile; per Amazon, che non dichiara
quasi nulla, `#productTitle` e i prezzi del box d'acquisto.

**Gemini sopra.** I siti sono infiniti e i dati dichiarati non bastano: il
titolo di Amazon è una fila di parole chiave, il prezzo spesso sta solo nel
testo, e nessun negozio dichiara "la variante che conta per chi regala". Con
`GEMINI_API_KEY` il backend (`apps/gifts/ai.py`) manda a Gemini i dati
dichiarati e il testo della pagina (al massimo 8000 caratteri) e chiede, con
risposta vincolata a uno schema JSON: un nome corto, il prezzo del prodotto
principale, la valuta, una nota breve (variante, formato). Il prezzo
dichiarato vince su quello di Gemini: è quello del prodotto, non di un
consigliato accanto. Senza chiave, o se Gemini sbaglia o non risponde, restano
i dati dichiarati e le note vuote.

**Perché Gemini e non altro.** Modelli "flash" economici e veloci, chiave
gratuita da Google AI Studio, output JSON con schema. Il modello si cambia con
`GEMINI_MODEL` senza toccare il codice.

**Quale modello.** `gemini-3.5-flash-lite`. Provati il 2026-11-03 sugli stessi
link (due Amazon, due IKEA): flash-lite risponde in 1–2 secondi, sempre, e
scrive le note migliori (colore, misura, formato); `gemini-3.6-flash`,
`gemini-3.8-flash` e `gemini-flash-latest` davano spesso 503 ("troppa
richiesta") o 6–20 secondi, e note vuote. Su 503, 429 e 500 si riprova una
volta dopo un secondo.

**In due tempi.** Il giorno stesso, in produzione, anche flash-lite ci metteva
18–25 secondi (piano gratuito sotto carico, uguale dal Mac). Quindi
`links/read` risponde subito con i dati dichiarati e la foto, più un
`describe_id`; il form li applica e chiama `links/describe`, che riprende la
pagina dalla cache (Redis, 10 minuti, legata all'utente che l'ha letta) e
chiede a Gemini, con attesa massima 30 secondi. Quando arriva, la risposta va
negli stessi campi liberi: quelli toccati nel frattempo restano dell'utente.
Mentre aspetta il form mostra "Miglioro nome e note…" ma si può già salvare.
`links/describe` ha il suo limite (`links`, 60/ora), perché consuma la quota
della chiave.

**Sicurezza e privacy.**

- A Gemini va solo la pagina pubblica del negozio e il suo link, mai dati
  dell'utente o della lista. Col piano gratuito Google può usare i testi
  inviati per migliorare i suoi modelli: si accetta, sono pagine pubbliche.
- Il testo della pagina è di un sito qualsiasi: è un dato, non un ordine. Il
  prompt lo dice, la risposta è vincolata allo schema, le lunghezze sono
  tagliate e i valori vanno solo nel form, dove l'utente li vede prima di
  salvare.
- La chiave sta solo nel backend (`.env`), non nello scraper né nel frontend.
- Un prezzo in una valuta diversa dall'euro non si propone: l'app ragiona in
  euro.

**Costo accettato:** i dati della pagina arrivano in 1–20 secondi (lettura,
browser se serve), quelli di Gemini dopo, fino a 30 secondi in più. Il form
resta usabile intanto; una risposta arrivata dopo che il link è cambiato si
scarta.
