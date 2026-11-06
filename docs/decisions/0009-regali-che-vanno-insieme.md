# 0009 — Un regalo che "va con" un altro

Un regalo può dipendere da un altro della stessa lista (`Wish.requires`, FK su
se stesso): la custodia va con le cuffie, il secondo volume con il primo. Chi
ha il link lo vede sulla card ("Va con «Cuffie»") e può prenderlo solo dopo
che l'altro è stato preso: prima il bottone è spento ("Prima «Cuffie»") e il
server risponde 409 anche a chi prova lo stesso (`Wish.is_blocked`). Chi scrive
la lista lo sceglie dal form, in una tendina con gli altri regali.

**Regole.** Stessa lista, non se stesso, niente giri (A con B con A: il
serializer risale la catena, il form nasconde le scelte che farebbero un
giro). Catene lunghe vanno bene (cavo → custodia → cuffie). Se il regalo "madre"
viene eliminato (cancellazione logica) l'altro torna libero
(`Wish.required_gift` ignora i cancellati). Se a chi aveva preso le cuffie
viene tolta la spunta, la custodia già presa resta presa: non si disfa il
lavoro di un altro.

**Perché bloccare e non solo avvisare.** Il senso della dipendenza è non
ricevere la custodia senza le cuffie: un avviso che si può ignorare non lo
garantisce, e chi regala di fretta non legge. Il blocco è leggibile sulla card
e dura poco: appena qualcuno prende l'altro regalo, si sblocca.

**Perché una sola dipendenza per regalo.** "Va con uno" copre i casi reali
(accessorio, seguito, pezzo di un set); un insieme di prerequisiti avrebbe
chiesto un'altra tabella e una tendina multipla per una cosa che nessuno ha
chiesto.

**Costo accettato:** la dipendenza non attraversa le liste (una custodia nella
lista inclusa non può dipendere dalle cuffie della lista madre).

**Quando rivederla:** se servono più prerequisiti, o "va con" tra liste incluse.
