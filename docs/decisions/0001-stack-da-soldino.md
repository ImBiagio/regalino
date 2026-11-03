# 0001 — Stack e fondamenta copiati da soldino

Regalino parte da una copia di soldino: Django + DRF + Postgres + Celery/Redis,
React/Vite con Tailwind e token Material 3, auth JWT con refresh in cookie
`httpOnly`, mail via Celery e SMTP Brevo (stesso account di cinemino e soldino),
gettext italiano/inglese, deploy con GitHub Action → ghcr.io → Watchtower e
proxy edge condiviso. Tolto tutto il dominio di soldino (tracker, soldi, scan,
banca, ordine del menu).

**Perché:** le fondamenta di soldino sono già provate in produzione sullo stesso
server; una base diversa vorrebbe dire due modi di fare auth, mail e deploy da
mantenere. Il menu riordinabile non serve con tre sezioni.

**Costo accettato:** Celery, Redis e beat girano anche se oggi servono solo per
mail e pulizia dei token: tre container in più per un'app piccola. I fix alle
parti comuni vanno portati a mano fra i progetti (sono copie, non una libreria).

**Quando rivederla:** se le parti comuni divergono spesso, estrarle in un
pacchetto condiviso.
