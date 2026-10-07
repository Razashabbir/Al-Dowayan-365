/* Coloured pill for a D365 main-account type (Asset, Liability, Equity, Revenue, Expense ...). */
const KIND = {
  asset: 'asset', liability: 'liability', equity: 'equity',
  revenue: 'revenue', 'operating revenue': 'revenue',
  expense: 'expense', 'operating expense': 'expense', 'cost of goods sold': 'expense',
  profitandloss: 'pl', 'profit and loss': 'pl', balancesheet: 'bs', 'balance sheet': 'bs',
}
const LABEL = { profitandloss: 'Profit and loss', balancesheet: 'Balance sheet' }

export default function TypeBadge({ type }) {
  if (!type) return <span className="muted">–</span>
  const k = String(type).toLowerCase()
  return <span className={`type-badge tb-${KIND[k] || 'other'}`}>{LABEL[k] || type}</span>
}
