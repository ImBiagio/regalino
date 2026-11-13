// Gira solo sulle pagine di Regalino (vedi "content_scripts" nel manifest).
// Dice alla pagina /estensione che l'estensione c'e', e riceve da lei la
// chiave creata col login dell'app (ADR 0016). La chiave arriva con
// window.postMessage dalla stessa origine: altri siti non la vedono e non la
// possono mandare, perche' questo script non gira altrove.

document.documentElement.dataset.regalinoExtension = chrome.runtime.getManifest().version

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== 'regalino:connect' || typeof data.key !== 'string') return
  const config = {
    app: window.location.origin,
    // In sviluppo l'API sta su un'altra porta: la pagina sa qual e'.
    api: typeof data.api === 'string' && data.api ? data.api : window.location.origin,
    token: data.key,
    name: typeof data.name === 'string' ? data.name : '',
  }
  chrome.storage.local.set({ config }, () => {
    window.postMessage({ type: 'regalino:connected' }, window.location.origin)
  })
})
