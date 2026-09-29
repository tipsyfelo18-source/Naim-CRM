import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Users, Folder, UserPlus, Eye, CheckSquare, SquareKanban, Target,
  Calendar, Briefcase, Plus, BarChart3, Settings, Trash2, Menu, X, FileEdit, MessageCircle,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { canAccessPage } from '../../utils/permissions'

export const NAV_ITEMS = [
  { to: '/dashboard', page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/candidates', page: 'candidates', label: 'Candidates', icon: Users },
  { to: '/pipeline', page: 'pipeline', label: 'Pipeline', icon: SquareKanban },
  { to: '/leads', page: 'leads', label: 'Leads', icon: Target },
  { to: '/cv-builder', page: 'cv-builder', label: 'CV Builder', icon: FileEdit },
  { to: '/documents', page: 'documents', label: 'Documents', icon: Folder },
  { to: '/associates', page: 'associates', label: 'Associates', icon: UserPlus },
  { to: '/receptionist-view', page: 'receptionist-view', label: 'Receptionist View', icon: Eye },
  { to: '/tasks', page: 'tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/appointments', page: 'appointments', label: 'Appointments', icon: Calendar },
  { to: '/jobs', page: 'jobs', label: 'Jobs', icon: Briefcase },
  { to: '/job-generator', page: 'job-generator', label: 'Job Generator', icon: Plus },
  { to: '/whatsapp', page: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/reports', page: 'reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', page: 'settings', label: 'Settings', icon: Settings },
  { to: '/recycle-bin', page: 'recycle-bin', label: 'Recycle Bin', icon: Trash2 },
]

/**
 * Desktop: a 56px rail that expands to 256px.
 * Mobile (< md): hidden off-canvas drawer, opened from the header menu button.
 */
export default function Sidebar({ expanded, onToggle, mobileOpen = false, onCloseMobile }) {
  const { userProfile } = useAuth()
  const items = NAV_ITEMS.filter((item) => canAccessPage(userProfile, item.page))
  const wide = expanded || mobileOpen

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside
        id="app-sidebar"
        className={`fixed left-0 top-0 z-50 flex h-full flex-col border-r border-gray-200 bg-white transition-all duration-300 ${
          wide ? 'w-64' : 'w-14'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {wide ? (
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-6">
            <span className="flex flex-1 justify-center">
              <img src="/assets/naim-agency-logo.png" alt="Naim Agency logo" className="h-36 w-36 object-contain" />
            </span>
            <button
              type="button"
              onClick={mobileOpen ? onCloseMobile : onToggle}
              className="rounded-lg p-1.5 text-primary transition-colors hover:bg-cream-warm"
              title="Close menu"
              aria-label="Close menu"
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 border-b border-gray-200 px-2 py-3">
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-cream-warm hover:text-primary"
              title="Open menu"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <img src="/assets/naim-agency-logo.png" alt="Naim Agency logo" className="h-9 w-9 object-contain" />
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-4" aria-label="Main navigation">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                onClick={mobileOpen ? onCloseMobile : undefined}
                className={({ isActive }) =>
                  `mb-1 flex items-center rounded-lg transition-all duration-200 ${
                    wide ? 'gap-3 px-2.5 py-2' : 'justify-center p-2'
                  } ${
                    isActive ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:bg-cream-warm hover:text-primary'
                  }`
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                {wide ? <span className="truncate text-[13px] font-medium">{item.label}</span> : <span className="sr-only">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
