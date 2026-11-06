# 0008 — Una lista dentro un'altra

Una lista può includere altre liste (`WishList.included_lists`, through
`WishListInclusion`): i regali delle incluse compaiono anche sotto di lei,
nella sua pagina e nel suo link pubblico, in una sezione per lista. Le liste
incluse restano liste normali, con la loro pagina e il loro link; lo stesso
regalo è uno solo, quindi una spunta messa dal link della lista madre si vede
anche dal link della lista inclusa, e viceversa.

**Un solo livello.** Una lista che è dentro un'altra non può includere, e una
lista che include non si può includere. Così non esistono cicli né alberi da
percorrere, la pagina del proprietario e il link pubblico mostrano le stesse
cose senza ricorsione, e la regola si spiega in una frase. La stessa lista può
invece stare in più liste ("Libri" dentro "Compleanno" e "Natale").

**Chi può includere.** Si includono solo liste che si possono scrivere
(proprie o in cui si è membri, ADR 0007). Sul link della lista madre ogni
sezione ha i suoi "proprietari": chi scrive la lista inclusa non ne spunta i
regali e, con la sorpresa, non ne vede le spunte, anche se non c'entra con la
lista madre. La spunta passa dal link della madre ma vale sul regalo, quindi
le regole sono quelle della lista del regalo (`SharedGiftView._wish`).

**Perché un'inclusione e non un albero di sotto-liste.** Il caso tipico è
"la mia lista permanente dei libri" riusata a ogni occasione, o la lista di
nozze divisa in "Cucina" e "Viaggio": liste che hanno senso anche da sole. Una
sotto-lista che vive solo dentro la madre avrebbe chiesto un altro tipo di
oggetto; così invece è sempre una lista.

**Costo accettato:** i contatori sulla card ("3 regali") contano solo i
regali propri; il totale indicativo della pagina pure. Chi apre il link di
una lista inclusa non sa di quali liste madri fa parte.

**Quando rivederla:** se servono più livelli (allora `alive_children`
diventa ricorsiva con un insieme dei visitati e la validazione cerca i cicli)
o sezioni con un ordine scelto a mano.
