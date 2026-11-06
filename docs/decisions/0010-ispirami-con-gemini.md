# 0010 — "Ispirami": idee regalo da Gemini

In "Da regalare" c'è un wizard in tre passi (per chi · gusti e budget · idee):
chi è la persona (relazione, fascia d'età), cosa le piace (chip di interessi
più testo libero), cosa evitare, occasione, budget. Gemini (`ai.suggest_gifts`,
risposta vincolata a uno schema JSON) propone otto idee concrete, ognuna con
il perché, un prezzo indicativo e le parole per cercarla; ogni idea si
aggiunge a "Da regalare" con un tocco o si cerca nei negozi ("Dove trovarlo").
"Altre idee" richiede escludendo quelle già viste. Le risposte restano nel
browser, per persona (`localStorage`), così la volta dopo sono già lì.

Sul link condiviso, un regalo già preso da altri ha "Alternative": a Gemini
vanno i titoli dei regali della lista (il segnale dei gusti, già pubblici per
chi ha il link) e quello da sostituire. Funziona anche senza account.

**Perché Gemini qui.** È già in casa (ADR 0006), con lo stesso principio:
propone, l'utente decide; i testi dell'utente sono dati e non ordini, la
risposta è vincolata allo schema e tagliata, e va solo in un dialog dove si
sceglie cosa tenere.

**Privacy.** Al modello vanno solo le risposte del wizard e, per le
alternative, i titoli dei regali: mai email, nomi degli utenti, link privati.
Il nome del destinatario è quello scritto dall'utente ("Mamma", "Luca"):
serve al modello per il tono, e l'utente può lasciarlo vuoto.

**Perché le risposte stanno nel browser e non nel profilo.** Un profilo del
destinatario (interessi, data di nascita) sarebbe la cosa giusta anche per i
promemoria, ma è un altro pezzo di modello dati: prima si vede se il wizard
viene usato. Il costo è che da un altro dispositivo si risponde di nuovo.

**Quota.** Ogni chiamata consuma la chiave Gemini: limite `suggest` (30/ora
per utente o per IP, `THROTTLE_SUGGEST`), e sul link condiviso lo stesso
limite per IP. Senza chiave gli endpoint rispondono 503 e il frontend lo dice.

**Quando rivederla:** se le risposte devono seguire l'utente (profilo del
destinatario), o se servono idee "dalla lista" anche senza un regalo preso.
