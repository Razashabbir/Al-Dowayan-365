/* Animated, theme-coloured drop-down lists for every <select> in the app (the sidebar has none).
   The page keeps using plain <select>/<option>; this only replaces the browser's grey pop-up list:
   - opens with a fade/scale animation, options slide in, the chosen one is ticked in the accent colour
   - keyboard: Enter / Space / Alt+Down opens, arrows + Home/End move, Enter picks, Esc closes, typing jumps
   - long lists get a search box; <optgroup> headings and disabled options are kept
   - picking fires the normal "change" event, so React onChange works unchanged
   - touch screens keep the phone's own picker; "reduce motion" switches the animation off */

let pop = null        // { sel, box, list, items, active, search }

const usable = (sel) => sel && sel.tagName === 'SELECT' && !sel.multiple && !(sel.size > 1) && !sel.disabled
  && !sel.closest('.sidebar, [data-native-select]')

function rowsOf(sel) {
  const out = []
  for (const node of sel.children) {
    if (node.tagName === 'OPTGROUP') {
      out.push({ group: node.label })
      for (const o of node.children) if (!o.hidden) out.push({ o, label: o.textContent, disabled: o.disabled || node.disabled })
    } else if (node.tagName === 'OPTION' && !node.hidden) out.push({ o: node, label: node.textContent, disabled: node.disabled })   // hidden = placeholder, not listed
  }
  return out
}

function close(focus = true) {
  if (!pop) return
  const { sel, box } = pop
  pop = null
  sel.classList.remove('sel-open')
  sel.removeAttribute('aria-expanded')
  box.classList.add('closing')
  setTimeout(() => box.remove(), 230)
  if (focus) sel.focus({ preventScroll: true })
}

function pick(row) {
  if (!pop || !row || row.disabled || !row.o) return
  const { sel } = pop
  const changed = sel.value !== row.o.value
  close()
  if (changed) {
    sel.value = row.o.value
    sel.dispatchEvent(new Event('input', { bubbles: true }))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

function setActive(i, scroll = true) {
  if (!pop) return
  const { items } = pop
  const vis = items.filter((it) => !it.el.hidden && !it.row.disabled && it.row.o)
  if (!vis.length) return
  const cur = vis.find((it) => it.i === i) || vis[0]
  items.forEach((it) => it.el.classList.toggle('act', it === cur))
  pop.active = cur.i
  pop.box.querySelector('.sel-list').setAttribute('aria-activedescendant', cur.el.id)
  if (scroll) cur.el.scrollIntoView({ block: 'nearest' })
}

function move(step) {
  const vis = pop.items.filter((it) => !it.el.hidden && !it.row.disabled && it.row.o)
  if (!vis.length) return
  let k = vis.findIndex((it) => it.i === pop.active)
  k = step === 'home' ? 0 : step === 'end' ? vis.length - 1 : Math.max(0, Math.min(vis.length - 1, (k < 0 ? 0 : k) + step))
  setActive(vis[k].i)
}

function place() {
  if (!pop) return
  const { sel, box } = pop
  const r = sel.getBoundingClientRect()
  const pad = 8, gap = 6
  box.style.minWidth = `${Math.max(r.width, 160)}px`
  box.style.maxHeight = ''
  const h = box.offsetHeight, w = box.offsetWidth
  const below = window.innerHeight - r.bottom - gap - pad, above = r.top - gap - pad
  const up = h > below && above > below
  const room = up ? above : below
  if (h > room) box.style.maxHeight = `${Math.max(140, room)}px`
  const rtl = getComputedStyle(sel).direction === 'rtl'
  let left = rtl ? r.right - w : r.left
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad))
  box.style.left = `${Math.round(left)}px`
  box.style.top = up ? '' : `${Math.round(r.bottom + gap)}px`
  box.style.bottom = up ? `${Math.round(window.innerHeight - r.top + gap)}px` : ''
  box.dataset.side = up ? 'up' : 'down'
}

function open(sel) {
  if (pop?.sel === sel) { close(); return }
  close(false)
  const rows = rowsOf(sel)
  if (!rows.some((r) => r.o)) return
  const box = document.createElement('div')
  box.className = 'sel-pop'
  box.setAttribute('data-no-tr', '')          // texts are copied already translated
  if (sel.matches('[dir=ltr], .co-top')) box.dir = 'ltr'
  const many = rows.filter((r) => r.o).length > 12
  let search = null
  if (many) {
    search = document.createElement('input')
    search.className = 'sel-search'
    search.placeholder = document.documentElement.lang === 'ar' ? 'بحث…' : 'Search…'
    box.append(search)
  }
  const list = document.createElement('div')
  list.className = 'sel-list'
  list.setAttribute('role', 'listbox')
  box.append(list)
  const uid = Math.random().toString(36).slice(2, 7)
  const items = rows.map((row, i) => {
    const el = document.createElement('div')
    if (row.group != null) {
      el.className = 'sel-group'
      el.textContent = row.group
    } else {
      el.className = `sel-opt${row.disabled ? ' off' : ''}${row.o.selected ? ' on' : ''}`
      el.id = `sel-${uid}-${i}`
      el.setAttribute('role', 'option')
      el.setAttribute('aria-selected', row.o.selected ? 'true' : 'false')
      if (row.disabled) el.setAttribute('aria-disabled', 'true')
      const t = document.createElement('span')
      t.textContent = row.label.trim() || ' '
      el.append(t)
    }
    el.style.setProperty('--i', Math.min(i, 14))
    list.append(el)
    return { el, row, i }
  })
  document.body.append(box)
  pop = { sel, box, list, items, active: -1, search }
  sel.classList.add('sel-open')
  sel.setAttribute('aria-expanded', 'true')
  place()
  const chosen = items.find((it) => it.row.o && it.row.o.selected)
  setActive(chosen ? chosen.i : -1, false)
  const a = items.find((it) => it.i === pop.active)
  if (a) list.scrollTop = Math.max(0, a.el.offsetTop - list.clientHeight / 2 + a.el.offsetHeight / 2)

  list.addEventListener('pointermove', (e) => {
    const el = e.target.closest('.sel-opt')
    const it = el && items.find((x) => x.el === el)
    if (it && it.i !== pop?.active && !it.row.disabled) setActive(it.i, false)
  })
  list.addEventListener('click', (e) => {
    const el = e.target.closest('.sel-opt')
    const it = el && items.find((x) => x.el === el)
    if (it) pick(it.row)
  })
  box.addEventListener('pointerdown', (e) => { if (e.target !== search) e.preventDefault() })   // keep focus where it is
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase()
      let lastGroup = null, groupHas = false
      for (const it of items) {
        if (it.row.group != null) {
          if (lastGroup) lastGroup.el.hidden = !groupHas
          lastGroup = it; groupHas = false
          continue
        }
        it.el.hidden = !!q && !it.row.label.toLowerCase().includes(q)
        if (!it.el.hidden) groupHas = true
      }
      if (lastGroup) lastGroup.el.hidden = !groupHas
      move('home')
    })
    search.addEventListener('keydown', keys)
    setTimeout(() => search.focus({ preventScroll: true }), 30)
  }
}

let typed = '', typedAt = 0
function keys(e) {
  if (!pop) return
  const k = e.key
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  else if (k === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (k === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (k === 'PageDown') { e.preventDefault(); move(8) }
  else if (k === 'PageUp') { e.preventDefault(); move(-8) }
  else if ((k === 'Home' || k === 'End') && e.target !== pop.search) { e.preventDefault(); move(k === 'Home' ? 'home' : 'end') }
  else if (k === 'Enter' || (k === ' ' && e.target !== pop.search)) {
    e.preventDefault()
    pick(pop.items.find((it) => it.i === pop.active)?.row)
  } else if (k === 'Tab') close(false)
  else if (k.length === 1 && e.target !== pop.search && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const now = Date.now()
    typed = now - typedAt > 700 ? k.toLowerCase() : typed + k.toLowerCase()
    typedAt = now
    const hit = pop.items.find((it) => it.row.o && !it.row.disabled && it.row.label.trim().toLowerCase().startsWith(typed))
    if (hit) setActive(hit.i)
  }
}

export function installSelects() {
  if (typeof window === 'undefined' || window.__selectsInstalled) return
  window.__selectsInstalled = true

  document.addEventListener('pointerdown', (e) => {
    const sel = e.target.closest?.('select')
    if (pop && !pop.box.contains(e.target) && e.target !== pop.sel) close(false)
    if (e.pointerType === 'touch' || e.button !== 0 || !usable(sel)) return
    e.preventDefault()                         // no native pop-up
    sel.focus({ preventScroll: true })
    open(sel)
  }, true)
  document.addEventListener('mousedown', (e) => {            // older browsers open the list on mousedown
    if (usable(e.target.closest?.('select')) && !e.sourceCapabilities?.firesTouchEvents) e.preventDefault()
  }, true)
  document.addEventListener('keydown', (e) => {
    if (pop) { if (e.target === pop.sel || pop.box.contains(e.target)) keys(e); return }
    const sel = e.target
    if (!usable(sel)) return
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
      e.preventDefault(); open(sel)
    }
  }, true)
  window.addEventListener('resize', () => close(false))
  window.addEventListener('scroll', (e) => { if (pop && !pop.box.contains(e.target)) close(false) }, true)
  window.addEventListener('blur', () => close(false))
}
