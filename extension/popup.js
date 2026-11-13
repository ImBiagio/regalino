// Il popup dell'estensione (ADR 0016): sulla pagina di un prodotto propone il
// regalo gia' compilato (nome, prezzo, foto) e lo aggiunge alla lista scelta;
// su una lista Amazon o Elfster propone di importarla tutta (ADR 0015).
//
// Tutto il testo che arriva dalle pagine o dal server va nel DOM con
// textContent / value, mai come HTML.

import { NotConnected, PRODUCTION_APP, call, disconnect, getConfig, isListPage } from './api.js'

const view = document.getElementById('view')

/* ------------------------------------------------------------- DOM -- */

/** Un elemento con attributi e figli: stringhe come testo, mai come HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'class') el.className = value
    else if (key in el && key !== 'list') el[key] = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

function show(...nodes) {
  view.replaceChildren(...nodes)
}

function errorBox(message) {
  return h('p', { class: 'error', role: 'alert' }, message)
}

function thinking(lines) {
  const text = h('p', { class: 'ai' }, lines[0])
  let index = 0
  const timer = setInterval(() => {
    index = Math.min(index + 1, lines.length - 1)
    text.textContent = lines[index]
    if (index === lines.length - 1) clearInterval(timer)
  }, 2200)
  return h('div', { class: 'thinking', role: 'status' }, h('div', { class: 'gift' }), text)
}

/* ----------------------------------------------------------- prezzi -- */

/** "1.299,90 €" o "24.9" → "1299.90"; vuoto o strano → null. */
function toDecimal(text) {
  let value = String(text || '').replace(/[€\s]/g, '')
  if (!value) return null
  if (value.includes(',') && value.includes('.')) {
    value = value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '')
  } else {
    value = value.replace(',', '.')
  }
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number.toFixed(2) : null
}

const euro = (value) =>
  value === null || value === undefined || value === ''
    ? ''
    : Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ------------------------------------------------- pagina del browser -- */

/** Gira nella pagina: l'HTML senza script, stili e svg (da MB a qualche centinaio di KB). */
function capturePage(scroll) {
  const grab = () => {
    const clone = document.documentElement.cloneNode(true)
    clone
      .querySelectorAll(
        'script:not([type="application/ld+json"]), style, svg, noscript, iframe, link, template, video, canvas',
      )
      .forEach((node) => node.remove())
    let html = '<!doctype html>' + clone.outerHTML
    if (html.length > 2_500_000) html = html.slice(0, 2_500_000)
    return { url: location.href, title: document.title, html }
  }
  if (!scroll) return grab()
  // Le liste lunghe caricano scorrendo: si va in fondo finche' la pagina cresce.
  return new Promise((resolve) => {
    let height = 0
    let rounds = 0
    const step = () => {
      const now = document.body ? document.body.scrollHeight : 0
      if (now <= height || rounds >= 15) {
        window.scrollTo(0, 0)
        resolve(grab())
        return
      }
      height = now
      rounds += 1
      window.scrollTo(0, now)
      setTimeout(step, 800)
    }
    step()
  })
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function readTab(tab, scroll = false) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: capturePage,
    args: [scroll],
  })
  return result.result
}

/* --------------------------------------------------------- collegare -- */

function renderConnect(message) {
  const server = h('input', { type: 'url', value: PRODUCTION_APP, 'aria-label': 'Indirizzo di Regalino' })
  const details = h(
    'details',
    {},
    h('summary', { class: 'muted small' }, 'Un altro indirizzo (sviluppo)'),
    h('label', { class: 'field' }, 'Indirizzo dell’app', server),
  )
  show(
    h('h1', {}, 'Collega Regalino'),
    message ? errorBox(message) : null,
    h(
      'p',
      { class: 'muted' },
      'Si apre Regalino: entra col tuo account e tocca “Collega l’estensione”. Poi torna qui, su un prodotto o una lista.',
    ),
    details,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'filled',
          type: 'button',
          onclick: () => {
            const app = server.value.trim().replace(/\/+$/, '') || PRODUCTION_APP
            chrome.tabs.create({ url: `${app}/estensione` })
            window.close()
          },
        },
        'Collega a Regalino',
      ),
    ),
  )
}

/* ----------------------------------------------------- un regalo solo -- */

async function renderProduct(tab, config, { fromList } = {}) {
  show(thinking(['Leggo la pagina…', 'Cerco nome, prezzo e foto…']))
  let page
  try {
    page = await readTab(tab)
  } catch {
    show(
      errorBox('Questa pagina non si può leggere (pagine di Chrome, del Web Store o PDF).'),
    )
    return
  }
  let details
  let lists
  try {
    ;[details, lists] = await Promise.all([
      call('/api/extension/read', { method: 'POST', body: { url: page.url, html: page.html } }),
      call('/api/extension/lists'),
    ])
  } catch (error) {
    if (error instanceof NotConnected) return renderConnect('L’estensione è stata scollegata.')
    show(errorBox(error.message))
    return
  }

  const touched = new Set()
  const mark = (name) => () => touched.add(name)
  const title = h('input', { value: details.title || page.title || '', maxLength: 160, oninput: mark('title'), required: true })
  const price = h('input', { value: euro(details.price), inputMode: 'decimal', placeholder: '0,00', oninput: mark('price') })
  const quantity = h('input', { type: 'number', min: 1, max: 99, value: 1 })
  const notes = h('textarea', { value: details.notes || '', maxLength: 1000, oninput: mark('notes'), placeholder: 'Taglia, colore, versione…' })
  const { lastListId } = await chrome.storage.local.get('lastListId')
  const select = h(
    'select',
    { 'aria-label': 'Lista' },
    lists.map((list) =>
      h('option', { value: list.id, selected: list.id === lastListId }, `${list.title} (${list.item_count})`),
    ),
  )
  const status = h('p', { class: 'small muted' })
  const errorSlot = h('div')
  const add = h('button', { class: 'filled', type: 'submit' }, 'Aggiungi alla lista')
  const photo = details.image
    ? h('img', { src: `${config.api}${details.image.url}`, alt: '' })
    : h('div', { class: 'wrap', title: details.image_error || '' })

  const step = (delta) => () => {
    quantity.value = String(Math.min(99, Math.max(1, Number(quantity.value || 1) + delta)))
  }

  const form = h(
    'form',
    {
      class: 'grid',
      style: 'display:grid;gap:12px',
      onsubmit: async (event) => {
        event.preventDefault()
        errorSlot.replaceChildren()
        add.disabled = true
        const listId = select.value
        try {
          const wish = await call(`/api/extension/lists/${listId}/items`, {
            method: 'POST',
            body: {
              title: title.value.trim(),
              url: page.url,
              price: toDecimal(price.value),
              quantity: Number(quantity.value || 1),
              notes: notes.value.trim(),
              image_id: details.image ? details.image.id : null,
              gtin: details.gtin || '',
              brand: details.brand || '',
            },
          })
          await chrome.storage.local.set({ lastListId: listId })
          renderAdded(config, listId, wish)
        } catch (error) {
          if (error instanceof NotConnected) return renderConnect('L’estensione è stata scollegata.')
          add.disabled = false
          errorSlot.replaceChildren(errorBox(error.message))
        }
      },
    },
    h('div', { class: 'photo' }, photo, h('label', { class: 'field', style: 'flex:1' }, 'Nome del regalo', title)),
    h(
      'div',
      { class: 'row' },
      h('label', { class: 'field' }, 'Prezzo (€)', price),
      h(
        'div',
        { class: 'qty' },
        h('button', { class: 'round', type: 'button', onclick: step(-1), 'aria-label': 'Uno in meno' }, '−'),
        quantity,
        h('button', { class: 'round', type: 'button', onclick: step(1), 'aria-label': 'Uno in più' }, '+'),
      ),
    ),
    h('label', { class: 'field' }, 'Note per chi regala', notes),
    lists.length
      ? h('label', { class: 'field' }, 'In quale lista', select)
      : h('p', { class: 'card hint' }, 'Non hai ancora liste: creane una in Regalino e torna qui.'),
    status,
    errorSlot,
    h(
      'div',
      { class: 'actions' },
      isListPage(page.url) && !fromList
        ? h('button', { class: 'text grow', type: 'button', onclick: () => renderImportStart(tab) }, 'Importa la lista')
        : null,
      add,
    ),
  )
  add.disabled = !lists.length
  show(form)

  // Gemini scrive nome e note migliori dopo (ADR 0006): solo nei campi non toccati.
  if (details.describe_id) {
    status.replaceChildren(h('span', { class: 'ai' }, 'Miglioro nome e note…'))
    try {
      const better = await call('/api/extension/describe', {
        method: 'POST',
        body: { describe_id: details.describe_id },
      })
      const fill = (name, input, value) => {
        if (!value || touched.has(name) || input.value === value) return
        input.value = value
        input.classList.remove('glow')
        void input.offsetWidth
        input.classList.add('glow')
      }
      fill('title', title, better.title)
      fill('notes', notes, better.notes)
      if (!price.value) fill('price', price, euro(better.price))
    } catch {
      // Senza Gemini restano i dati della pagina: va bene lo stesso.
    }
    status.replaceChildren()
  }
}

function renderAdded(config, listId, wish) {
  show(
    h('p', { class: 'ok' }, '✓ Aggiunto'),
    h('p', {}, `«${wish.title}» è nella lista «${wish.list_title}».`),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'text', type: 'button', onclick: () => window.close() }, 'Chiudi'),
      h(
        'button',
        {
          class: 'tonal',
          type: 'button',
          onclick: () => chrome.tabs.create({ url: `${config.app}/liste/${listId}` }),
        },
        'Apri la lista',
      ),
    ),
  )
}

/* ------------------------------------------------------ lista intera -- */

const READING_LINES = [
  'Leggo la lista…',
  'Leggo nomi, prezzi e foto…',
  'Cerco le altre liste collegate…',
  'Incarto tutto…',
]

async function renderImportStart(tab) {
  show(thinking(['Scorro fino all’ultimo regalo…', ...READING_LINES]))
  let page
  try {
    page = await readTab(tab, true)
  } catch {
    show(errorBox('Questa pagina non si può leggere.'))
    return
  }
  await chrome.runtime.sendMessage({ type: 'import:start', url: page.url, html: page.html })
}

function countItems(lists) {
  return lists.reduce((total, list) => total + list.items.length + countItems(list.lists), 0)
}

function renderImportPreview(config, job) {
  // Una riga per lista con regali, le sotto-liste rientrate (diventano liste incluse).
  const rows = []
  const walk = (lists, depth) => {
    for (const list of lists) {
      // Una lista senza regali suoi (il profilo con piu' liste) e' solo un contenitore.
      rows.push({ list, depth, container: !list.items.length })
      walk(list.lists, depth + 1)
    }
  }
  walk(job.lists, 0)
  const skipped = new Set()
  const total = h('span')
  const button = h('button', { class: 'filled', type: 'button' }, total)
  const refresh = () => {
    const count = rows
      .filter((row) => !skipped.has(row.list))
      .reduce((n, row) => n + row.list.items.length, 0)
    total.textContent = `Importa ${count} ${count === 1 ? 'regalo' : 'regali'}`
    button.disabled = count === 0
  }
  const groupTitle = h('input', {
    value: 'Liste importate',
    maxLength: 120,
    'aria-label': 'Nome della lista nuova',
    hidden: job.lists.length < 2,
  })
  const group = h('input', {
    type: 'checkbox',
    checked: job.lists.length > 1,
    onchange: (event) => {
      groupTitle.hidden = !event.target.checked
    },
  })
  const errorSlot = h('div')

  const pick = (lists) =>
    lists
      .map((list) => ({ ...list, items: skipped.has(list) ? [] : list.items, lists: pick(list.lists) }))
      .filter((list) => list.items.length || list.lists.length)

  button.addEventListener('click', async () => {
    button.disabled = true
    errorSlot.replaceChildren()
    try {
      const created = await call('/api/extension/imports', {
        method: 'POST',
        body: { lists: pick(job.lists), group_title: group.checked ? groupTitle.value.trim() : '' },
      })
      await chrome.storage.session.remove('importJob')
      show(
        h('p', { class: 'ok' }, '✓ Importata'),
        h('p', {}, created.length === 1 ? `Trovi la lista «${created[0].title}» in Regalino.` : `${created.length} liste nuove in Regalino.`),
        h('p', { class: 'small muted' }, 'Le foto arrivano tra poco.'),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { class: 'tonal', type: 'button', onclick: () => chrome.tabs.create({ url: `${config.app}/liste/${created[0].id}` }) },
            'Apri in Regalino',
          ),
        ),
      )
    } catch (error) {
      if (error instanceof NotConnected) return renderConnect('L’estensione è stata scollegata.')
      button.disabled = false
      errorSlot.replaceChildren(errorBox(error.message))
    }
  })

  show(
    h('h1', {}, 'Ecco la lista'),
    h('p', { class: 'muted small' }, `${countItems(job.lists)} regali trovati. Togli le liste che non vuoi.`),
    h(
      'div',
      { class: 'lists' },
      rows.map(({ list, depth, container }) => {
        if (container) {
          return h('p', { class: 'small muted', style: `margin:4px 0 0 ${depth * 18}px` }, `${list.title}:`)
        }
        const box = h('input', {
          type: 'checkbox',
          checked: true,
          onchange: (event) => {
            if (event.target.checked) skipped.delete(list)
            else skipped.add(list)
            refresh()
          },
        })
        return h(
          'label',
          { style: depth ? `margin-left:${depth * 18}px` : '' },
          box,
          h(
            'span',
            {},
            h('strong', {}, list.title),
            h('br'),
            h('span', { class: 'small muted' }, list.items.slice(0, 3).map((item) => item.title).join(' · ')),
          ),
        )
      }),
    ),
    rows.filter((row) => !row.container).length > 1
      ? h(
          'div',
          { class: 'card' },
          h('label', { class: 'switch' }, group, 'Mettile tutte dentro una lista nuova'),
          groupTitle,
        )
      : null,
    errorSlot,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'text grow',
          type: 'button',
          onclick: async () => {
            await chrome.storage.session.remove('importJob')
            start()
          },
        },
        'Annulla',
      ),
      button,
    ),
  )
  refresh()
}

function renderJob(config, job) {
  if (job.status === 'reading') {
    show(thinking(READING_LINES), h('p', { class: 'small muted', style: 'text-align:center' }, 'Puoi chiudere il popup: continuo io.'))
  } else if (job.status === 'error') {
    show(
      errorBox(job.error),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'text', type: 'button', onclick: async () => { await chrome.storage.session.remove('importJob'); start() } }, 'Indietro'),
      ),
    )
  } else if (job.status === 'done') {
    renderImportPreview(config, job)
  }
}

/* ------------------------------------------------------------ avvio -- */

async function start() {
  const config = await getConfig()
  const user = document.getElementById('user')
  const leave = document.getElementById('disconnect')
  if (!config) {
    user.textContent = ''
    leave.hidden = true
    renderConnect()
    return
  }
  user.textContent = config.name || new URL(config.app).host
  leave.hidden = false
  leave.onclick = async () => {
    await disconnect()
    start()
  }

  const { importJob } = await chrome.storage.session.get('importJob')
  if (importJob) {
    renderJob(config, importJob)
    return
  }
  const tab = await activeTab()
  if (!tab || !/^https?:/.test(tab.url || '')) {
    show(h('p', { class: 'muted' }, 'Apri la pagina di un prodotto (o una lista Amazon o Elfster) e tocca di nuovo Regalino.'))
    return
  }
  if (isListPage(tab.url)) {
    show(
      h('div', { class: 'card hint' }, h('h1', {}, 'Questa pagina è una lista'), h('p', { class: 'muted' }, 'Puoi importarla tutta in Regalino, con le liste collegate.')),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'text grow', type: 'button', onclick: () => renderProduct(tab, config, { fromList: true }) }, 'Solo questo prodotto'),
        h('button', { class: 'filled', type: 'button', onclick: () => renderImportStart(tab) }, 'Importa la lista'),
      ),
    )
    return
  }
  renderProduct(tab, config)
}

// Il service worker aggiorna lo stato dell'import: il popup aperto lo segue.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'session' || !changes.importJob || !changes.importJob.newValue) return
  const config = await getConfig()
  if (config) renderJob(config, changes.importJob.newValue)
})

start()
