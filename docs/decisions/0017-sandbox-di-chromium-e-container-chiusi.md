# 0017 — Sandbox di Chromium e container chiusi

Lo scraper (ADR 0005) apre in Chromium pagine scelte dagli utenti: un link può
essere una pagina costruita apposta per colpire il browser. Le regole di rete
(`guard.py`) fermano le richieste verso la LAN, non un renderer compromesso.
Tre difese, una sopra l'altra.

**Chromium aggiornato.** Playwright si tiene alla stabile corrente (immagine
`mcr.microsoft.com/playwright/python` e pacchetto pip alla stessa versione:
1.65.2 dal 2026-11-14, era 1.49.1 di dicembre 2024, con un Chromium vecchio di
due anni). Va rialzato ogni pochi mesi: è un browser, le falle si chiudono solo
aggiornando.

**La sandbox di Chromium accesa.** Playwright di suo la spegne
(`chromium_sandbox=False`); `scraper/app.py` la accende. Senza root la sandbox
usa gli user namespace, che il profilo seccomp predefinito di Docker vieta:
`deploy/seccomp-chromium.json` è quel profilo (moby/profiles) più una sola
regola che lascia passare `clone`, `unshare`, `setns` e `chroot`, come il
profilo che Playwright pubblica per questo. È una porta in più nel seccomp del
solo scraper, in cambio della separazione fra le pagine e il resto del
processo: fuori dal namespace quelle chiamate restano vietate dal kernel,
perché il container non ha capability. Se il profilo manca o il kernel
dell'host nega gli user namespace, Chromium con la sandbox non parte: lo
scraper allora ripiega senza, lo scrive nei log, e `GET /health` risponde
`"sandbox": false`. Meglio un servizio che funziona e lo dice che uno giù.
`SCRAPER_CHROMIUM_SANDBOX=0` la spegne a mano.

**Container chiusi** (`deploy/compose.prod.yaml`). Su tutti i servizi
`no-new-privileges`. Sui servizi del progetto, che girano già senza root
(backend, worker, beat come `appuser`; scraper come `pwuser`), anche
`cap_drop: [ALL]`; lo scraper ha in più il filesystem in sola lettura con
`/tmp` in tmpfs. Postgres, Redis, Caddy e le immagini di backup partono da root
e cambiano utente da soli: lì le capability restano, togliendole non partono.
Ogni servizio ha un tetto di memoria (`mem_limit`), così uno che impazzisce non
porta giù soldino e cinemino sullo stesso server.

**Costo accettato:** un file in più da copiare sul server
(`seccomp-chromium.json`, accanto al compose); il profilo va riallineato a
quello di Docker ogni tanto (se resta indietro, al massimo nega una syscall
nuova). I `mem_limit` sono stime: se un servizio viene ucciso per memoria
(`OOMKilled`) si alza il suo.
