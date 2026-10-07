import { useEffect, useState } from 'react'
import { LayoutGroup } from 'framer-motion'
import { useAuth } from '../auth'
import { LogoMark, useConfig } from '../config'
import { motion, useReducedMotion } from './motion'
import {
  IconAdjust, IconBell, IconBook, IconBuilding, IconCart, IconCash, IconCashFlow, IconChart, IconChevron, IconClose, IconCollapse,
  IconCounts, IconEtl, IconForecast, IconFolder, IconGauge, IconGear, IconHistory, IconHome, IconHourglass, IconJobs, IconJournal, IconLayers,
  IconLink, IconList, IconLogs, IconMail, IconManual, IconMerge, IconPadlock, IconPillars, IconPulse, IconReceipt, IconRecon,
  IconReport, IconScale, RoleIcon, IconSliders, IconSparkle, IconSwap, IconTarget, IconTenant, IconTrend, IconTruck, IconUsers, IconWallet,
} from './Icons'

export const ETL_ITEMS = [
  { path: '/etl/tenants', label: 'Tenants', icon: IconTenant },
  { path: '/etl/jobs', label: 'Jobs', icon: IconJobs },
  { path: '/etl/counts', label: 'Counts', icon: IconCounts },
  { path: '/etl/history', label: 'History', icon: IconHistory },
]

export const DASH_ITEMS = [
  { path: '/dashboards/overview', label: 'Overview', icon: IconGauge },
  { path: '/dashboards/profit-loss', label: 'Profit & Loss', icon: IconTrend },
  { path: '/dashboards/balance-sheet', label: 'Balance Sheet', icon: IconScale },
  { path: '/dashboards/trial-balance', label: 'Trial Balance', icon: IconList },
  { path: '/dashboards/expenses', label: 'Expenses', icon: IconWallet },
  { path: '/dashboards/cash', label: 'Cash & Bank', icon: IconCash },
  { path: '/dashboards/ar-ap', label: 'Receivables & Payables', icon: IconSwap },
  { path: '/dashboards/projects', label: 'Projects', icon: IconFolder },
  { path: '/dashboards/sales', label: 'Sales', icon: IconCart },
  { path: '/dashboards/purchasing', label: 'Purchasing', icon: IconTruck },
  { path: '/dashboards/fixed-assets', label: 'Fixed Assets', icon: IconBuilding },
]

export const REPORT_ITEMS = [
  { path: '/reports/income-statement', label: 'Income Statement', icon: IconReceipt },
  { path: '/reports/balance-sheet', label: 'Financial Position', icon: IconPillars },
  { path: '/reports/tb-mapping', label: 'Trial Balance Mapping', icon: IconLink },
  { path: '/reports/cash-flow', label: 'Cash Flow', icon: IconCashFlow },
  { path: '/reports/notes', label: 'Notes', icon: IconBook },
  { path: '/reports/mapping', label: 'FS Mapping', icon: IconSliders },
  { path: '/reports/budget', label: 'Budget vs Actual', icon: IconTarget },
  { path: '/reports/ageing', label: 'Customer & Vendor Ageing', icon: IconHourglass },
  { path: '/reports/cash-forecast', label: 'Cash Flow Forecast', icon: IconForecast },
]

export const ADJ_ITEMS = [
  { path: '/adjustments/journal', label: 'Adjustments & Eliminations', icon: IconJournal },
  { path: '/adjustments/worksheet', label: 'Adjusted Statements', icon: IconLayers },
]

export const CLOSE_ITEMS = [
  { path: '/close/period', label: 'Period Close', icon: IconPadlock, perm: 'close.view' },
  { path: '/close/consolidation', label: 'Consolidation', icon: IconMerge, perm: 'consol.view' },
  { path: '/close/reconciliation', label: 'Reconciliation', icon: IconRecon, perm: 'recon.view' },
]

export const ADMIN_ITEMS = [
  { path: '/admin/users', label: 'User Management', icon: IconUsers, perm: 'users.manage' },
  { path: '/admin/health', label: 'System Health', icon: IconPulse, perm: 'health.view' },
  { path: '/admin/audit', label: 'Audit Logs', icon: IconLogs, perm: 'audit.view' },
  { path: '/admin/alerts', label: 'Alerts', icon: IconBell, perm: 'alerts.view' },
  { path: '/admin/report-pack', label: 'Report Pack', icon: IconMail, perm: 'pack.manage' },
  { path: '/admin/config', label: 'System Configuration', icon: IconGear, perm: 'config.manage' },
]

const read = () => { try { return localStorage.getItem('ad-side') === 'collapsed' } catch { return false } }

/** The sidebar is collapsed to an icon rail (desktop only); remembered in this browser. */
export function useSidebarState() {
  const [collapsed, setCollapsed] = useState(read)
  useEffect(() => { try { localStorage.setItem('ad-side', collapsed ? 'collapsed' : 'open') } catch { /* private mode */ } }, [collapsed])
  return [collapsed, setCollapsed]
}

/** One collapsible group that opens by itself when one of its pages is shown. */
function Group({ prefix, label, Icon, items, route, item, collapsed, expand, openGroups, setOpenGroups }) {
  const inside = route.startsWith(prefix)
  const open = openGroups.includes(prefix)
  const setOpen = (v) => setOpenGroups((gs) => (v ? [...gs.filter((x) => x !== prefix), prefix] : gs.filter((x) => x !== prefix)))   // other groups stay as they are
  const reduce = useReducedMotion()
  const click = () => {
    if (collapsed) { expand(); setOpen(true); return }      // icon rail: open the sidebar on this group
    setOpen(!open)
  }
  return (
    <>
      <button className={`nav-item group ${inside && (!open || collapsed) ? 'active' : ''}`} onClick={click} aria-expanded={open && !collapsed} title={collapsed ? label : undefined}>
        {inside && (!open || collapsed) && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
        <Icon /><span className="nav-label">{label}</span><IconChevron open={open} />
      </button>
      {open && !collapsed && (
        <motion.div className="subnav" key="sub" initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
          {items.map((i) => item(i.path, i.label, i.icon))}
        </motion.div>
      )}
    </>
  )
}

export default function Sidebar({ route, go, collapsed, setCollapsed }) {
  const { user, can, canPage } = useAuth()
  const { config } = useConfig()
  const dash = DASH_ITEMS.filter((i) => canPage(i.path))
  const reps = REPORT_ITEMS.filter((i) => canPage(i.path))
  const adjs = ADJ_ITEMS.filter((i) => canPage(i.path))
  const close = CLOSE_ITEMS.filter((i) => can(i.perm))
  const item = (path, label, Icon) => (
    <button key={path} className={`nav-item ${route === path ? 'active' : ''}`} onClick={() => go(path)}
            aria-current={route === path ? 'page' : undefined} title={collapsed ? label : undefined}>
      {route === path && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
      <Icon /><span className="nav-label">{label}</span>
    </button>
  )
  const current = ['/etl', '/dashboards', '/reports', '/adjustments', '/close'].find((p) => route.startsWith(p)) || null
  const [openGroups, setOpenGroups] = useState(current ? [current] : [])
  useEffect(() => { if (current) setOpenGroups((gs) => (gs.includes(current) ? gs : [...gs, current])) }, [current])
  const g = { route, item, collapsed, expand: () => setCollapsed(false), openGroups, setOpenGroups }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="side-glow" aria-hidden="true"><span /><span /><span /></div>
      <div className="logo">
        <LogoMark />
        <div className="logo-text"><b data-no-tr={config.company_name !== 'Al-Dowayan' || undefined}>{config.company_name}</b><span>{config.tagline}</span></div>
        <button className="side-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
                title={collapsed ? 'Expand' : 'Collapse'} aria-expanded={!collapsed}>
          <IconCollapse collapsed={collapsed} />
        </button>
      </div>
      <LayoutGroup id="nav">
        <nav className="nav" aria-label="Main">
          {can('home.view') && item('/home', 'Home', IconHome)}
          {can('etl.view') && <Group prefix="/etl" label="ETL" Icon={IconEtl} items={ETL_ITEMS} {...g} />}
          {can('dashboards.view') && dash.length > 0 && <Group prefix="/dashboards" label="Dashboards" Icon={IconChart} items={dash} {...g} />}
          {can('reports.view') && reps.length > 0 && <Group prefix="/reports" label="Reports" Icon={IconReport} items={reps} {...g} />}
          {can('adjust.view') && adjs.length > 0 && <Group prefix="/adjustments" label="Adjustments" Icon={IconAdjust} items={adjs} {...g} />}
          {close.length > 0 && <Group prefix="/close" label="Close & Consolidation" Icon={IconClose} items={close} {...g} />}
          {ADMIN_ITEMS.filter((i) => can(i.perm)).map((i) => item(i.path, i.label, i.icon))}
          {item('/help/manual', 'System Manual', IconManual)}
          {can('ai.use') && item('/ai/assistant', 'AI Assistant', IconSparkle)}
        </nav>
      </LayoutGroup>
      {user && (
        <div className="foot">
          <span className={`foot-avatar role-av-${user.role.toLowerCase()}`} aria-hidden="true"><RoleIcon role={user.role} /></span>
          <span className="foot-text"><span data-no-tr>{user.full_name || user.username}</span> · <span>{user.role}</span></span>
        </div>
      )}
    </aside>
  )
}
