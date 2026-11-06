# 0011 — Andamento del prezzo, campanella e avvisi

Ogni regalo e ogni idea con un link hanno una storia dei prezzi
(`PricePoint`): il primo punto è il prezzo con cui entrano in lista, gli altri
li scrive un task notturno (`check_prices`, alle 2:30) che rilegge la pagina
del link con la stessa lettura dell'ADR 0006 (dati dichiarati, browser dello
scraper se serve, niente Gemini) e aggiunge un punto solo se il prezzo è
cambiato. Sulla card compare una linea con quanto è cambiato dal primo punto
("−17% da quando è in lista"), solo quando i punti sono almeno due.

**La campanella** (`PriceWatch`): chi vuole sapere quando il prezzo scende la
mette sul regalo, dalla propria lista, dal link condiviso (serve un account:
l'avviso va a qualcuno) o su un'idea di "Da regalare". Quando il task trova un
prezzo più basso dell'ultimo, ogni campanella riceve un avviso nell'app
(`Notification`, voce "Avvisi" col contatore dei non letti), una mail (Brevo,
dal worker) o entrambi: lo sceglie l'utente in Account (`User.notify_by`,
default entrambi).

**Perché solo a chi mette la campanella.** Un avviso non chiesto è rumore,
specie per il proprietario, che il suo regalo non lo compra. Chi compra sa di
voler aspettare lo sconto e lo dice con un tocco.

**Perché un tetto e una pausa.** Lo scraper sul server impiega 10–20 secondi
su Amazon e i negozi non vanno martellati: `PRICE_CHECKS_PER_NIGHT` pagine a
notte (80), una ogni `PRICE_CHECK_GAP` secondi (90), prima quelle mai lette o
lette da più tempo; si saltano i regali già presi, le liste con la data
passata e le idee già comprate o regalate. Nessuna intestazione finta (ADR
0003): un sito che blocca resta senza punto quella notte.

**Perché non Keepa.** Keepa è un servizio a pagamento solo per Amazon; qui i
link sono di qualsiasi negozio e la lettura della pagina c'è già. Se i volumi
crescessero, per Amazon la strada è PA-API, non più scraping.

**Costo accettato:** i prezzi letti sono quelli visti dal server (paese,
spedizione) e possono differire da quelli dell'utente; una mail lo dice. Le
foto e i prezzi delle pagine sono dati pubblici: il task non manda nulla
dell'utente.

**Quando rivederla:** se servono soglie ("sotto 50 €"), avvisi anche per
rialzi o disponibilità, o notifiche push.
