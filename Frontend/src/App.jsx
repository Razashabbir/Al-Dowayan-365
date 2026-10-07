import { useEffect, useState } from 'react'
import Sidebar, { ADJ_ITEMS, ADMIN_ITEMS, CLOSE_ITEMS, DASH_ITEMS, ETL_ITEMS, REPORT_ITEMS, useSidebarState } from './components/Sidebar'
import { useAuth } from './auth'
import Login, { ChangePassword } from './pages/Login'
import Users from './pages/Users'
import Health from './pages/Health'
import AuditLogs from './pages/AuditLogs'
import SystemConfig from './pages/SystemConfig'
import AiAssistant from './pages/AiAssistant'
import Manual from './pages/Manual'
import BudgetActual from './pages/rpt/BudgetActual'
import Ageing from './pages/rpt/Ageing'
import CashForecast from './pages/rpt/CashForecast'
import { FixedAssets, Purchasing, Sales } from './pages/dash/Analytics'
import PeriodClose from './pages/close/PeriodClose'
import Consolidation from './pages/close/Consolidation'
import Reconciliation from './pages/close/Reconciliation'
import Alerts from './pages/Alerts'
import ReportPack from './pages/ReportPack'
import { AskWidget, AssistantProvider } from './components/assistant'
import { BookmarkProvider } from './components/bookmarks'
import CashFlow from './pages/rpt/CashFlow'
import Journal from './pages/adj/Journal'
import Worksheet from './pages/adj/Worksheet'
import ErrorBoundary from './components/ErrorBoundary'
import { auth } from './api'
import Topbar from './components/Topbar'
import { t } from './i18n'
import { useApp } from './theme'
import { useConfig } from './config'
import Home from './pages/Home'
import Connections from './pages/Connections'
import Jobs from './pages/Jobs'
import Counts from './pages/Counts'
import History from './pages/History'
import Dashboard from './pages/Dashboard'
import ProfitLoss from './pages/dash/ProfitLoss'
import BalanceSheet from './pages/dash/BalanceSheet'
import TrialBalanceFull from './pages/dash/TrialBalanceFull'
import Expenses from './pages/dash/Expenses'
import CashBank from './pages/dash/CashBank'
import ReceivablesPayables from './pages/dash/ReceivablesPayables'
import Projects from './pages/dash/Projects'
import Statement from './pages/rpt/Statement'
import TbMapping from './pages/rpt/TbMapping'
import Notes from './pages/rpt/Notes'
import Mapping from './pages/rpt/Mapping'

const PAGES = {
  '/home': { title: 'Home', perm: 'home.view', el: (go) => <Home go={go} /> },
  '/etl/tenants': { title: 'Tenants', perm: 'etl.view', el: (go) => <Connections go={go} /> },
  '/etl/jobs': { title: 'Jobs', perm: 'etl.view', el: (go) => <Jobs go={go} /> },
  '/etl/counts': { title: 'Counts', perm: 'etl.view', el: () => <Counts /> },
  '/etl/history': { title: 'History', perm: 'etl.view', el: () => <History /> },
  '/dashboards/overview': { title: 'Overview', perm: 'dashboards.view', el: (go) => <Dashboard onSetup={() => go('/etl/tenants')} /> },
  '/dashboards/profit-loss': { title: 'Profit & Loss', perm: 'dashboards.view', el: () => <ProfitLoss /> },
  '/dashboards/balance-sheet': { title: 'Balance Sheet', perm: 'dashboards.view', el: () => <BalanceSheet /> },
  '/dashboards/trial-balance': { title: 'Trial Balance', perm: 'dashboards.view', el: () => <TrialBalanceFull /> },
  '/dashboards/expenses': { title: 'Expenses', perm: 'dashboards.view', el: () => <Expenses /> },
  '/dashboards/cash': { title: 'Cash & Bank', perm: 'dashboards.view', el: () => <CashBank /> },
  '/dashboards/ar-ap': { title: 'Receivables & Payables', perm: 'dashboards.view', el: () => <ReceivablesPayables /> },
  '/dashboards/projects': { title: 'Projects', perm: 'dashboards.view', el: () => <Projects /> },
  '/reports/income-statement': { title: 'Income Statement', perm: 'reports.view', el: () => <Statement key="IS" kind="IS" /> },
  '/reports/balance-sheet': { title: 'Financial Position', perm: 'reports.view', el: () => <Statement key="BS" kind="BS" /> },
  '/reports/tb-mapping': { title: 'Trial Balance Mapping', perm: 'reports.view', el: () => <TbMapping /> },
  '/reports/cash-flow': { title: 'Cash Flow', perm: 'reports.view', el: () => <CashFlow /> },
  '/reports/notes': { title: 'Notes', perm: 'reports.view', el: () => <Notes /> },
  '/reports/mapping': { title: 'FS Mapping', perm: 'reports.view', el: () => <Mapping /> },
  '/reports/budget': { title: 'Budget vs Actual', perm: 'reports.view', el: () => <BudgetActual /> },
  '/reports/ageing': { title: 'Customer & Vendor Ageing', perm: 'reports.view', el: (go) => <Ageing go={go} /> },
  '/reports/cash-forecast': { title: 'Cash Flow Forecast', perm: 'reports.view', el: (go) => <CashForecast go={go} /> },
  '/dashboards/sales': { title: 'Sales', perm: 'dashboards.view', el: () => <Sales /> },
  '/dashboards/purchasing': { title: 'Purchasing', perm: 'dashboards.view', el: () => <Purchasing /> },
  '/dashboards/fixed-assets': { title: 'Fixed Assets', perm: 'dashboards.view', el: () => <FixedAssets /> },
  '/close/period': { title: 'Period Close', perm: 'close.view', el: () => <PeriodClose /> },
  '/close/consolidation': { title: 'Consolidation', perm: 'consol.view', el: (go) => <Consolidation go={go} /> },
  '/close/reconciliation': { title: 'Reconciliation', perm: 'recon.view', el: () => <Reconciliation /> },
  '/adjustments/journal': { title: 'Adjustments & Eliminations', perm: 'adjust.view', el: () => <Journal /> },
  '/adjustments/worksheet': { title: 'Adjusted Statements', perm: 'adjust.view', el: () => <Worksheet /> },
  '/admin/users': { title: 'User Management', perm: 'users.manage', el: () => <Users /> },
  '/admin/health': { title: 'System Health', perm: 'health.view', el: () => <Health /> },
  '/admin/audit': { title: 'Audit Logs', perm: 'audit.view', el: () => <AuditLogs /> },
  '/admin/alerts': { title: 'Alerts', perm: 'alerts.view', el: (go) => <Alerts go={go} /> },
  '/admin/report-pack': { title: 'Report Pack', perm: 'pack.manage', el: () => <ReportPack /> },
  '/admin/config': { title: 'System Configuration', perm: 'config.manage', el: () => <SystemConfig /> },
  '/help/manual': { title: 'System Manual', perm: null, el: (go) => <Manual go={go} /> },
  '/ai/assistant': { title: 'AI Assistant', perm: 'ai.use', el: () => <AiAssistant /> },
}

function readRoute() {
  const h = location.hash.replace(/^#/, '')
  if (h === 'connections') return '/etl/tenants'   // old links
  if (h === 'dashboard' || h === '/dashboards') return '/dashboards/overview'
  if (h === '/reports') return '/reports/income-statement'
  if (h === '/adjustments') return '/adjustments/journal'
  if (h === '/close') return '/close/period'
  return PAGES[h] ? h : '/home'
}

export default function App() {
  const { user, state, can, canPage } = useAuth()
  const { font } = useApp()
  if (state === 'checking') return <div className="login-shell single"><div className="card muted">Signing in…</div></div>
  // key={font}: redraw the sign-in screens when the language changes (the Arabic text is put in by i18n.js, not React)
  if (!user) return <Login key={font} />
  if (user.must_change) return <ChangePassword key={font} forced />
  return <Shell can={can} canPage={canPage} />
}

function Shell({ can, canPage }) {
  const { font } = useApp()
  const { config, version } = useConfig()
  const [route, setRoute] = useState(readRoute)
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useSidebarState()

  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const go = (path) => { location.hash = path; setMenu(false) }
  // first page this role may open (a Viewer has no Home / ETL)
  const first = Object.keys(PAGES).find((k) => (!PAGES[k].perm || can(PAGES[k].perm)) && canPage(k)) || '/home'
  const page = PAGES[route]
  const allowed = (!page.perm || can(page.perm)) && canPage(route)
  // audit: which dashboard / report each user opens
  useEffect(() => {
    if (allowed && /^\/(dashboards|reports|adjustments)\//.test(route)) auth('track', { page: route, title: page.title }).catch(() => {})
  }, [route, allowed]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!allowed && route === '/home' && first !== '/home') go(first) }, [allowed, route, first]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.body.classList.toggle('no-export', !can('reports.export')) }, [can])
  const title = ETL_ITEMS.some((i) => i.path === route) ? `ETL · ${page.title}`
    : DASH_ITEMS.some((i) => i.path === route) ? `Dashboards · ${page.title}`
      : REPORT_ITEMS.some((i) => i.path === route) ? `Reports · ${page.title}`
        : ADJ_ITEMS.some((i) => i.path === route) ? `Adjustments · ${page.title}`
        : CLOSE_ITEMS.some((i) => i.path === route) ? `Close & Consolidation · ${page.title}`
        : ADMIN_ITEMS.some((i) => i.path === route) ? `Administration · ${page.title}` : page.title
  useEffect(() => { document.title = `${t(title)} · ${t(config.company_name)}` }, [title, font, config.company_name])

  return (
    <AssistantProvider>
    <BookmarkProvider>
    <div key={font} className={`shell ${menu ? 'menu-open' : ''} ${collapsed ? 'side-collapsed' : ''}`}>
      <Sidebar route={route} go={go} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="content" onClick={() => menu && setMenu(false)}>
        <Topbar title={title} go={go} route={route} onMenu={(e) => { e?.stopPropagation?.(); setMenu(true) }} />
        {allowed ? <ErrorBoundary key={version} resetKey={route}>{page.el(go)}</ErrorBoundary> : (
          <div className="page"><div className="card empty"><h2>No access</h2>
            <p className="muted">You cannot open {page.title}. Ask an Admin to give you access under User Management.</p>
            <button className="primary" onClick={() => go(first)}>Go to my start page</button></div></div>
        )}
      </div>
      <AskWidget route={route} go={go} />
    </div>
    </BookmarkProvider>
    </AssistantProvider>
  )
}
