# 0003 — Foto dei regali: caricate prima, WebP senza metadati, link letti con difesa SSRF

Una foto è un `GiftImage` a sé: si carica (`POST /api/images`) o si prende da un
link (`POST /api/images/from-url`) **prima** di salvare il regalo, così il form
mostra l'anteprima; poi `Wish` e `GiftIdea` la collegano con `image_id`. Ogni
immagine passa da `apps/gifts/images.process_image`: Pillow la apre (un file che
non è un'immagine viene rifiutato), la raddrizza secondo l'EXIF, la riduce a
1280 px di lato e la salva in WebP **senza metadati**. Dal link il server prende
un'immagine diretta oppure, da una pagina, `og:image` / `twitter:image` /
JSON-LD / `image_src`. Le foto non collegate o sostituite le cancella
`delete_orphan_images` (beat, 4:30, dopo 24 ore): è l'unico punto che toglie
file dal disco. In produzione i file stanno nel volume `media`, scritto dal
backend e servito dal Caddy di `web` su `/media/` con cache lunga.

**Perché:** caricare prima evita un form in due tempi ("salva, poi aggiungi la
foto"). I metadati vanno via perché una foto fatta in casa col telefono porta
le coordinate GPS, e la lista si condivide con un link. Il link è un URL scelto
dall'utente che il **server** va a leggere, dal homeserver da cui si
raggiungono router, LAN e i container accanto: un SSRF da manuale. Quindi solo
http/https sulle porte 80/443, niente credenziali nell'URL, il nome si risolve
e **ogni** indirizzo deve essere pubblico (`ipaddress.is_global`, anche gli IPv4
dentro IPv6), la connessione va proprio all'IP controllato (`sni_hostname` di
httpx e `Host` a mano, niente DNS rebinding fra controllo e connessione), i
redirect si seguono a mano ricontrollando tutto, con limiti di tempo e byte.
Scartato: servire le foto da una view Django con permessi (le liste condivise
sono pubbliche, e i nomi dei file sono UUID casuali non indovinabili).

**Costo accettato:** chi conosce l'URL di una foto la vede, anche quella di
un'idea "Da regalare" (privata): l'URL però non esce mai dall'account. Molti
negozi grandi (Amazon, Zalando, Decathlon) bloccano i bot con 403/503: lì si
carica la foto o si incolla il link diretto dell'immagine, e l'errore lo dice.
Il backup notturno copre solo Postgres, non il volume `media`.

**Quando rivederla:** se serve che le foto delle idee siano davvero private
(view con permessi o URL firmati), o se le foto diventano tante da servire una
CDN o uno storage S3.
