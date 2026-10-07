import { useEffect, useState } from 'react'
import { api, fmtTime } from '../api'

export default function EtlStatus({ tenant }) {
  const [rows, setRows] = useState([])
  useEffect(() => { api('etl-status', { tenant }).then(setRows).catch(() => setRows([])) }, [tenant])
  if (!rows.length) return null
  const last = rows.map((r) => r.last_ok_utc).filter(Boolean).sort().at(0)
  const stale = rows.some((r) => r.last_run_utc !== r.last_ok_utc)
  return (
    <footer className="muted">
      Data refreshed from D365: {fmtTime(last)}
      {stale && <span className="down"> · last sync had failures</span>}
    </footer>
  )
}
