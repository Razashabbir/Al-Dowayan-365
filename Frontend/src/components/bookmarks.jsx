import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { auth, call } from '../api'
import { useApp } from '../theme'

/* Bookmarks of the signed-in user (saved on the server, so they follow the user to every browser). */
const Ctx = createContext(null)
export const useBookmarks = () => useContext(Ctx)

export function BookmarkProvider({ children }) {
  const [list, setList] = useState([])
  const load = useCallback(() => auth('bookmarks').then(setList).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const add = async (b) => { await call('/api/auth/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return load() }
  const remove = async (id) => { await call(`/api/auth/bookmarks/${id}`, { method: 'DELETE' }); return load() }
  const find = (path, company) => list.find((b) => b.path === path && (b.company || null) === (company || null))
  return <Ctx.Provider value={{ list, add, remove, find, reload: load }}>{children}</Ctx.Provider>
}

/** Star in the top bar: bookmark / un-bookmark the page (with the company in the top bar). */
export function BookmarkButton({ route, title }) {
  const bm = useBookmarks()
  const { scope } = useApp()
  const [pop, setPop] = useState('')
  if (!bm || route === '/home') return null
  const company = /^\/(dashboards|reports|adjustments|close)\//.test(route) ? scope?.company : null
  const hit = bm.find(route, company)
  const toggle = async () => {
    try {
      if (hit) { await bm.remove(hit.bookmark_id); setPop('Removed from bookmarks') }
      else {
        await bm.add({ path: route, title: title.replace(/^.* · /, '') + (company ? ` · ${company.toUpperCase()}` : ''), tenant_key: company ? scope?.tenant : null, company })
        setPop('Saved to Home › Bookmarks')
      }
    } catch (e) { setPop(e.message) }
    setTimeout(() => setPop(''), 2200)
  }
  return (
    <span className="bm-wrap">
      <button className={`top-btn bm-btn ${hit ? 'on' : ''}`} onClick={toggle} aria-pressed={!!hit}
              title={hit ? 'Remove this page from your bookmarks' : 'Bookmark this page (shown on Home)'} aria-label="Bookmark this page">
        <svg width="18" height="18" viewBox="0 0 24 24" fill={hit ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1z" />
        </svg>
      </button>
      {pop && <span className="bm-pop" role="status">{pop}</span>}
    </span>
  )
}
