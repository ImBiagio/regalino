// Le chiamate all'API di Regalino con la chiave dell'estensione (ADR 0016).
// Usato dal popup e dal service worker.

export const PRODUCTION_APP = 'https://regal.inoo.it'

/** La configurazione salvata da connect.js: {app, api, token, name}, o null. */
export async function getConfig() {
  const { config } = await chrome.storage.local.get('config')
  return config && config.token ? config : null
}

export async function disconnect() {
  await chrome.storage.local.remove(['config', 'lastListId'])
  await chrome.storage.session.remove('importJob')
}

/** L'estensione e' stata scollegata dall'app (Account): va ricollegata. */
export class NotConnected extends Error {}

function messageOf(payload, status) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.detail === 'string') return payload.detail
    const first = Object.values(payload)[0]
    if (Array.isArray(first) && first.length) return String(first[0])
    if (typeof first === 'string') return first
  }
  return `Errore ${status}`
}

export async function call(path, { method = 'GET', body } = {}) {
  const config = await getConfig()
  if (!config) throw new NotConnected()
  let response
  try {
    response = await fetch(`${config.api}${path}`, {
      method,
      headers: {
        Authorization: `Token ${config.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Regalino non risponde: controlla la connessione.')
  }
  if (response.status === 401) {
    await disconnect()
    throw new NotConnected()
  }
  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(messageOf(payload, response.status))
  return payload
}

/** Le pagine che sono liste intere: si propone l'import invece del singolo regalo. */
export function isListPage(url) {
  let parts
  try {
    parts = new URL(url)
  } catch {
    return false
  }
  const host = parts.hostname
  if (/(^|\.)amazon\.[a-z.]+$/i.test(host)) {
    return /\/(hz\/wishlist\/(ls|genericItemsPage)|registry\/wishlist|gp\/registry\/wishlist)\//i.test(
      parts.pathname,
    )
  }
  if (/(^|\.)elfster\.[a-z.]+$/i.test(host)) {
    return /^\/u\/[^/]+(\/w\/[^/]+)?\/?$/.test(parts.pathname)
  }
  return false
}
