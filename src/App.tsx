import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { Login } from '@/pages/Login'
import { Onboarding } from '@/pages/Onboarding'
import { JoinOrg } from '@/pages/JoinOrg'
import { Dashboard } from '@/pages/Dashboard'
import { Boards } from '@/pages/Boards'
import { KanbanBoard } from '@/pages/KanbanBoard'
import { LeadDetail } from '@/pages/LeadDetail'
import { MapPage } from '@/pages/MapPage'
import { Calendar } from '@/pages/Calendar'
import { Finances } from '@/pages/Finances'
import { Budgets } from '@/pages/Budgets'
import { Invoices } from '@/pages/Invoices'
import { Conversations } from '@/pages/Conversations'
import { Professionals } from '@/pages/Professionals'
import { Team } from '@/pages/Team'
import { Notifications } from '@/pages/Notifications'
import { Settings } from '@/pages/Settings'
import { PublicLeadView } from '@/pages/PublicLeadView'
import { ProPanel } from '@/pages/ProPanel'
import { AcceptInvite } from '@/pages/AcceptInvite'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { SADashboard } from '@/pages/superadmin/SADashboard'
import { SAOrganizations } from '@/pages/superadmin/SAOrganizations'
import { SATrash } from '@/pages/superadmin/SATrash'
import { SABilling } from '@/pages/superadmin/SABilling'
import { SACommunications } from '@/pages/superadmin/SACommunications'
import { SAPlans } from '@/pages/superadmin/SAPlans'

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-sm px-4">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-red-500 text-xl font-bold">!</span>
        </div>
        <p className="text-sm font-medium text-gray-900 mb-1">Error de conexión</p>
        <p className="text-sm text-gray-500">{message}</p>
        <button
          className="mt-4 px-4 py-2 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700"
          onClick={() => window.location.reload()}
        >
          Reintentar
        </button>
      </div>
    </div>
  )
}

/** Rutas de la app principal (sesión requerida).
 *  - super_admin: pasa siempre, sin necesitar org
 *  - normal: necesita org, si no va a /onboarding */
function AppRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, authError, organization, systemRole } = useAuth()
  if (authError) return <ErrorScreen message={authError} />
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  // super_admin accede a la app sin org
  if (systemRole === 'super_admin') return <>{children}</>
  if (!organization) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

/** /superadmin: SOLO para super_admin */
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, authError, systemRole } = useAuth()
  if (authError) return <ErrorScreen message={authError} />
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (systemRole !== 'super_admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

/** /onboarding: requiere sesión pero NO org.
 *  - super_admin nunca pasa por aquí → va a /superadmin */
function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, authError, organization, systemRole } = useAuth()
  if (authError) return <ErrorScreen message={authError} />
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (systemRole === 'super_admin') return <Navigate to="/superadmin" replace />
  if (organization) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

/** Rutas públicas: redirige al destino correcto si ya tiene sesión */
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, authError, organization, systemRole } = useAuth()
  if (authError) return <ErrorScreen message={authError} />
  if (loading) return <Spinner />
  // super_admin siempre va a /superadmin
  if (session && systemRole === 'super_admin') return <Navigate to="/superadmin" replace />
  if (session && organization) return <Navigate to="/dashboard" replace />
  if (session && !organization) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

/** Redirige al destino correcto según el estado del usuario */
function DefaultRedirect() {
  const { session, loading, organization, systemRole } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (systemRole === 'super_admin') return <Navigate to="/superadmin" replace />
  if (!organization) return <Navigate to="/onboarding" replace />
  return <Navigate to="/dashboard" replace />
}

function AppRoutes() {
  return (
    <Routes>
      {/* Públicas — sin autenticación requerida */}
      <Route path="/login"          element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/join/:orgId"    element={<JoinOrg />} />
      <Route path="/p/:token"       element={<PublicLeadView />} />
      <Route path="/pro/:token"     element={<ProPanel />} />
      <Route path="/invite/:token"  element={<AcceptInvite />} />

      {/* Onboarding (sesión sin org) */}
      <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />

      {/* App protegida (sesión + org) */}
      <Route element={<AppRoute><AppLayout /></AppRoute>}>
        <Route path="/dashboard"     element={<Dashboard />} />
        <Route path="/boards"        element={<Boards />} />
        <Route path="/boards/:id"    element={<KanbanBoard />} />
        <Route path="/leads/:id"     element={<LeadDetail />} />
        <Route path="/map"           element={<MapPage />} />
        <Route path="/calendar"      element={<Calendar />} />
        <Route path="/finances"      element={<Finances />} />
        <Route path="/budgets"       element={<Budgets />} />
        <Route path="/invoices"      element={<Invoices />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/professionals" element={<Professionals />} />
        <Route path="/team"          element={<Team />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings"      element={<Settings />} />
      </Route>

      {/* Super Admin — layout propio (AdminLayout) con su guard */}
      <Route
        path="/superadmin"
        element={
          <SuperAdminRoute>
            <AdminLayout />
          </SuperAdminRoute>
        }
      >
        <Route index                element={<SADashboard />} />
        <Route path="organizations" element={<SAOrganizations />} />
        <Route path="trash"         element={<SATrash />} />
        <Route path="billing"       element={<SABilling />} />
        <Route path="communications" element={<SACommunications />} />
        <Route path="plans"         element={<SAPlans />} />
      </Route>

      <Route path="/" element={<DefaultRedirect />} />
      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  )
}
