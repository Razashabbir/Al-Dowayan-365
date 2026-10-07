/* Sidebar icons. Each has its own class so it gets its own hover animation (styles.css "icon animations"). */
const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export const IconHome = () => (
  <svg {...base} className="ic ic-home">
    <path className="roof" d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path className="door" d="M10 21v-6h4v6" />
  </svg>
)
export const IconEtl = () => (
  <svg {...base} className="ic ic-etl">
    <ellipse className="disk d1" cx="12" cy="5" rx="8" ry="3" />
    <path className="disk d2" d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path className="disk d3" d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
)
export const IconChart = () => (
  <svg {...base} className="ic ic-dash">
    <path className="bar b1" d="M4 20V10" /><path className="bar b2" d="M10 20V4" /><path className="bar b3" d="M16 20v-7" />
    <path d="M22 20H2" />
  </svg>
)
export const IconTenant = () => (
  <svg {...base} className="ic ic-tenants">
    <g className="srv s1"><rect x="3" y="4" width="18" height="6" rx="2" /><path className="led" d="M7 7h.01" /></g>
    <g className="srv s2"><rect x="3" y="14" width="18" height="6" rx="2" /><path className="led" d="M7 17h.01" /></g>
  </svg>
)
export const IconJobs = () => (
  <svg {...base} className="ic ic-jobs">
    <circle cx="12" cy="12" r="9" /><path className="hand" d="M12 7v5l3 2" />
  </svg>
)
export const IconCounts = () => (
  <svg {...base} className="ic ic-counts">
    <path className="ln l1" d="M4 6h16" /><path className="ln l2" d="M4 12h16" /><path className="ln l3" d="M4 18h10" />
  </svg>
)
export const IconHistory = () => (
  <svg {...base} className="ic ic-history">
    <g className="rewind"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></g><path className="hand" d="M12 8v4l3 2" />
  </svg>
)
export const IconChevron = ({ open }) => <svg {...base} className={`chev ${open ? 'open' : ''}`}><path d="m9 6 6 6-6 6" /></svg>
export const IconMenu = () => <svg {...base}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
export const IconLock = () => <svg {...base} width={14} height={14} className="ic-lock"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>

/* dashboard sub-menu icons - each one has its own hover animation (styles.css "dashboard icon animations") */
export const IconGauge = () => (
  <svg {...base} className="ic ic-gauge"><path d="M4 18a8 8 0 1 1 16 0" /><path className="needle" d="M12 18l4-5" /><path d="M12 18h.01" /></svg>
)
export const IconTrend = () => (
  <svg {...base} className="ic ic-trend"><path className="line" pathLength="1" d="M3 17l6-6 4 4 8-8" /><path className="tip" d="M15 7h6v6" /></svg>
)
export const IconScale = () => (
  <svg {...base} className="ic ic-scale">
    <path d="M12 4v16M8 20h8" />
    <g className="beam"><path d="M5 8h14" /><path d="M5 8l-3 6h6z" /><path d="M19 8l-3 6h6z" /></g>
  </svg>
)
export const IconList = () => (
  <svg {...base} className="ic ic-tb">
    <g className="row r1"><path d="M3 6h.01M8 6h13" /></g>
    <g className="row r2"><path d="M3 12h.01M8 12h13" /></g>
    <g className="row r3"><path d="M3 18h.01M8 18h13" /></g>
  </svg>
)
export const IconWallet = () => (
  <svg {...base} className="ic ic-wallet">
    <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 11h18" />
    <circle className="coin" cx="16" cy="4" r="2" /><path d="M16 15h.01" />
  </svg>
)
export const IconCash = () => (
  <svg {...base} className="ic ic-cash">
    <g className="note"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></g>
    <path className="spark" d="M6 9v.01M18 15v.01" />
  </svg>
)
export const IconSwap = () => (
  <svg {...base} className="ic ic-swap"><path className="top" d="M4 8h14l-3-3" /><path className="bottom" d="M20 16H6l3 3" /></svg>
)
export const IconFolder = () => (
  <svg {...base} className="ic ic-folder">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path className="lid" d="M3 10h18" /><path className="doc" d="M8 14h8" />
  </svg>
)

/* Reports module icons - each with its own hover animation (styles.css "report icon animations") */
export const IconReport = () => (
  <svg {...base} className="ic ic-report">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path className="fold" d="M14 3v6h6" />
    <path className="ln l1" d="M8 13h8" /><path className="ln l2" d="M8 17h5" />
  </svg>
)
export const IconReceipt = () => (
  <svg {...base} className="ic ic-receipt">
    <g className="paper"><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
      <path className="ln l1" d="M9 8h6" /><path className="ln l2" d="M9 12h6" /><path className="ln l3" d="M9 16h3" /></g>
  </svg>
)
export const IconPillars = () => (
  <svg {...base} className="ic ic-pillars">
    <path d="M3 21h18" /><rect className="p1" x="5" y="9" width="5" height="11" rx="1" /><rect className="p2" x="14" y="9" width="5" height="11" rx="1" />
    <path className="cap" d="M3 7l9-4 9 4" />
  </svg>
)
export const IconLink = () => (
  <svg {...base} className="ic ic-link">
    <path className="k1" d="M10 14a4 4 0 0 1 0-5.7l2.3-2.3a4 4 0 0 1 5.7 5.7l-1.2 1.2" />
    <path className="k2" d="M14 10a4 4 0 0 1 0 5.7l-2.3 2.3a4 4 0 0 1-5.7-5.7l1.2-1.2" />
  </svg>
)
export const IconBook = () => (
  <svg {...base} className="ic ic-book">
    <path d="M12 6v14" /><path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5" />
    <path className="page" d="M12 6c2-1.5 5-2 8-1.5V19c-3-.5-6 0-8 1.5" />
  </svg>
)
export const IconSliders = () => (
  <svg {...base} className="ic ic-sliders">
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle className="k1" cx="8" cy="6" r="2" /><circle className="k2" cx="16" cy="12" r="2" /><circle className="k3" cx="10" cy="18" r="2" />
  </svg>
)

/* User Roles and System Health */
export const IconUsers = () => (
  <svg {...base} className="ic ic-users">
    <g className="p1"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /></g>
    <g className="p2"><circle cx="17" cy="9" r="2.6" /><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8" /></g>
  </svg>
)
export const IconPulse = () => (
  <svg {...base} className="ic ic-pulse">
    <path className="beat" pathLength="1" d="M2 12h4l2.5-6 4 12 2.5-6H22" />
  </svg>
)

export const IconLogs = () => (
  <svg {...base} className="ic ic-logs">
    <rect x="4" y="3" width="13" height="18" rx="2" />
    <g className="rows"><path d="M7.5 8h6" /><path d="M7.5 12h6" /><path d="M7.5 16h3" /></g>
    <g className="lens"><circle cx="17" cy="16" r="3" /><path d="m19.2 18.2 2.3 2.3" /></g>
  </svg>
)

/* Adjustments module + Cash Flow report */
export const IconAdjust = () => (
  <svg {...base} className="ic ic-adjust">
    <circle cx="12" cy="12" r="9" /><g className="pm"><path d="M8 9.5h3M9.5 8v3" /><path d="M13 14.5h3" /></g><path className="slash" d="M15 8l-6 8" />
  </svg>
)
export const IconJournal = () => (
  <svg {...base} className="ic ic-journal">
    <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" /><path d="M8 8h7M8 12h5" />
    <path className="pen" d="M14 19l6-6 2 2-6 6h-2z" />
  </svg>
)
export const IconLayers = () => (
  <svg {...base} className="ic ic-layers">
    <path className="l1" d="M12 3l9 5-9 5-9-5z" /><path className="l2" d="M3 12l9 5 9-5" /><path className="l3" d="M3 16l9 5 9-5" />
  </svg>
)
export const IconCashFlow = () => (
  <svg {...base} className="ic ic-cf">
    <g className="note"><rect x="5.5" y="6" width="13" height="12" rx="2" /><circle className="coin" cx="12" cy="12" r="2.5" /></g>
    <path className="fin" d="M1 9.5h3m-1.5-1.5 1.5 1.5-1.5 1.5" /><path className="fout" d="M20 14.5h3m-1.5-1.5 1.5 1.5-1.5 1.5" />
  </svg>
)

/* System Configuration and AI Assistant */
export const IconGear = () => (
  <svg {...base} className="ic ic-gear">
    <g className="cog">
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
      <circle cx="12" cy="12" r="5.2" />
    </g>
    <circle className="hub" cx="12" cy="12" r="1.8" />
  </svg>
)
export const IconSparkle = () => (
  <svg {...base} className="ic ic-ai">
    <path className="star" d="M11 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
    <path className="mini m1" d="M18.5 15.5v4M16.5 17.5h4" /><path className="mini m2" d="M5 17.5v2.5M3.75 18.75h2.5" />
  </svg>
)
export const IconManual = () => (
  <svg {...base} className="ic ic-manual">
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
    <path className="q" d="M10.2 8.6a2 2 0 1 1 2.6 1.9c-.5.2-.8.6-.8 1.1v.4" /><circle className="dot" cx="12" cy="14.6" r=".4" />
  </svg>
)

/* ---- planning, close & operations modules ---- */
export const IconTarget = () => (
  <svg {...base} className="ic ic-target">
    <circle cx="12" cy="12" r="8.5" /><circle className="ring" cx="12" cy="12" r="4.5" />
    <path className="dart" d="M12 12 20 4m0 0h-3.5M20 4v3.5" />
  </svg>
)
export const IconForecast = () => (
  <svg {...base} className="ic ic-forecast">
    <path d="M3 20.5h18" /><path d="M4 16l4-4 3.5 2.5L15 10" />
    <path className="proj" d="M15 10l5-5m0 0h-3.5M20 5v3.5" strokeDasharray="2.2 2.2" />
  </svg>
)

export const IconHourglass = () => (
  <svg {...base} className="ic ic-hour">
    <g className="glass"><path d="M6 3h12M6 21h12" /><path d="M7 3c0 5 10 5 10 9s-10 4-10 9" /><path d="M17 3c0 5-10 5-10 9s10 4 10 9" /></g>
    <path className="sand" d="M10 18.5h4" />
  </svg>
)
export const IconCart = () => (
  <svg {...base} className="ic ic-cart">
    <g className="cart"><path d="M3 4h2.5l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.1L20 8H6.3" />
      <circle cx="9.5" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></g>
  </svg>
)
export const IconTruck = () => (
  <svg {...base} className="ic ic-truck">
    <g className="truck"><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7" /><circle cx="7" cy="17.5" r="1.7" /><circle cx="17" cy="17.5" r="1.7" /></g>
    <path className="speed" d="M1 9.5h-.5M1 12h-.5" />
  </svg>
)
export const IconBuilding = () => (
  <svg {...base} className="ic ic-building">
    <path d="M4 21V8l8-5 8 5v13" /><path d="M3 21h18" />
    <g className="win"><path d="M9 11h.01M15 11h.01M9 15h.01M15 15h.01" strokeWidth="2.6" /></g>
    <path d="M10.5 21v-3h3v3" />
  </svg>
)
export const IconClose = () => (
  <svg {...base} className="ic ic-close">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path className="tick" pathLength="1" d="m9 15 2.2 2.2L15.5 13" />
  </svg>
)
export const IconPadlock = () => (
  <svg {...base} className="ic ic-padlock">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path className="shackle" d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    <path d="M12 15v2.5" />
  </svg>
)
export const IconMerge = () => (
  <svg {...base} className="ic ic-merge">
    <circle className="c1" cx="7" cy="6" r="2.5" /><circle className="c2" cx="17" cy="6" r="2.5" /><circle cx="12" cy="18.5" r="2.5" />
    <path d="M7 8.5c0 4 5 4 5 7.5M17 8.5c0 4-5 4-5 7.5" />
  </svg>
)
export const IconRecon = () => (
  <svg {...base} className="ic ic-recon">
    <path className="a1" d="M4 8h13m0 0-3-3m3 3-3 3" /><path className="a2" d="M20 16H7m0 0 3-3m-3 3 3 3" />
  </svg>
)
export const IconBell = () => (
  <svg {...base} className="ic ic-bell">
    <g className="bell"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></g>
  </svg>
)
export const IconMail = () => (
  <svg {...base} className="ic ic-mail">
    <rect x="3" y="5.5" width="18" height="13" rx="2" /><path className="flap" d="m3.5 7 8.5 6 8.5-6" />
  </svg>
)
export const IconCollapse = ({ collapsed }) => (
  <svg {...base} className={`ic ic-collapse ${collapsed ? 'is-collapsed' : ''}`}>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M9.5 4v16" />
    <path className="arrow" d="m15.5 9.5-2.5 2.5 2.5 2.5" />
  </svg>
)

/** Avatar icon for the signed-in user's role (top bar + sidebar footer); animates when its button / row is hovered. */
export function RoleIcon({ role }) {
  const r = String(role || '').toLowerCase()
  const p = { ...base, width: 16, height: 16, strokeWidth: 2 }
  if (r === 'admin') {
    return (
      <svg {...p} className="ic role-ic role-ic-admin">
        <path className="shield" d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6l-7-3z" />
        <path className="tick" pathLength="1" d="m9 12 2.2 2.2L15.5 10" />
      </svg>
    )
  }
  if (r === 'accountant') {
    return (
      <svg {...p} className="ic role-ic role-ic-accountant">
        <rect x="5" y="3" width="14" height="18" rx="2.5" />
        <rect className="screen" x="8" y="6" width="8" height="3.5" rx=".8" />
        <g className="keys"><path d="M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 17h.01M12 17h.01M15.5 17h.01" strokeWidth="2.6" /></g>
      </svg>
    )
  }
  if (r === 'finance') {
    return (
      <svg {...p} className="ic role-ic role-ic-finance">
        <path d="M4 20h16" />
        <path className="bar b1" d="M7 20v-5" /><path className="bar b2" d="M12 20v-8" /><path className="bar b3" d="M17 20v-11" />
        <path className="trend" pathLength="1" d="m5 11 5-4 3 2 6-5" />
      </svg>
    )
  }
  return (
    <svg {...p} className="ic role-ic role-ic-viewer">
      <g className="eye"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle className="pupil" cx="12" cy="12" r="2.8" /></g>
    </svg>
  )
}
