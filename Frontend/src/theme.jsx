import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { setPageLanguage } from './i18n'

/* Each theme = a gradient (start -> mid -> end), a darker sidebar, the accent used for buttons/links,
   and the page background. Everything else (soft tints, dark mode) is derived in styles.css with color-mix. */
export const THEMES = [
  { id: 'teal', name: 'Teal (default)', start: '#0f766e', mid: '#0d9488', end: '#14b8a6',
    side: ['#0b4f4a', '#0d9488'], accent: '#0d9488', bg: '#f3f8f8' },
  { id: 'ocean', name: 'Ocean Blue', start: '#1e3a8a', mid: '#2563eb', end: '#06b6d4',
    side: ['#0f1f4d', '#1e3a8a'], accent: '#2563eb', bg: '#f2f6fb' },
  { id: 'royal', name: 'Royal Indigo', start: '#312e81', mid: '#4f46e5', end: '#8b5cf6',
    side: ['#1e1b4b', '#3730a3'], accent: '#4f46e5', bg: '#f3f3fa' },
  { id: 'aurora', name: 'Aurora (teal to violet)', start: '#0e7490', mid: '#4f46e5', end: '#a855f7',
    side: ['#083344', '#3730a3'], accent: '#4f46e5', bg: '#f3f4fa' },
  { id: 'emerald', name: 'Emerald & Gold', start: '#064e3b', mid: '#047857', end: '#ca8a04',
    side: ['#022c22', '#065f46'], accent: '#047857', bg: '#f2f6f3' },
  { id: 'sunset', name: 'Desert Sunset', start: '#9a3412', mid: '#ea580c', end: '#f59e0b',
    side: ['#431407', '#9a3412'], accent: '#c2410c', bg: '#f8f4ef' },
  { id: 'rose', name: 'Berry Rose', start: '#831843', mid: '#be185d', end: '#f472b6',
    side: ['#500724', '#9d174d'], accent: '#be185d', bg: '#f8f2f5' },
  { id: 'midnight', name: 'Midnight Sky', start: '#0f172a', mid: '#1e3a5f', end: '#0ea5e9',
    side: ['#020617', '#1e293b'], accent: '#0284c7', bg: '#f1f5f9' },
  { id: 'custom', name: 'Custom gradient…' },
]

const read = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
// did this browser already choose a theme / language? If not, System Configuration's defaults apply.
const CHOSEN = { theme: read('ad-theme', null) != null, font: read('ad-font', null) != null }
let LOGO_TEXT = 'AD'
let LOGO_IMG = ''                      // uploaded logo (System Configuration) = browser tab icon
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

function mix(hex, other, t) { // t = share of `other` (0..1)
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const a = p(hex), b = p(other)
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

export function resolveTheme(id, custom) {
  if (id !== 'custom') return THEMES.find((t) => t.id === id) || THEMES[0]
  const { start, end } = custom
  return { id: 'custom', name: 'Custom', start, mid: mix(start, end, 0.5), end,
    side: [mix(start, '#000000', 0.55), start], accent: start, bg: mix(start, '#ffffff', 0.95) }
}

function faviconSvg(t) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${t.start}'/><stop offset='1' stop-color='${t.end}'/></linearGradient></defs>` +
    `<rect width='64' height='64' rx='14' fill='url(#g)'/>` +
    `<text x='32' y='42' text-anchor='middle' font-family='Arial,Helvetica,sans-serif' font-weight='800' font-size='${LOGO_TEXT.length > 2 ? 20 : 28}' fill='white'>${LOGO_TEXT.replace(/[<>&'"]/g, '')}</text></svg>`
}

function applyTheme(t) {
  const r = document.documentElement.style
  r.setProperty('--grad', `linear-gradient(135deg, ${t.start} 0%, ${t.mid} 50%, ${t.end} 100%)`)
  r.setProperty('--grad-side', `linear-gradient(180deg, ${t.side[0]} 0%, ${t.side[1]} 100%)`)
  r.setProperty('--accent-base', t.accent)
  r.setProperty('--bg-base', t.bg)
  r.setProperty('--theme-start', t.start)
  r.setProperty('--theme-end', t.end)
  let link = document.querySelector("link[rel~='icon']")
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
  if (LOGO_IMG) {
    link.type = LOGO_IMG.slice(5, LOGO_IMG.indexOf(';'))
    link.href = LOGO_IMG
  } else {
    link.type = 'image/svg+xml'
    link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(t))}`
  }
}

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }) {
  const [themeId, setThemeId] = useState(() => read('ad-theme', 'teal'))
  const [custom, setCustom] = useState(() => {
    try { return JSON.parse(read('ad-theme-custom', '')) || { start: '#0f766e', end: '#f59e0b' } }
    catch { return { start: '#0f766e', end: '#f59e0b' } }
  })
  const [font, setFont] = useState(() => read('ad-font', 'en'))         // 'en' | 'ar'
  const [scope, setScope] = useState(() => {                               // selected tenant + company
    try { return JSON.parse(read('ad-scope', '')) || null } catch { return null }
  })

  useEffect(() => { applyTheme(resolveTheme(themeId, custom)); write('ad-theme', themeId) }, [themeId, custom])
  useEffect(() => { write('ad-theme-custom', JSON.stringify(custom)) }, [custom])
  // 'ar' = Arabic interface: Arabic font + translated labels + right-to-left layout
  useLayoutEffect(() => {
    document.documentElement.dataset.font = font
    setPageLanguage(font)
    write('ad-font', font)
  }, [font])
  useEffect(() => { write('ad-scope', JSON.stringify(scope)) }, [scope])

  /** System Configuration defaults: used only while this browser has not picked its own theme / language. */
  const applyDefaults = (cfg) => {
    LOGO_TEXT = cfg.short_name || 'AD'
    LOGO_IMG = cfg.logo || ''
    applyTheme(resolveTheme(themeId, custom))                  // favicon letters
    // the theme saved in System Configuration is applied to every browser once, when it changes
    // (users can still pick another one afterwards; an unchanged default never overrides their pick)
    const seen = read('ad-theme-default', null)
    if (cfg.default_theme && seen !== cfg.default_theme) {
      write('ad-theme-default', cfg.default_theme)
      if (cfg.default_theme !== themeId) setThemeId(cfg.default_theme)
    } else if (!CHOSEN.theme && cfg.default_theme && cfg.default_theme !== themeId) setThemeId(cfg.default_theme)
    if (!CHOSEN.font && cfg.default_language && cfg.default_language !== font) setFont(cfg.default_language)
  }
  const chooseTheme = (id) => { CHOSEN.theme = true; setThemeId(id) }
  const chooseFont = (f) => { CHOSEN.font = true; setFont(f) }

  return (
    <AppCtx.Provider value={{ themeId, setThemeId: chooseTheme, custom, setCustom, font, setFont: chooseFont, scope, setScope, applyDefaults }}>
      {children}
    </AppCtx.Provider>
  )
}
