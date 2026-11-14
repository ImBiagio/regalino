# 0019 — Errori su GlitchTip (SDK di Sentry)

Finora un errore in produzione si vedeva solo se qualcuno guardava i log dei
container. Ora le eccezioni non gestite arrivano a **GlitchTip**, che parla il
protocollo di Sentry: si usa `sentry-sdk`, nel backend e nello scraper.

- **Acceso solo con `SENTRY_DSN`.** Vuota o assente: l'SDK non parte e non esce
  nessuna richiesta. `SENTRY_ENVIRONMENT` dà il nome dell'ambiente (default
  `production`).
- **Backend** (`backend/config/sentry.py`, chiamato dai settings `dev` e
  `prod`, mai da `test`): integrazione Django per le richieste e Celery per i
  task. Worker e beat caricano gli stessi settings, quindi segnalano anche loro.
- **Scraper** (`scraper/app.py`): solo le eccezioni non gestite. I 400 e 502
  che risponde apposta (link non ammesso, pagina non leggibile) non sono errori
  e non si mandano. Non legge il `.env`: la DSN gli arriva dal compose.
- **Niente dati personali.** `send_default_pii=False` (né utente, né IP, né
  cookie), mai il corpo delle richieste (`max_request_body_size="never"`) né le
  variabili locali dello stack (`include_local_variables=False`): lì dentro ci
  sono email, regali, link che uno sta guardando, il codice d'invito. Arrivano
  tipo dell'errore, messaggio, stack e indirizzo della richiesta.
- **Solo errori.** `traces_sample_rate=0` e niente sessioni: nessuna traccia
  delle prestazioni.
- **Solo lato server.** Nessun SDK nel frontend né nell'estensione.

**Costo accettato:** senza variabili locali un errore si capisce un po' meno;
se serve si riaccendono per un periodo. Il messaggio di un'eccezione può
contenere un dato (un link in un errore di rete): è il minimo per capire cosa
è successo. Se GlitchTip è giù l'SDK scarta gli eventi e l'app non se ne
accorge.
