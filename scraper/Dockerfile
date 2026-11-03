# Chromium e le sue librerie di sistema arrivano dall'immagine ufficiale di
# Playwright: stessa versione del pacchetto Python, browser gia' installati.
FROM mcr.microsoft.com/playwright/python:v1.49.1-noble

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY guard.py app.py ./

# pwuser e' l'utente senza privilegi che l'immagine prepara per il browser.
USER pwuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
