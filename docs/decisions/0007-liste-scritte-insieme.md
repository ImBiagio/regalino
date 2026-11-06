# 0007 — Liste scritte da più utenti, con un link d'invito

Una lista può essere scritta da più persone: il proprietario (`WishList.owner`)
e i membri (`WishListMember`, uno per utente). Si entra con un link d'invito,
`/unisciti/<invite_token>`, che si apre da loggati: chi lo accetta vede la
lista tra le sue e fa tutto quello che fa il proprietario (regali, nome, data,
sorpresa, invitare altri), tranne eliminarla, rigenerare il link pubblico e
togliere gli altri. Un membro può uscire da solo. Il link d'invito non esiste
finché qualcuno non lo crea, si può spegnere e rinnovare (quello vecchio
smette di valere); chi è già dentro resta.

Sul link pubblico `/l/<share_token>` un membro è trattato come il proprietario:
non spunta i regali e, con la sorpresa accesa, non vede le spunte. Le liste
accessibili passano tutte da `WishList.for_user(user)`: proprie o con un
`WishListMember`.

**Perché un link e non l'email.** Le liste condivise nascono in coppia o in
famiglia ("la lista di nozze", "quella dei bambini"): il link si manda su
WhatsApp come il link pubblico, senza sapere con quale email l'altro si è
registrato e senza una mail da costruire. Si riusa lo stesso schema del
token al portatore già accettato per la condivisione (ADR 0002).

**Perché senza ruoli.** Chi scrive una lista insieme a me è un pari: un
"solo lettura" non serve a nessuno qui (per leggere c'è il link pubblico).
Il proprietario resta l'unico a poter eliminare e a togliere gli altri, così
una lista non sparisce per mano di chi è stato invitato.

**Perché serve l'account per entrare.** Un membro scrive e invita: senza un
nome e una sessione non si saprebbe chi ha fatto cosa, e un link al portatore
che dà scrittura a chiunque passa di lì sarebbe troppo. Per questo
`RequireAuth` rimanda al login con `?next=` e si torna sull'invito.

**Costo accettato:** il link d'invito è un segreto al portatore come il link
pubblico: chi lo inoltra fa entrare chi vuole. Rimedi: spegnerlo, rinnovarlo,
togliere chi è entrato. Due membri che modificano lo stesso regalo nello
stesso momento: vince l'ultimo che salva (le liste sono piccole, i campi
pochi).

**Quando rivederla:** se servono inviti per email con accettazione, o ruoli
(chi può solo aggiungere idee senza toccare il resto).
