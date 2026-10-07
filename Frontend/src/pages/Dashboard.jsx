import { useEffect, useState } from 'react'
import { MotionCard } from '../components/motion'
import { NUM, api } from '../api'
import { useApp } from '../theme'
import KpiCards from '../components/KpiCards'
import PnlChart from '../components/PnlChart'
import TopExpenses from '../components/TopExpenses'
import TrialBalance from '../components/TrialBalance'
import EtlStatus from '../components/EtlStatus'
import { WhyEmpty } from './dash/common'
import { Hero3D } from '../components/three'

/** Financial dashboard for the tenant + company chosen in the top bar's company dropdown. */
export default function Dashboard({ onSetup }) {
  const { scope } = useApp()
  const tenant = scope?.tenant
  const company = scope?.company
  const [tenants, setTenants] = useState(null)
  const [years, setYears] = useState(null)
  const [year, setYear] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { api('tenants').then(setTenants).catch((e) => setError(e.message)) }, [])

  useEffect(() => {
    if (!tenant || !company) return
    setYears(null); setData(null); setError('')
    api('years', { tenant, company }).then((y) => {
      setYears(y.map((r) => r.year))
      setYear(y[0]?.year || '')
    }).catch((e) => setError(e.message))
  }, [tenant, company])

  useEffect(() => {
    if (!tenant || !company || !year) return
    setData(null)
    const p = { tenant, company, year }
    Promise.all([api('kpis', p), api('pnl-monthly', p), api('top-expenses', p), api('trial-balance', p)])
      .then(([kpis, pnl, top, tb]) => setData({ kpis, pnl, top, tb }))
      .catch((e) => setError(e.message))
  }, [tenant, company, year])

  if (tenants && !tenants.length) {
    return (
      <div className="page">
        <div className="card empty">
          <h2>No tenant yet</h2>
          <p className="muted">Add your Dynamics 365 environment and run the first ETL.</p>
          <button className="primary" onClick={onSetup}>Add a tenant</button>
        </div>
      </div>
    )
  }

  const tenantName = tenants?.find((t) => t.tenant_key === tenant)?.name

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div>
          <h1>Financial Dashboard</h1>
          <p>{tenantName ? `${tenantName} · company ${company} · ` : ''}amounts in {NUM.currency}</p>
        </div>
        <div className="filters">
          <label>
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={!years?.length}>
              {(years || []).map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
        </div>
      </header>

      {!company && !error && <div className="alert">Pick a company in the top-right company list.</div>}
      {!company && error && <div className="alert bad">Could not load data: {error}</div>}
      {company && (error || (years && !years.length)) && <WhyEmpty tenant={tenant} company={company} error={error} />}
      {company && years?.length > 0 && !data && !error && <div className="muted">Loading…</div>}

      {data && (
        <>
          <KpiCards k={data.kpis} year={year} />
          <div className="grid">
            <MotionCard as="section" hover={false} className="card wide"><PnlChart rows={data.pnl} /></MotionCard>
            <MotionCard as="section" hover={false} className="card"><TopExpenses rows={data.top} /></MotionCard>
          </div>
          <MotionCard as="section" hover={false} className="card"><TrialBalance rows={data.tb} year={year} /></MotionCard>
        </>
      )}
      {tenant && <EtlStatus tenant={tenant} />}
    </div>
  )
}
