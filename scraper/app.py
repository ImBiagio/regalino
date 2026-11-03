"""Scraper di Regalino: apre la pagina di un negozio con un browser vero (ADR 0005).

Molti negozi costruiscono la pagina con JavaScript o rispondono male a una
semplice richiesta HTTP: qui la pagina si apre in Chromium headless, come la
vedrebbe una persona, e se ne leggono foto e dati del prodotto (titolo,
descrizione, prezzo) e il testo, che il backend puo' far riassumere (ADR 0006). Il backend lo chiama solo quando la lettura diretta del
link non basta, e scarica lui la foto scelta.

Il browser si presenta per quello che e' (niente user agent finti, niente
trucchi anti-rilevamento): se il sito chiede un captcha o blocca, si risponde
``blocked`` e ci si ferma.

Sicurezza: ogni richiesta della pagina passa da ``Guard`` (solo indirizzi
pubblici); in piu' ogni risposta dice da che IP e' arrivata, e se una sola
viene da un indirizzo non pubblico (DNS rebinding) il risultato si butta.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from playwright.async_api import Browser, Page, Response, Route, WebSocketRoute, async_playwright
from playwright.async_api import Error as PlaywrightError
from pydantic import BaseModel

from guard import Guard, is_public_ip

# Tempo massimo per aprire la pagina; poi si legge quello che c'e'.
NAVIGATION_MS = int(os.environ.get("SCRAPER_NAVIGATION_MS", "15000"))
# Dopo il caricamento: il tempo per le foto caricate da JavaScript.
SETTLE_MS = int(os.environ.get("SCRAPER_SETTLE_MS", "1500"))
# Un browser per pagina costa ~150 MB: due alla volta bastano a una famiglia.
PAGES_AT_ONCE = asyncio.Semaphore(int(os.environ.get("SCRAPER_CONCURRENCY", "2")))
# Video e font non servono a trovare la foto: non si scaricano.
SKIPPED_RESOURCES = {"media", "font"}

# Legge la pagina gia' aperta. Le foto in ordine di affidabilita': quelle che
# il sito dichiara per le anteprime (og:image, JSON-LD), quella principale dei
# negozi tipo Amazon, poi le piu' grandi visibili in alto.
EXTRACT_JS = r"""
() => {
  const meta = (...keys) => {
    for (const key of keys) {
      const el = document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)
      if (el && el.content) return el.content.trim()
    }
    return null
  }
  const images = []
  const add = (src) => {
    if (typeof src !== 'string') return
    src = src.trim()
    if (!src || src.startsWith('data:')) return
    try { images.push(new URL(src, document.baseURI).href) } catch (e) {}
  }

  add(meta('og:image:secure_url', 'og:image'))
  add(meta('twitter:image', 'twitter:image:src'))

  let product = null
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const type = [].concat(node['@type'] || [])
    if (!product && type.includes('Product')) product = node
    const image = node.image
    ;[].concat(image || []).forEach((item) => add(typeof item === 'string' ? item : item && item.url))
    Object.values(node).forEach(walk)
  }
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try { walk(JSON.parse(script.textContent)) } catch (e) {}
  })

  // Amazon e simili: la foto grande sta in attributi della foto principale.
  const main = document.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront, #main-image')
  if (main) {
    add(main.getAttribute('data-old-hires'))
    try {
      const sizes = JSON.parse(main.getAttribute('data-a-dynamic-image') || '{}')
      const largest = Object.entries(sizes).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0]
      if (largest) add(largest[0])
    } catch (e) {}
    add(main.currentSrc || main.src)
  }

  // Le foto piu' grandi visibili nella parte alta della pagina.
  ;[...document.images]
    .map((img) => ({ img, box: img.getBoundingClientRect() }))
    .filter(({ img, box }) =>
      box.top < 1600 && box.width >= 150 && box.height >= 150 &&
      img.naturalWidth >= 200 && !(img.currentSrc || img.src).endsWith('.svg'))
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, 3)
    .forEach(({ img }) => add(img.currentSrc || img.src))

  // Il prezzo: dati dichiarati, poi quello visibile dei negozi tipo Amazon.
  const offers = product && [].concat(product.offers || [])[0]
  const offerPrice = offers && (offers.price || offers.lowPrice || (offers.priceSpecification || {}).price)
  const shown = (selector) => {
    const el = document.querySelector(selector)
    const value = el && (el.getAttribute('content') || el.textContent)
    return value ? value.trim() : null
  }
  const price =
    meta('product:price:amount', 'og:price:amount') ||
    (offerPrice != null && offerPrice !== '' ? String(offerPrice) : null) ||
    shown('[itemprop="price"]') ||
    shown('#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, ' +
          '.priceToPay .a-offscreen, #price_inside_buybox, #kindle-price')
  const heading = shown('#productTitle') || shown('h1')

  // Il testo della pagina, per chi lo riassume (ADR 0006): la parte del
  // prodotto se si riconosce, altrimenti tutta, senza spazi doppi.
  const area = document.querySelector('#ppd, #dp-container, main, [role="main"], article') || document.body
  const text = ((area && area.innerText) || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').slice(0, 12000)

  const blocked = Boolean(document.querySelector(
    'form[action*="captcha" i], #captchacharacters, iframe[src*="captcha" i], ' +
    '.g-recaptcha, .h-captcha, iframe[src*="challenges.cloudflare.com"]'
  ))
  return {
    blocked,
    title: meta('og:title') || (product && product.name) || heading || document.title || null,
    description: meta('og:description', 'description') || (product && product.description) || null,
    price,
    currency: meta('product:price:currency', 'og:price:currency') || (offers && offers.priceCurrency) || null,
    images: [...new Set(images)].slice(0, 8),
    text,
  }
}
"""


class ScrapeRequest(BaseModel):
    url: str


class ScrapeResult(BaseModel):
    url: str
    status: int | None
    blocked: bool
    title: str | None
    description: str | None
    price: str | None
    currency: str | None
    images: list[str]
    text: str = ""


state: dict[str, Browser] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with async_playwright() as playwright:
        # --disable-dev-shm-usage: /dev/shm dei container e' piccola (64 MB).
        state["browser"] = await playwright.chromium.launch(args=["--disable-dev-shm-usage"])
        yield
        await state["browser"].close()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": state["browser"].is_connected()}


@app.post("/scrape", response_model=ScrapeResult)
async def scrape(request: ScrapeRequest):
    guard = Guard()
    if not await asyncio.to_thread(guard.allows, request.url):
        raise HTTPException(400, "link non ammesso")
    async with PAGES_AT_ONCE:
        return await _scrape(request.url, guard)


async def _scrape(url: str, guard: Guard) -> ScrapeResult:
    context = await state["browser"].new_context(
        locale="it-IT",
        viewport={"width": 1280, "height": 900},
        # I service worker fanno richieste che il route non vede.
        service_workers="block",
        accept_downloads=False,
    )
    tainted = False

    async def check_request(route: Route):
        request = route.request
        if request.resource_type in SKIPPED_RESOURCES:
            await route.abort()
        elif await asyncio.to_thread(guard.allows, request.url):
            await route.continue_()
        else:
            await route.abort("blockedbyclient")

    async def check_websocket(socket: WebSocketRoute):
        if await asyncio.to_thread(guard.allows, socket.url):
            socket.connect_to_server()
        else:
            await socket.close()

    async def check_response(response: Response):
        nonlocal tainted
        try:
            server = await response.server_addr()
        except PlaywrightError:
            return
        if server and not is_public_ip(server["ipAddress"]):
            tainted = True

    try:
        await context.route("**/*", check_request)
        await context.route_web_socket("**/*", check_websocket)
        page: Page = await context.new_page()
        page.on("response", check_response)
        status = None
        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=NAVIGATION_MS)
            status = response.status if response else None
            await page.wait_for_load_state("load", timeout=NAVIGATION_MS)
        except PlaywrightError:
            # Pagina lenta o che non finisce mai di caricare: si legge quello che c'e'.
            pass
        await page.wait_for_timeout(SETTLE_MS)
        data = await page.evaluate(EXTRACT_JS)
        final_url = page.url
    except PlaywrightError as exc:
        raise HTTPException(502, f"pagina non leggibile: {exc.message[:200]}") from None
    finally:
        await context.close()

    if tainted:
        raise HTTPException(400, "la pagina ha raggiunto un indirizzo non pubblico")
    return ScrapeResult(url=final_url, status=status, **data)
