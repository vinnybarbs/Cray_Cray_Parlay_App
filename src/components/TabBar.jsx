import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'

// Bottom tab bar (UI plan item 2, owner 2026-10-12). Every leading picks
// app puts its main screens one thumb tap away at the bottom. It shows on
// phones and tablets (below the lg breakpoint, 1024px, so iPad portrait
// keeps it). Desktop and iPad landscape get TopNav in the page header
// instead. Owner 2026-10-18: the bar used to stop at md (768px), which
// left iPad and desktop with no way around the app.

const TABS = [
  {
    to: '/today',
    label: 'Today',
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2.5" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </>
    ),
  },
  {
    to: '/props',
    label: 'Props',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
      </>
    ),
  },
  {
    to: '/digest',
    label: 'Board',
    icon: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  {
    to: '/tracked',
    label: 'Tracked',
    icon: (
      <>
        <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" />
      </>
    ),
  },
  {
    to: '/ledger',
    label: 'Ledger',
    icon: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M9 10h6M9 14h6M9 18h4" />
      </>
    ),
  },
  {
    to: '/account',
    label: 'Account',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="10" r="3" />
        <path d="M6.5 18.5c1.2-2.2 3.2-3.3 5.5-3.3s4.3 1.1 5.5 3.3" />
      </>
    ),
  },
]

// Desktop links: the six tabs plus the Pick builder, which has no tab of
// its own (its parlay slip sits where the bar would be).
const TOP_LINKS = [...TABS.slice(0, 3), { to: '/generator', label: 'Pick builder' }, ...TABS.slice(3)]

// Inline nav for page headers at lg and up, where the bottom bar is
// hidden. Every app page renders it in its sticky header so desktop and
// iPad landscape always have the same six places one click away.
export function TopNav({ className = '' }) {
  return (
    <nav aria-label="Main" className={`hidden lg:flex items-center gap-0.5 ${className}`}>
      {TOP_LINKS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:text-signal-pos ${isActive ? 'text-signal-pos bg-ink-900' : 'text-ink-300 hover:text-white hover:bg-ink-900/60'}`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

// Routes that get the bar. Landing, admin and the generator keep their
// own layouts.
export const TAB_ROUTES = new Set(TABS.map(t => t.to))

// Height of the bar above the safe area, shared with the spacer so page
// content never ends up underneath it.
const BAR_HEIGHT = '64px'

export default function TabBar() {
  const { pathname } = useLocation()
  if (!TAB_ROUTES.has(pathname)) return null

  return (
    <>
      <div aria-hidden="true" className="lg:hidden bg-ink-950" style={{ height: `calc(${BAR_HEIGHT} + env(safe-area-inset-bottom, 0px))` }} />
      <nav
        aria-label="Main"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-ink-950/95 backdrop-blur border-t border-ink-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="grid grid-cols-6 max-w-xl mx-auto" style={{ height: BAR_HEIGHT }}>
          {TABS.map(t => (
            <li key={t.to} className="flex">
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:text-signal-pos ${isActive ? 'text-signal-pos' : 'text-ink-300 active:text-ink-100'}`
                }
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {t.icon}
                </svg>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
