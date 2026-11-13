// Il service worker: legge le liste da importare (ADR 0015/0016). Puo' durare
// un minuto o due, e il popup si chiude appena si clicca altrove: lo stato sta
// in chrome.storage.session e il popup lo rilegge quando si riapre.

import { NotConnected, call } from './api.js'

const POLL_MS = 2000
const MAX_MS = 5 * 60 * 1000

const setJob = (job) => chrome.storage.session.set({ importJob: job })

async function readList(url, html) {
  await setJob({ status: 'reading', url, startedAt: Date.now() })
  try {
    let state = await call('/api/extension/imports/read', { method: 'POST', body: { url, html } })
    const started = Date.now()
    while (state.status === 'reading' && state.job_id) {
      if (Date.now() - started > MAX_MS) throw new Error('La lettura ci mette troppo: riprova tra poco.')
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      state = await call(`/api/extension/imports/read/${state.job_id}`)
    }
    if (state.status === 'error') throw new Error(state.error || 'Non sono riuscito a leggere la lista.')
    await setJob({ status: 'done', url, lists: state.lists || [] })
  } catch (error) {
    const message = error instanceof NotConnected ? 'Collega di nuovo l’estensione.' : error.message
    await setJob({ status: 'error', url, error: message })
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message && message.type === 'import:start') {
    readList(message.url, message.html)
    reply({ ok: true })
  }
  return false
})
