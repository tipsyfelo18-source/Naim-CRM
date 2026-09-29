import { Component, lazy, Suspense, useLayoutEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { isDemoMode, isMisconfiguredProduction } from './supabase/client'
import ConfigErrorScreen from './components/system/ConfigErrorScreen'
import DemoModeBanner from './components/system/DemoModeBanner'
import ErrorBoundary from './components/system/ErrorBoundary'
import { RouteSkeleton } from './components/ui/Skeleton'
import { canAccessPage } from './utils/permissions'
import { installOriginTrialToken } from './webmcp/registerTools'

// Phase 3.5: the WebMCP origin-trial token (public, origin-bound) must be in
// the document before any WebMCP feature detection runs.
installOriginTrialToken(import.meta.env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN)

// Phase 2: route-level code splitting. Each page is its own chunk.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'))
const CandidateProfilePage = lazy(() => import('./pages/CandidateProfilePage'))
const PipelinePage = lazy(() => import('./pages/PipelinePage'))
const LeadsPage = lazy(() => import('./pages/LeadsPage'))
const JobsPage = lazy(() => import('./pages/JobsPage'))
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AssociatesPage = lazy(() => import('./pages/AssociatesPage'))
const CVBuilderPage = lazy(() => import('./pages/CVBuilderPage'))
const JobGeneratorPage = lazy(() => import('./pages/JobGeneratorPage'))
const ReceptionistViewPage = lazy(() => import('./pages/ReceptionistViewPage'))
const WhatsAppPage = lazy(() => import('./pages/WhatsAppPage'))
const RecycleBinPage = lazy(() => import('./pages/RecycleBinPage'))
// Phase 3.5: WebMCP bridge (own chunk; a no-op in browsers without WebMCP).
const WebMCPBridge = lazy(() => import('./webmcp/WebMCPBridge'))

// path -> [page component, permission key]
export const PROTECTED_ROUTES = [
  ['/dashboard', DashboardPage, 'dashboard'],
  ['/candidates', CandidatesPage, 'candidates'],
  ['/candidates/:id', CandidateProfilePage, 'candidates'],
  ['/pipeline', PipelinePage, 'pipeline'],
  ['/leads', LeadsPage, 'leads'],
  ['/jobs', JobsPage, 'jobs'],
  ['/appointments', AppointmentsPage, 'appointments'],
  ['/tasks', TasksPage, 'tasks'],
  ['/documents', DocumentsPage, 'documents'],
  ['/reports', ReportsPage, 'reports'],
  ['/settings', SettingsPage, 'settings'],
  ['/associates', AssociatesPage, 'associates'],
  ['/cv-builder', CVBuilderPage, 'cv-builder'],
  ['/job-generator', JobGeneratorPage, 'job-generator'],
  ['/receptionist-view', ReceptionistViewPage, 'receptionist-view'],
  ['/whatsapp', WhatsAppPage, 'whatsapp'],
  ['/recycle-bin', RecycleBinPage, 'recycle-bin'],
]

// A WebMCP failure must never affect the CRM itself: render nothing instead.
class SilentBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.warn('WebMCP bridge disabled:', error?.message || error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function NoAccess() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-light p-6">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-lg font-bold text-primary">You don't have access to this page</h1>
        <p className="mt-2 text-sm text-text-secondary">Ask an administrator to grant it from Settings.</p>
        <a href="/dashboard" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">Back to dashboard</a>
      </div>
    </div>
  )
}

function ProtectedRoute({ page, children }) {
  const { user, userProfile, loading } = useAuth()
  if (loading) return <RouteSkeleton />
  if (!user) return <Navigate to="/login" replace />
  if (!canAccessPage(userProfile, page)) return <NoAccess />
  return children
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <RouteSkeleton />
  if (user) return <Navigate to="/dashboard" replace />
  return children
}

function ScrollManager() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()

  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [navigationType, pathname])

  return null
}

function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <>
      <ScrollManager />
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            {PROTECTED_ROUTES.map(([path, Page, page]) => (
              <Route key={path} path={path} element={<ProtectedRoute page={page}><Page /></ProtectedRoute>} />
            ))}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

export default function App() {
  // CRM-10: never boot a production build without its database.
  if (isMisconfiguredProduction) return <ConfigErrorScreen />

  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <NotificationsProvider>
            <AppRoutes />
            <SilentBoundary>
              <Suspense fallback={null}>
                <WebMCPBridge />
              </Suspense>
            </SilentBoundary>
            {isDemoMode && <DemoModeBanner />}
          </NotificationsProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
