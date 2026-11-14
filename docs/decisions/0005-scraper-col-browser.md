# 0005 — Scraper col browser headless per le pagine dei negozi

Per prendere la foto da un link il backend prova prima la lettura diretta
(ADR 0003: una richiesta HTTP, poi `og:image` e simili). Se il sito non la dà
(errore, risposta anti-bot, pagina costruita in JavaScript, nessuna foto
dichiarata) chiede al servizio **`scraper`**: un container con Chromium
headless (Playwright, immagine ufficiale `mcr.microsoft.com/playwright/python`)
che apre la pagina come la vedrebbe una persona e legge, in ordine:
`og:image` / `twitter:image`, JSON-LD, la foto principale dei negozi tipo
Amazon (`#landingImage`), le foto più grandi visibili in alto. Risponde con le
foto candidate e già con titolo, descrizione e prezzo, che per ora l'app non
usa. La foto scelta la scarica comunque il backend con il suo `fetch`, quindi
con le stesse difese SSRF e la stessa elaborazione (WebP, niente metadati).

**Perché:** Amazon, il negozio più usato per le liste, risponde male alla
lettura diretta ma la pagina aperta in un browser ha la foto grande del
prodotto (1500 px). Un servizio a parte tiene Chromium (~400 MB di immagine,
~150 MB per pagina) fuori dall'immagine del backend, e lo si può isolare.

**Il browser si presenta per quello che è:** niente user agent finti, niente
plugin anti-rilevamento, nessun captcha risolto. Se la pagina mostra un
captcha lo scraper risponde `blocked` e l'utente vede il messaggio di caricare
la foto. Siti come Zalando (403 anche al browser) restano bloccati.

**Sicurezza.** Un browser che apre link scelti dagli utenti carica anche tutto
quello che la pagina chiede (script, fetch, websocket): dal homeserver
raggiungerebbe router, LAN e container. Quindi:

- ogni richiesta e websocket del browser passa da `scraper/guard.py`: solo
  http/https sulle porte 80/443, niente credenziali, il nome deve risolversi
  solo in IP pubblici; service worker bloccati;
- ogni risposta dice da che IP è arrivata (`server_addr`): se una sola viene
  da un indirizzo non pubblico (DNS rebinding fra controllo e connessione) il
  risultato si butta, così il contenuto di una pagina interna non torna mai
  indietro;
- il container sta su una rete Docker sua (`scraper`), condivisa solo con il
  backend: da lì non si vedono db, redis né la rete `edge`; in prod `mem_limit`
  1 GB e al massimo due pagine alla volta;
- i link rifiutati dal backend (indirizzo non pubblico, porta, credenziali)
  non arrivano allo scraper.
- Chromium aggiornato, con la sua sandbox accesa, in un container senza
  capability e in sola lettura: [ADR 0017](0017-sandbox-di-chromium-e-container-chiusi.md).

**Costo accettato:** il rebinding può ancora far partire una richiesta GET
"alla cieca" verso la LAN (la risposta non esce). La foto dal browser arriva
in 4–8 secondi invece di 1. Se lo scraper è giù l'utente vede l'errore della
lettura diretta, come prima. Scartato: aggirare i blocchi con intestazioni da
browser o da bot di anteprima (vedi ADR 0003) e servizi esterni di anteprima
(i link degli utenti uscirebbero verso terzi).
