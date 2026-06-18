import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { MobileNav } from './MobileNav'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { AnnouncementBanner } from '@/components/common/AnnouncementBanner'
import { useAuth } from '@/context/AuthContext'
import { Eye } from 'lucide-react'

const SIDEBAR_W = 240
const FULL_HEIGHT = /^\/boards\/.+|^\/map$|^\/conversations$/

export function AppLayout() {
  const { pathname } = useLocation()
  const isFullHeight = FULL_HEIGHT.test(pathname)
  const { isGhostMode, ghostOrgName, exitGhostMode } = useAuth()
  const navigate = useNavigate()

  function handleExitGhost() {
    exitGhostMode()
    navigate('/superadmin')
  }

  return (
    <div className="flex flex-col bg-background" style={{ height: '100dvh', overflow: 'hidden' }}>

      {/* Banner de anuncios globales */}
      <AnnouncementBanner />

      {/* Banner modo fantasma */}
      {isGhostMode && (
        <div className="shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm z-50">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            <span>Modo fantasma: viendo <strong>{ghostOrgName}</strong></span>
          </div>
          <button
            onClick={handleExitGhost}
            className="text-amber-900 hover:text-black font-semibold text-xs bg-amber-400 hover:bg-amber-300 px-3 py-1 rounded transition-colors"
          >
            ✕ Salir del modo fantasma
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: solo visible en md+ */}
        <div className="hidden md:block">
          <Sidebar width={SIDEBAR_W} />
        </div>

        {/* Contenido principal */}
        <div
          className="flex flex-col flex-1 overflow-hidden md:ml-[240px]"
          style={{ minWidth: 0 }}
        >
          <Topbar />

          <main
            className="flex-1"
            style={
              isFullHeight
                ? { overflow: 'hidden', height: 0 }
                : {
                    overflowY: 'auto',
                    paddingBottom: 'max(80px, env(safe-area-inset-bottom, 0px) + 80px)',
                    padding: '16px',
                  }
            }
          >
            {!isFullHeight && (
              <style>{`
                @media (min-width: 768px) {
                  main { padding: 24px !important; padding-bottom: 24px !important; }
                }
              `}</style>
            )}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>

          <MobileNav />
        </div>
      </div>
    </div>
  )
}
