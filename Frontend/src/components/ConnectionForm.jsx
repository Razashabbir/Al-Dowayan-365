import { useState } from 'react'
import { admin, fmtTime } from '../api'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMPTY = { name: '', base_url: '', aad_tenant_id: '', client_id: '', client_secret: '', default_company: '', is_active: true }

function companyFromUrl(url) {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).searchParams.get('cmp') || '' } catch { return '' }
}

export default function ConnectionForm({ tenant, onSaved, onDeleted, bare = false }) {
  const isNew = !tenant
  const [f, setF] = useState(isNew ? EMPTY : { ...EMPTY, ...tenant, client_secret: '', default_company: tenant.default_company || '' })
  const [busy, setBusy] = useState('')
  const [test, setTest] = useState(null)
  const [msg, setMsg] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const problems = []
  if (!f.name.trim()) problems.push('name')
  if (!f.base_url.trim()) problems.push('environment URL')
  if (!GUID.test(f.aad_tenant_id.trim())) problems.push('directory (tenant) ID')
  if (!GUID.test(f.client_id.trim())) problems.push('application (client) ID')
  if (isNew && !f.client_secret.trim()) problems.push('client secret')
  const canTest = !problems.filter((p) => p !== 'name').length

  const onUrlBlur = () => {
    const cmp = companyFromUrl(f.base_url)
    if (cmp && !f.default_company) setF((x) => ({ ...x, default_company: cmp }))
  }

  const runTest = async () => {
    setBusy('test'); setTest(null)
    try {
      const r = await admin('test-connection', {
        method: 'POST', timeoutMs: 180000,
        body: { tenant_key: tenant?.tenant_key, aad_tenant_id: f.aad_tenant_id, client_id: f.client_id,
                client_secret: f.client_secret || null, base_url: f.base_url },
      })
      setTest(r)
      if (r.ok && !f.default_company && r.company_from_url) setF((x) => ({ ...x, default_company: r.company_from_url }))
    } catch (e) { setTest({ ok: false, message: e.message, companies: [] }) }
    setBusy('')
  }

  const save = async () => {
    setBusy('save'); setMsg(null)
    try {
      const saved = await admin(isNew ? 'tenants' : `tenants/${tenant.tenant_key}`, { method: isNew ? 'POST' : 'PUT', body: f })
      setMsg({ ok: true, text: isNew ? 'Connection saved. You can now sync data.' : 'Changes saved.' })
      setF((x) => ({ ...x, client_secret: '' }))
      onSaved?.(saved)
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy('')
  }

  const remove = async () => {
    setBusy('delete')
    try { await admin(`tenants/${tenant.tenant_key}`, { method: 'DELETE' }); onDeleted?.() }
    catch (e) { setMsg({ ok: false, text: e.message }); setBusy('') }
  }

  return (
    <section className={bare ? 'stack' : 'card stack'}>
      <div className="row">
        {!bare && <h2>{isNew ? 'New tenant' : f.name || 'Tenant'}</h2>}
        {!isNew && tenant.last_test_at && (
          <span className="muted small">
            Last test {fmtTime(tenant.last_test_at)}: <span className={tenant.last_test_ok ? 'up' : 'down'}>{tenant.last_test_ok ? 'passed' : 'failed'}</span>
          </span>
        )}
      </div>

      <div className="form-grid">
        <label>Tenant name
          <input value={f.name} onChange={set('name')} placeholder="Al-Dowayan UAT" />
        </label>
        <label>Default company
          <input value={f.default_company} onChange={set('default_company')} placeholder="03aa" maxLength={10} />
        </label>
        <label className="full">Environment URL
          <input value={f.base_url} onChange={set('base_url')} onBlur={onUrlBlur}
                 placeholder="https://your-env.sandbox.operations.uae.dynamics.com" />
          <span className="hint">Paste the browser link; the ?cmp=… part fills the default company.</span>
        </label>
        <label>Directory (tenant) ID
          <input value={f.aad_tenant_id} onChange={set('aad_tenant_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellCheck={false} />
        </label>
        <label>Application (client) ID
          <input value={f.client_id} onChange={set('client_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellCheck={false} />
        </label>
        <label className="full">Client secret
          <input type="password" autoComplete="new-password" value={f.client_secret} onChange={set('client_secret')}
                 placeholder={isNew ? 'Secret value from Entra ID → Certificates & secrets' : '•••••••• stored — leave blank to keep'} />
          <span className="hint">Stored encrypted on the server and never shown again.</span>
        </label>
        <label className="check full">
          <input type="checkbox" checked={f.is_active} onChange={set('is_active')} />
          Active — include in scheduled syncs and dashboards
        </label>
      </div>

      {test && (
        <div className={`alert ${test.ok ? 'good' : 'bad'}`}>
          <strong>{test.ok ? 'Connection works.' : 'Connection failed.'}</strong> {test.message}
          {test.companies?.length > 0 && (
            <div className="chips">
              {test.companies.map((c) => <span key={c.LegalEntityId} className="chip" title={c.Name}>{c.LegalEntityId} · {c.Name}</span>)}
            </div>
          )}
        </div>
      )}
      {msg && <div className={`alert ${msg.ok ? 'good' : 'bad'}`}>{msg.text}</div>}

      <div className="row">
        <div className="row tight">
          <button onClick={runTest} disabled={!canTest || !!busy}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
          <button className="primary" onClick={save} disabled={!!problems.length || !!busy}>
            {busy === 'save' ? 'Saving…' : isNew ? 'Save tenant' : 'Save changes'}
          </button>
        </div>
        {!isNew && (confirmDelete
          ? <div className="row tight">
              <span className="small down">Delete this tenant and all its loaded data?</span>
              <button className="danger" onClick={remove} disabled={!!busy}>Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          : <button className="link-danger" onClick={() => setConfirmDelete(true)}>Delete</button>)}
      </div>
      {problems.length > 0 && <p className="muted small">Still needed: {problems.join(', ')}.</p>}
    </section>
  )
}
