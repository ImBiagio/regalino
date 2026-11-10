# 0013 — Animazioni brevi e un segno per l'AI

Il design di ADR 0004 era fermo: le cose comparivano di colpo e, mentre Gemini
lavorava (anche 20–30 secondi), si vedevano solo skeleton grigi uguali a quelli
di un caricamento qualsiasi. Si aggiunge un linguaggio di movimento piccolo,
solo CSS più due componenti, senza librerie:

- **Entrate**: card, liste e idee arrivano salendo un poco, in fila
  (`.stagger` sulle griglie, `.rise` con `--i` sulle idee). I dialog salgono
  dal basso sul telefono e si ingrandiscono appena da tablet in su.
- **Col mouse** le card si sollevano e il fiocco del pacco si muove
  (`.card-lift`), solo su dispositivi con hover.
- **Il segno dell'AI**: dove lavora o ha appena scritto Gemini c'è l'oro del
  nastro (tertiary) che scorre sul rosso. `AiThinking` (in
  `components/motion.tsx`) è un pacco col coperchio che salta, scintille e un
  messaggio che cambia ogni ~2 s ("Scarto i soliti calzini…"); `AiSkeleton`
  sono le righe in arrivo con la luce dorata. Nel form, il campo che il link o
  Gemini riempiono ha una passata di luce (`Field glow`, `.field-magic`) e il
  testo di supporto dice "Scritto dall'AI dal link del negozio".
- **Fatto!**: "Lo regalo io" lancia i coriandoli (`Confetti`) e il badge del
  regalo entra a scatto; "Aggiunta" delle idee ha la spunta che fa pop.

**Perché:** un'attesa lunga senza segni sembra un blocco; un messaggio che
cambia dice che sta succedendo qualcosa e quanto è "umano" il lavoro. Il segno
dorato separa ciò che scrive l'AI da ciò che legge la pagina o scrive
l'utente, senza un'altra etichetta. Le animazioni festeggiano solo i gesti
che contano (spuntare un regalo), così restano un premio e non rumore.

**Vincoli:** durate 200–450 ms con l'easing M3, solo `transform`/`opacity`
(niente layout), e `prefers-reduced-motion` le azzera tutte con la regola già
in `index.css` (restano gli stati finali). Nessuna dipendenza nuova.

**Costo accettato:** i dialog si animano solo in entrata (si smontano subito
alla chiusura); le idee arrivano tutte insieme dal server, l'effetto "una alla
volta" è solo visivo.
