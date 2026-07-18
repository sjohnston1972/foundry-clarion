import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import type { ComponentType } from 'react'
import { Phone, Users, ListOrdered, LayoutDashboard, BarChart3, Settings, Workflow } from 'lucide-react'
import type { AuthStatus } from '../lib/session'
import { cn } from '../lib/utils'

/**
 * Clarion's own shell — mirrors Workspace's *structure* (sidebar nav, header,
 * Outlet) on the vendored design-system primitives. Not a port of Workspace's
 * AppShell.tsx (641 lines, wired into departments/plans/billing/tickets/a
 * command palette Clarion doesn't have) — see CLAUDE.md §14.
 */
const RANK = { agent: 1, supervisor: 2, admin: 3 } as const
type Role = keyof typeof RANK

const NAV: Array<{ to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean; minRole?: Role }> = [
  { to: '/', label: 'Softphone', icon: Phone, end: true },
  { to: '/agents', label: 'Agents', icon: Users },
  { to: '/queues', label: 'Queues', icon: ListOrdered },
  { to: '/ivr', label: 'IVR flows', icon: Workflow, minRole: 'supervisor' },
  { to: '/wallboard', label: 'Wallboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', icon: BarChart3, minRole: 'supervisor' },
  { to: '/settings', label: 'Settings', icon: Settings, minRole: 'admin' },
]

export function AppShell() {
  const status = useOutletContext<AuthStatus>()
  const role = status.clarionRole
  const nav = NAV.filter((item) => !item.minRole || (role && RANK[role] >= RANK[item.minRole]))
  return (
    <div className="flex min-h-full">
      <aside className="w-56 shrink-0 border-r border-line bg-surface p-4">
        <div className="mb-6 px-2 font-display text-lg font-semibold tracking-tight text-ink">
          Foundry <span className="text-[var(--color-accent)]">Clarion</span>
        </div>
        <nav aria-label="Primary" className="space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-muted hover:bg-canvas hover:text-ink',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
          <div className="text-sm text-muted">
            <span className="font-mono">{status.email}</span>{' '}
            <span aria-hidden>·</span> <span className="font-mono text-ink">{status.clarionRole}</span>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet context={status} />
        </main>
      </div>
    </div>
  )
}
