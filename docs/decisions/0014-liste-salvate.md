# 0014 — Liste salvate: le liste degli altri, ritrovate nella propria area

Chi riceve il link di una lista (`/l/<token>`) lo ritrovava solo cercando il
messaggio su WhatsApp. Sul link condiviso, da loggati, c'è **"Salva lista"**:
la lista compare in "Le mie liste", in una sezione **"Liste salvate"**, con il
proprietario, la data, quanto manca e quanti regali restano da prendere.

- Modello `SavedList(user, wish_list, share_token, title)`, unico per utente e
  lista. Endpoint: `POST`/`DELETE /api/shared/<token>/save`,
  `GET /api/saved-lists`, `DELETE /api/saved-lists/<id>`; il link condiviso dice
  `saved` a chi guarda.
- Si salva **il token con cui la si è aperta**, non solo la lista. Se il
  proprietario rigenera il link o elimina la lista, la lista salvata resta col
  titolo copiato ma non si apre più ("Il link non vale più: chiedine uno
  nuovo") e si può togliere.
- Serve un account (da sloggati si propone il login, come per la
  campanella). Chi scrive la lista (proprietario o membro) non la salva: la
  trova già tra le sue (400).
- I conteggi sono quelli che vede chi ha il link: regali della lista e delle
  liste incluse (ADR 0008).

**Perché:** "Liste che seguo" era tra le idee; salvare a mano è più chiaro che
ricordare in automatico ogni link aperto (chi apre una lista per curiosità non
se la ritrova in casa). Salvare il token, e non solo la lista, tiene vero quello
che promette "Rigenera link" (ADR 0002 e README): il link vecchio si spegne per
tutti, anche per chi l'aveva salvato.

**Costo accettato:** dopo una rigenerazione chi aveva salvato la lista deve
farsi mandare il link nuovo e salvarla di nuovo. Il proprietario non sa chi ha
salvato la sua lista (non serve, e sarebbe un'informazione su chi regala).
