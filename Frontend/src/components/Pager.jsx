/** Page navigation for long lists: « ‹ 1 … 4 5 6 … 256 › » + rows per page.
   The buttons never move: there are always 7 page slots of equal width, and the bar is a 3-column
   grid (text | buttons | per page) so the centre column does not depend on the side texts. */
export const PAGE_SIZES = [20, 50, 100]

export function paginate(rows, page, size) {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(1, page), pages)
  return { pageRows: rows.slice((p - 1) * size, p * size), page: p, pages }
}

/** Always 7 entries (numbers or '…') once there are more than 7 pages. */
function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap-r', pages]
  if (page >= pages - 3) return [1, 'gap-l', pages - 4, pages - 3, pages - 2, pages - 1, pages]
  return [1, 'gap-l', page - 1, page, page + 1, 'gap-r', pages]
}

export default function Pager({ total, page, pages, size, onPage, onSize, label = 'D365 tables' }) {
  if (!total) return null
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, total)
  return (
    <nav className="pager" aria-label="Pages">
      <span className="muted small pager-info">Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {label}</span>
      <div className="pager-buttons">
        {pages > 1 && <>
          <button onClick={() => onPage(1)} disabled={page === 1} aria-label="First page" title="First page">«</button>
          <button onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page" title="Previous page">‹</button>
          {pageList(page, pages).map((n) => (typeof n === 'string'
            ? <span key={n} className="pager-gap">…</span>
            : <button key={`p${n}`} className={n === page ? 'on' : ''} onClick={() => onPage(n)}
                      aria-current={n === page ? 'page' : undefined}>{n}</button>))}
          <button onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page" title="Next page">›</button>
          <button onClick={() => onPage(pages)} disabled={page === pages} aria-label="Last page" title="Last page">»</button>
        </>}
      </div>
      <div className="pager-size-wrap">
        {onSize && (
          <label className="pager-size">Per page
            <select value={size} onChange={(e) => onSize(Number(e.target.value))}>
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
    </nav>
  )
}
