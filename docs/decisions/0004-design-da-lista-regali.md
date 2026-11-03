# 0004 — Design da lista regali: rosso spento, superfici neutre, card col pacco

L'interfaccia resta Material 3 (ruoli di colore, scala tipografica, state
layer, rail / bottom bar, FAB, bottom sheet), ma si presenta come una lista
regali e non come un elenco di righe:

- **Palette**: seed `#a8433f` (rosso ciliegia spento) al posto del lampone
  `#b3264f`. Il primary `#9b403d` si usa solo per accenti e azioni principali;
  superfici neutre calde (`#fdf9f7`, i container scalano verso il grigio caldo)
  e secondary quasi grigio, così chip, selezioni e indicatori della barra non
  diventano altre macchie rosa. Tertiary oro (il nastro) per gli accenti non
  d'azione, e un ruolo `success` verde, fuori dallo schema base, per "preso /
  regalato".
- **Il pacco** (`.wrap` in `index.css`, `GiftWrap` in `components/gift.tsx`):
  carta tenue, nastro a croce e fiocco, in quattro abbinamenti scelti dall'id.
  Sostituisce la foto mancante e fa da testata alle card delle liste e alle
  pagine di accesso.
- **Card regalo** (`GiftCard`) in griglia, due colonne già sul telefono, come
  un catalogo o una lista nozze: foto 4:3 in alto, titolo, prezzo, negozio,
  e in fondo l'azione di chi guarda. "Lo regalo io" è un bottone tonale sul
  primary: una fila di bottoni pieni rossi gridava troppo.
- **Testata della lista** (`ListHero`), uguale per il proprietario e per chi ha
  il link: nome grande, data, cartellino con i giorni che mancano (accanto alla
  data sul telefono).
- **Pagina condivisa**: quanti regali restano con una barra di avanzamento e i
  filtri "Da prendere / Tutti" (nei "da prendere" restano anche i propri, per
  poterli annullare).
- **Proprietario**: la sorpresa si cambia dall'interruttore sotto la testata,
  con conferma solo quando la si spegne; eliminare un regalo sta nel form del
  regalo, così la card ha un solo gesto (tocca e modifica).

**Perché:** l'app è una lista di regali da sfogliare, non un gestionale: le foto
e i "pacchi" fanno riconoscere i regali a colpo d'occhio, e chi apre il link
deve capire subito cosa resta da prendere. Il rosso piace ma su ampie superfici
stanca: per questo resta sugli accenti e il resto è neutro.

**Costo accettato:** le card occupano più spazio delle righe (meno regali per
schermata) e l'eliminazione costa un tocco in più. Le icone PNG del manifest
(`icon-*.png`, `apple-touch-icon.png`, `favicon*`) sono ancora nel lampone
vecchio: gli SVG del logo sono già nel rosso nuovo.
