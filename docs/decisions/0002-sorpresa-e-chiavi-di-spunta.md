# 0002 — Sorpresa di default e chiavi per togliere la spunta

`WishList.show_gifted` è falso di default: il proprietario non vede le spunte
(`WishSerializer.gifted` è `null`), nemmeno aprendo il proprio link
(`SharedWishSerializer` con `hide_gifted`), e lì non può spuntare. Chi spunta
riceve una `claim_key` casuale; sul server resta solo lo sha256
(`Wish.claim_key_hash`, escluso dalla history) e solo con quella chiave, o da
utente loggato che ha spuntato (`Wish.gifted_by`), si toglie la spunta.

**Perché:** una lista regali che rivela cosa arriverà rovina la sorpresa; chi
vuole saperlo lo accende. Senza una chiave, chiunque abbia il link potrebbe
togliere le spunte degli altri; con gli account obbligatori nessuno spunterebbe.

**Costo accettato:** chi spunta da ospite e cancella i dati del browser (o usa
un altro telefono) non può più togliere la sua spunta da solo: deve chiederlo
al proprietario, che però deve prima accendere `show_gifted`. Il link è un
segreto al portatore: chi lo inoltra lo dà a chiunque.

**Quando rivederla:** se servono liste con regali a quantità (es. "6 bicchieri")
o contributi parziali a un regalo grosso: una spunta per regalo non basta più.
