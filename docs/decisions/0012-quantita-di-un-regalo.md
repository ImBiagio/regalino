# 0012 — Quanti ne servono

Un regalo può chiederne più di uno (`Wish.quantity`, da 1 a 99, default 1):
sei bicchieri, tre copie dello stesso fumetto per tre nipoti. Il prezzo resta
quello del singolo pezzo; il totale della lista e quello sulla card sono
`price × quantity`, e la card dice "3 × 18,90 €" accanto al totale, anche sul
link condiviso. Nel form c'è un contatore (− e +) accanto al prezzo, con
"In tutto …" sotto quando il prezzo c'è.

**Una spunta sola per tutto l'insieme.** "Lo regalo io" prende tutti i pezzi:
chi spunta vede quanti ne servono e li compra tutti. Non si prende "2 su 6".

**Perché non spunte parziali.** Spuntare per pezzi vuol dire più spunte per
regalo (una tabella di claim, chiavi per ciascuna, il "togli la spunta" per
pezzo), la barra "quanti restano" che conta pezzi e non regali, e sul link la
domanda "quanti ne prendi?". È il regalo di gruppo con contributi, un'altra
funzionalità (è in "TODO e idee"); per "6 bicchieri" nessuno vuole riceverne 2
da uno e 4 da un altro. Il contatore qui risolve il caso vero (quanti, e
quanto costano in tutto) senza toccare la spunta.

**Perché il prezzo resta unitario.** È quello che si legge dal link e che il
task notturno rilegge (ADR 0011): la storia dei prezzi e la campanella
ragionano sul pezzo, e cambiare la quantità non deve sembrare un calo o un
rialzo.

**Costo accettato:** le idee "Da regalare" non hanno la quantità (nessuno
l'ha chiesta lì); il tetto 99 è arbitrario, oltre si scrive un regalo a parte.

**Quando rivederla:** se servono le spunte parziali o i contributi.
