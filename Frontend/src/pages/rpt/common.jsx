import { useState } from 'react'
import { amountsIn, fmt } from '../../api'
import { useConfig } from '../../config'
import { useDashScope } from '../dash/common'

/** Same tenant / company / year / month as the dashboards, plus "all companies combined". */
export function useReportScope() {
  const scope = useDashScope()
  const [combined, setCombined] = useState(false)
  const [basis, setBasis] = useState('final')
  return { ...scope, combined, setCombined, co: combined ? '*' : scope.company, basis, setBasis }
}

/** Ledger only / with adjustments / final (adjustments + eliminations when all companies are combined). */
export function BasisPicker({ scope }) {
  return (
    <label>Basis
      <select value={scope.basis} onChange={(e) => scope.setBasis(e.target.value)}>
        <option value="ledger">D365 ledger only</option>
        <option value="adjusted">With adjustments</option>
        <option value="final">{scope.combined ? 'Consolidated (adjustments + eliminations)' : 'Final (with adjustments)'}</option>
      </select>
    </label>
  )
}

export const BASIS_NOTE = {
  ledger: 'D365 ledger only, no adjustments',
  adjusted: 'D365 ledger plus posted adjustments and reclassifications',
  final: 'D365 ledger plus posted adjustments; eliminations are added when all companies are combined',
}

export function ScopePicker({ scope }) {
  return (
    <label>Companies
      <select value={scope.combined ? '*' : 'one'} onChange={(e) => scope.setCombined(e.target.value === '*')}>
        <option value="one">{scope.company || 'This company'}</option>
        <option value="*">All companies (combined)</option>
      </select>
    </label>
  )
}

/** Statement style numbers: negatives in brackets, zero as a dash. */
export const fsNum = (v) => {
  if (v == null || Math.abs(v) < 0.5) return '–'
  return v < 0 ? `(${fmt(-v)})` : fmt(v)
}

export function ReportHead({ scope, title, note }) {
  const { config } = useConfig()
  return (
    <div className="fs-head">
      <strong>{scope.tenantName || config.company_name}{scope.combined ? ' · all companies combined' : scope.company ? ` · ${scope.company}` : ''}</strong>
      <span>{title}</span>
      <small>{note || `${amountsIn()} (from Dynamics 365, same data as the dashboards)`}</small>
    </div>
  )
}

/** Explains which adjustment entries a statement includes and why others are not shown. */
export function AdjNotice({ s, basis, kind, year, combined }) {
  if (!s) return null
  const msgs = []
  if (basis === 'ledger' && s.posted) msgs.push(`${s.posted} posted adjustment entr${s.posted === 1 ? 'y is' : 'ies are'} not shown because Basis is “D365 ledger only”.`)
  if (s.drafts) msgs.push(`${s.drafts} draft entr${s.drafts === 1 ? 'y is' : 'ies are'} not included - post ${s.drafts === 1 ? 'it' : 'them'} under Adjustments › Adjustments & Eliminations.`)
  if (s.later) msgs.push(`${s.later} posted entr${s.later === 1 ? 'y is' : 'ies are'} dated after the end of this period - choose a later month or year.`)
  if (kind !== 'BS' && basis !== 'ledger' && s.posted && !s.posted_period)
    msgs.push(`The posted entries are dated before ${year}; this statement shows ${year} only - choose their year to see them.`)
  if (s.elims && !combined && basis !== 'ledger') msgs.push('Eliminations are applied only when Companies is “All companies (combined)”.')
  if (!combined && basis !== 'ledger' && s.other_companies?.length)
    msgs.push(`Posted adjustments of this period belong to ${s.other_companies.join(', ')} - pick that company in the top bar (or All companies combined) to see them.`)
  if (!msgs.length) return null
  return <div className="alert">{msgs.map((m) => <div key={m}>• {m}</div>)}</div>
}
