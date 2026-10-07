const BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'ad-token'

const TIMEOUT_MS = 30000

export async function call(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  const tok = getToken()
  try {
    const headers = { ...(opts.headers || {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
    res = await fetch(`${BASE}${url}`, { ...opts, headers, signal: ctrl.signal })
  } catch (e) {
    const err = new Error(e.name === 'AbortError'
      ? `The API did not answer within ${Math.round(timeoutMs / 1000)} s. Check the uvicorn window for errors.`
      : 'Cannot reach the API. Is uvicorn running (uvicorn main:app --port 8000)?')
    err.status = 0
    throw err
  } finally {
    clearTimeout(timer)
  }
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const detail = data?.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : null
    const err = new Error(detail || (res.status === 500
      ? 'Server error (HTTP 500) - the uvicorn window shows the details.'
      : `HTTP ${res.status}`))
    err.status = res.status
    if (res.status === 401 && tok && !url.startsWith('/api/auth/login')) setToken('')   // session ended -> sign-in page
    throw err
  }
  return data
}

/** Read-only dashboard data */
export function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  return call(`/api/report/${path}${qs ? `?${qs}` : ''}`)
}

/** Admin / ETL / users / health calls. */
export async function admin(path, { method = 'GET', body, params, timeoutMs } = {}) {
  const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) : null
  const qs = clean && Object.keys(clean).length ? `?${new URLSearchParams(clean)}` : ''
  return call(`/api/admin/${path}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, timeoutMs)
}

/** Branding and display defaults (no sign-in needed). */
export const publicConfig = () => call('/api/config/public')

/** AI Assistant: GET status, or POST a chat (answers can take a minute). */
export function ai(path, body, method) {
  return call(`/api/ai/${path}`, body === undefined && !method ? {} : {
    method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, 180000)
}

/** Sign-in calls (/api/auth/...). */
export function auth(path, body) {
  return call(`/api/auth/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

let memToken = ''
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || memToken } catch { return memToken } }
export const setToken = (t) => {
  memToken = t || ''
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  window.dispatchEvent(new Event('auth-token'))
}

/** Number display set in Administration › System Configuration (decimals, negatives, currency). */
export const NUM = { decimals: 0, negatives: 'minus', currency: 'SAR' }
export function setNumberFormat(c) {
  if (!c) return
  NUM.decimals = Number(c.decimals) || 0
  NUM.negatives = c.negatives === 'brackets' ? 'brackets' : 'minus'
  NUM.currency = c.currency || 'SAR'
}
export const amountsIn = () => `All amounts in ${NUM.currency}`

export const fmt = (n) => {
  if (n == null) return '–'
  const s = new Intl.NumberFormat('en-AE', { minimumFractionDigits: NUM.decimals, maximumFractionDigits: NUM.decimals })
  return NUM.negatives === 'brackets' && n < 0 ? `(${s.format(-n)})` : s.format(n)
}

export const fmtShort = (n) =>
  n == null ? '–' : new Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** SQL datetimes come back as UTC without a zone */
export const fmtDuration = (sec) => {
  if (sec == null) return '–'
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

export const fmtTime = (s) => (s
  ? new Date(s.endsWith('Z') ? s : `${s}Z`).toLocaleString(document.documentElement.lang === 'ar' ? 'ar-AE-u-nu-latn' : undefined)
  : '–')

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short, specific version of a job / table message (older runs stored long technical text). */
const SHORT = [
  [/stg\.gl_entries is missing:/i, 'Ledger lines not loaded yet. Run ETL for GeneralJournalAccountEntryBiEntities.'],
  [/stg\.main_accounts is missing/i, 'Main accounts not loaded yet. Run ETL for MainAccounts.'],
  [/missing a posting date/i, 'Posting dates missing. Run ETL for GeneralJournalEntryBiEntities (journal headers), then Rebuild reports.'],
  [/Login timeout|TCP Provider|Login failed/i, 'Cannot connect to SQL Server (login or network timeout).'],
]
export function shortMsg(msg) {
  if (!msg) return ''
  let s = String(msg)
  const sql = s.match(/\[SQL Server\]([^[]+?)(?:\s*\(\d+\))?(?:\s*\(SQL\w+\))?\s*(?:;|$)/)
  if (sql) s = sql[1].trim()
  s = s.split(/\s*\.?\s*Columns found:/)[0]
  const reach = s.match(/(Cannot reach \S+ after \d+ tries \([^)]*\))/)
  if (reach) s = s.replace(/Cannot reach .*$/, `${reach[1].replace('https://', '')}.`)
  // "N of M entities loaded, 1 failed. Reporting tables not built: ..." (older wording)
  const job = s.match(/^(\d+) of (\d+) entities loaded(?:, (\d+) failed)?\.\s*(.*)$/)
  if (job) {
    const rest = job[4].replace(/^Reporting tables not built:\s*/, '')
    const fix = SHORT.find(([re]) => re.test(rest))
    const tail = rest ? ` Dashboard data not built: ${fix ? fix[1] : rest}` : ''
    return `${job[1]} of ${job[2]} D365 tables loaded.${tail}`.trim()
  }
  const fix = SHORT.find(([re]) => re.test(s))
  if (fix) return fix[1]
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 220 ? `${s.slice(0, 217)}...` : s
}

/** Download a file from the API (CSV template, PDF preview) with the sign-in token. open=true shows it in a new tab. */
export async function download(url, filename, open = false) {
  const tok = getToken()
  const res = await fetch(`${BASE}${url}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).detail || msg } catch { /* not json */ }
    throw new Error(msg)
  }
  const href = URL.createObjectURL(await res.blob())
  if (open) window.open(href, '_blank', 'noopener')
  else Object.assign(document.createElement('a'), { href, download: filename }).click()
  setTimeout(() => URL.revokeObjectURL(href), 60000)
}
