/* Animated tooltips for the whole app.
   Every element with a title="" gets a themed bubble that fades, scales and slides in instead of the
   browser's plain grey tooltip. No changes are needed in the pages: keep using title="...".
   - works on disabled buttons too (e.g. a locked "Run ETL" button)
   - follows title changes while the pointer is still on the element
   - shown above the element, flipped below when there is no room, kept inside the window
   - keyboard: shown when an element gets focus with the keyboard
   - honours "reduce motion" and is skipped on touch screens */

const DELAY = 300          // ms before the bubble appears
let tip, text, el = null, saved = '', timer = 0, watcher = null

function bubble() {
  if (tip) return
  tip = document.createElement('div')
  tip.className = 'tip'
  tip.setAttribute('role', 'tooltip')
  tip.id = 'app-tip'
  text = document.createElement('span')
  tip.append(text, Object.assign(document.createElement('i'), { className: 'tip-arrow' }))
  document.body.append(tip)
}

function place() {
  if (!el || !tip) return
  const r = el.getBoundingClientRect()
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = 9, pad = 8
  const below = r.top - h - gap < pad
  const top = below ? r.bottom + gap : r.top - h - gap
  let left = r.left + r.width / 2 - w / 2
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad))
  const arrow = Math.max(12, Math.min(r.left + r.width / 2 - left, w - 12))
  tip.style.translate = `${Math.round(left)}px ${Math.round(top)}px`
  tip.style.setProperty('--arrow', `${arrow}px`)
  tip.dataset.side = below ? 'bottom' : 'top'
}

function take(node) {                      // move title -> bubble so the browser shows no tooltip of its own
  const t = node.getAttribute('title')
  if (t == null) return false
  saved = t
  node.removeAttribute('title')
  node.setAttribute('aria-describedby', 'app-tip')
  return true
}

function show(node) {
  if (node === el) return
  hide()
  if (!take(node)) return
  el = node
  bubble()
  text.textContent = saved
  watcher = new MutationObserver(() => {   // the page changed the title while we are on it
    if (el && el.hasAttribute('title')) { take(el); text.textContent = saved; place() }
    if (el && !el.isConnected) hide()
  })
  watcher.observe(node, { attributes: true, attributeFilter: ['title'] })
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!el || !saved.trim()) return
    tip.classList.remove('on'); place()
    void tip.offsetWidth                  // restart the entry animation
    tip.classList.add('on')
  }, DELAY)
}

function hide() {
  clearTimeout(timer)
  watcher?.disconnect(); watcher = null
  if (el) {
    if (!el.hasAttribute('title')) el.setAttribute('title', saved)   // give the title back
    el.removeAttribute('aria-describedby')
  }
  el = null; saved = ''
  tip?.classList.remove('on')
}

const owner = (node) => (node && node.closest ? node.closest('[title]') : null)

export function installTooltips() {
  if (typeof window === 'undefined' || window.__tipsInstalled) return
  window.__tipsInstalled = true

  // pointermove + elementFromPoint also finds disabled buttons, which do not always get pointer events
  let last = null
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    if (hit === last) return
    last = hit
    if (el && el.contains(hit)) return
    const o = owner(hit)
    if (o) show(o); else hide()
  }, { passive: true })
  document.addEventListener('pointerleave', () => { last = null; hide() })
  document.addEventListener('pointerdown', () => { last = null; hide() }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide() })
  document.addEventListener('focusin', (e) => {
    const o = owner(e.target)
    if (o && e.target.matches(':focus-visible')) show(o)
  })
  document.addEventListener('focusout', () => hide())
  window.addEventListener('scroll', () => hide(), true)
  window.addEventListener('resize', () => hide())
}
