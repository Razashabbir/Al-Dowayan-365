import { useCallback, useEffect, useState } from 'react'
import { admin, fmtTime } from '../api'
import ConnectionForm from '../components/ConnectionForm'
import Modal from '../components/Modal'

const pill = (s) => ({ OK: 'pill ok', Partial: 'pill warn', Failed: 'pill bad', Running: 'pill run' }[s] || 'pill')

/** Tenants page: the saved D365 environments only. Adding / editing happens in a pop-up. */
export default function Connections({ go }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)   // null | 'new' | tenant object
  const [toast, setToast] = useState('')

  const load = useCallback(() => admin('tenants').then((t) => { setError(''); setList(t) })
    .catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])

  const close = () => setEditing(null)
  const openJobs = (t) => { try { sessionStorage.setItem('ad-jobs-tenant', String(t.tenant_key)) } catch { /* */ } go('/etl/jobs') }

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>Tenants</h1>
          <p>Your saved D365 environments. Data loading lives under ETL › Jobs.</p>
        </div>
        <button className="hero-cta" onClick={() => setEditing('new')}>+ New tenant</button>
      </div>

      {toast && <div className="alert good" style={{ marginBottom: 16 }}>{toast}</div>}
      {error && (
        <div className="alert bad row" style={{ marginBottom: 16 }}>
          <span>Could not load tenants: {error}</span>
          <button onClick={load}>Retry</button>
        </div>
      )}
      {!list && !error && <div className="card muted">Loading tenants…</div>}

      {list && !list.length && (
        <div className="card empty">
          <h2>No tenants yet</h2>
          <p className="muted">Add your first Dynamics 365 environment to start loading data.</p>
          <button className="primary" onClick={() => setEditing('new')}>+ New tenant</button>
        </div>
      )}

      {list?.length > 0 && (
        <div className="tenant-grid">
          {list.map((t) => (
            <article key={t.tenant_key} className="card tenant-card">
              <div className="row">
                <h2>{t.name}</h2>
                <span className={t.is_active ? 'pill ok' : 'pill'}>{t.is_active ? 'Active' : 'Paused'}</span>
              </div>
              <div className="kv">
                <span>Environment</span><span className="ellipsis" title={t.base_url}>{t.base_url.replace('https://', '')}</span>
                <span>Default company</span><span>{t.default_company || '–'}</span>
                <span>Client ID</span><span className="mono ellipsis" title={t.client_id}>{t.client_id}</span>
                <span>Last test</span>
                <span>{t.last_test_at
                  ? <><span className={t.last_test_ok ? 'up' : 'down'}>{t.last_test_ok ? 'Passed' : 'Failed'}</span> · {fmtTime(t.last_test_at)}</>
                  : '–'}</span>
                <span>Last ETL</span>
                <span>{t.last_sync_status ? <><span className={pill(t.last_sync_status)}>{t.last_sync_status}</span> {fmtTime(t.last_sync_at)}</> : 'Never'}</span>
              </div>
              <div className="row tight">
                <button onClick={() => setEditing(t)}>Edit</button>
                <button className="primary" onClick={() => openJobs(t)}>Open Jobs</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'New tenant' : `Edit tenant — ${editing.name}`} onClose={close}>
          <ConnectionForm bare key={editing === 'new' ? 'new' : editing.tenant_key}
                          tenant={editing === 'new' ? undefined : editing}
                          onSaved={(saved) => { close(); load(); setToast(`Tenant "${saved?.name || ''}" saved.`) }}
                          onDeleted={() => { close(); load(); setToast('Tenant deleted.') }} />
        </Modal>
      )}
    </div>
  )
}
