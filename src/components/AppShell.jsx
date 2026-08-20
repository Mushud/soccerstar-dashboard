import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'

/**
 * Persistent chrome for every screen: a sidebar on desktop, a slide-in drawer plus a bottom
 * tab bar on mobile, and a sticky topbar each page fills with its own title and actions.
 *
 * Before this existed every page painted its own nav strip and its own background colour —
 * four different blacks across six routes — so moving between screens felt like moving
 * between apps. Pages now render `<AppShell title=… actions=…>` and own only their content.
 */

const NAV = [
  {
    label: 'Betting',
    items: [
      { to: '/',            icon: '⚽', text: 'Matches',     match: p => p === '/' && !p.includes('view') },
      { to: '/?view=live',  icon: '🔴', text: 'Live',        live: true },
      { to: '/bet-builder', icon: '🎯', text: 'Bet Builder' },
      { to: '/betslip',     icon: '🧾', text: 'Bet Slip' },
      { to: '/slips',       icon: '🎟', text: 'Booked Slips' },
    ],
  },
  {
    label: 'Competitions',
    items: [
      { to: '/tournaments', icon: '🏆', text: 'Tournaments' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/?view=backtest', icon: '📈', text: 'Model & Backtest' },
      { to: '/aliases',        icon: '🔗', text: 'Team Aliases' },
    ],
  },
]

const TABS = [
  { to: '/',            icon: '⚽', text: 'Matches' },
  { to: '/bet-builder', icon: '🎯', text: 'Builder' },
  { to: '/betslip',     icon: '🧾', text: 'Slip' },
  { to: '/tournaments', icon: '🏆', text: 'Cups' },
]

/** Active when the path matches and, for the Dashboard's three in-page views, the view too. */
function isActive(to, pathname, view) {
  const [path, qs] = to.split('?')
  if (path !== pathname) return false
  const wanted = qs ? new URLSearchParams(qs).get('view') : null
  if (path !== '/') return true
  return (wanted ?? 'upcoming') === (view ?? 'upcoming')
}

export default function AppShell({ title, subtitle, actions, children, wide = true }) {
  const { pathname, search } = useLocation()
  const [drawer, setDrawer] = useState(false)
  const view = new URLSearchParams(search).get('view')

  // A tap on a drawer link should navigate and close, never leave the drawer hanging open
  // over the page it just moved to.
  useEffect(() => { setDrawer(false) }, [pathname, search])

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawer])

  return (
    <div className="shell">
      <aside className={`sidebar${drawer ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">⚡</div>
          <div>
            <div className="brand-name">SoccerStar</div>
            <div className="brand-sub">Predictions</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(group => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(item => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-item${isActive(item.to, pathname, view) ? ' active' : ''}`}
                >
                  <span className="nav-ico">{item.icon}</span>
                  {item.text}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div style={{ fontSize: 10.5, color: 'var(--tx-4)', lineHeight: 1.5 }}>
            Model blends Poisson · ELO · market odds.<br />Predictions are not guarantees.
          </div>
        </div>
      </aside>

      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn nav-toggle" onClick={() => setDrawer(true)} aria-label="Open menu">☰</button>
          <div style={{ minWidth: 0 }}>
            <div className="topbar-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {title}
            </div>
            {subtitle && <div className="topbar-sub hide-sm">{subtitle}</div>}
          </div>
          <div className="topbar-spacer" />
          {actions}
        </header>

        <main className={`page${wide ? '' : ' page-narrow'}`}>{children}</main>
      </div>

      <nav className="bottomnav">
        {TABS.map(t => (
          <Link key={t.to} to={t.to} className={pathname === t.to ? 'active' : ''}>
            <span className="nav-ico">{t.icon}</span>
            {t.text}
          </Link>
        ))}
        <button
          onClick={() => setDrawer(true)}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: 'var(--tx-3)' }}
        >
          <span className="nav-ico" style={{ fontSize: 17, lineHeight: 1 }}>☰</span>
          More
        </button>
      </nav>
    </div>
  )
}
