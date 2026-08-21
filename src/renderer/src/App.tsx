import { Suspense, lazy, useEffect } from 'react'
import { api } from './lib/api'
import { useAudioStore } from './state/audioStore'
import { useBankStore } from './state/bankStore'
import { usePanelStore } from './state/panelStore'
import { useSessionStore } from './state/sessionStore'
import { startSettingsSync, useSettingsStore } from './state/settingsStore'
import { formatClock } from './lib/recap'
import { pauseSession, recapCommand, setCollapsed, startBankSync } from './containers/runtime'
import LiveContainer from './containers/LiveContainer'
import FindContainer from './containers/FindContainer'
import StripContainer from './containers/StripContainer'
import SetupContainer from './containers/SetupContainer'
import ArmedContainer from './containers/ArmedContainer'
import BankContainer from './containers/BankContainer'
import RecapContainer from './containers/RecapContainer'
import DiagnosticsContainer from './containers/DiagnosticsContainer'
import MockCallFrame from './screens/live/MockCallFrame'
import './app.css'

// Window router. Electron loads each window with ?window=main|strip|bank and
// sizes the frame itself; the browser (dev:web) renders reference-sized frames
// centered on the app background. ?screen=… serves the static state gallery
// used for design verification.

const Gallery = lazy(() => import('./demo/Gallery'))

const params = new URLSearchParams(window.location.search)
const WINDOW = params.get('window') ?? 'main'
const SCREEN = params.get('screen')
const IN_ELECTRON = typeof window.api !== 'undefined'

/** web-only wrapper: the reference frame for a view, centered by .app-shell */
function Frame({
  width,
  height,
  children
}: {
  width: number
  height: number
  children: React.ReactNode
}): JSX.Element {
  if (IN_ELECTRON) return <>{children}</>
  return (
    <div className="app-frame" style={{ width, height }}>
      {children}
    </div>
  )
}

function LiveView(): JSX.Element {
  const collapsed = usePanelStore((s) => s.collapsed)
  const clockSec = useSessionStore((s) => s.clockSec)
  const bank = useBankStore((s) => s.bank)
  const loop = bank?.loops.find((l) => l.id === bank.activeLoopId)

  const panel = (
    <div className="app-panel-host">
      <LiveContainer />
      <FindContainer />
    </div>
  )

  if (IN_ELECTRON) {
    // the strip is its own frameless window; the main window keeps the panel
    return panel
  }

  // browser demo: the reference frame with the placeholder call area; the
  // collapsed state floats the strip over it, share-safe style
  return (
    <Frame width={1428} height={836}>
      <MockCallFrame
        headerLeft={loop ? `${loop.shortName} · live session` : ''}
        timer={formatClock(clockSec)}
        speakerPill="Dana O. · speaking"
      >
        {collapsed ? null : panel}
      </MockCallFrame>
      {collapsed && (
        <div className="app-strip-float">
          <StripContainer overlay />
        </div>
      )}
    </Frame>
  )
}

function MainWindow(): JSX.Element | null {
  const view = usePanelStore((s) => s.view)
  const loaded = useBankStore((s) => s.loaded)

  if (!loaded) return null

  switch (view) {
    case 'setup':
      return (
        <Frame width={880} height={812}>
          <SetupContainer />
        </Frame>
      )
    case 'armed':
      return (
        <Frame width={412} height={400}>
          <div className="app-panel-host">
            <ArmedContainer />
            <FindContainer />
          </div>
        </Frame>
      )
    case 'live':
      return <LiveView />
    case 'bank':
      return (
        <Frame width={1280} height={812}>
          <BankContainer />
        </Frame>
      )
    case 'recap':
      return (
        <Frame width={880} height={812}>
          <RecapContainer />
        </Frame>
      )
  }
}

export default function App(): JSX.Element {
  useEffect(() => {
    void useBankStore.getState().load()
    void useSettingsStore.getState().load()
    void useAudioStore.getState().refreshPermissions()
    // a crashed session left an interim snapshot — make its recap reachable
    // (⌘⇧R / session end overwrite this once a new session runs)
    if (WINDOW === 'main' && !SCREEN) {
      void api.sessions.list().then((all) => {
        const crashed = [...all].sort((a, b) => b.startedAt - a.startedAt).find((s) => s.incomplete)
        if (crashed && !useSessionStore.getState().lastSession) {
          useSessionStore.getState().setLastSession(crashed)
        }
      })
    }
    const stopBankSync = startBankSync()
    // main and second windows also write settings (strip drag) — stay fresh
    const stopSettingsSync = startSettingsSync()
    return () => {
      stopBankSync()
      stopSettingsSync()
    }
  }, [])

  // global shortcuts (Electron globalShortcut → 'command'; browser keydown shim)
  useEffect(() => {
    if (SCREEN) return
    const run = (cmd: Parameters<Parameters<typeof api.onCommand>[0]>[0]): void => {
      const panel = usePanelStore.getState()
      switch (cmd) {
        case 'find':
          // only where the overlay actually mounts — a press on setup/recap
          // used to set latent find.open that popped the overlay at arm
          // (REVIEW.md M20); the bank has its own search field
          if (panel.view !== 'live' && panel.view !== 'armed') return
          if (panel.find.open) panel.closeFind()
          else panel.openFind()
          break
        case 'toggle-collapse':
          // the armed card collapses too — with strip placement the session
          // starts collapsed while still armed (REVIEW.md L16)
          if (panel.view === 'live' || panel.view === 'armed') setCollapsed(!panel.collapsed)
          break
        case 'recap':
          recapCommand()
          break
        case 'strip-expand':
          setCollapsed(false)
          break
        case 'pause':
          pauseSession()
          break
        case 'diagnostics':
          usePanelStore.getState().toggleDiagnostics()
          break
      }
    }
    const offCommand = api.onCommand(run)
    // Focused-window fallback in Electron: when another app holds one of the
    // global chords (registration failed, surfaced on arm), the shortcut must
    // still work while the panel itself has focus (REVIEW.md H15). When the
    // global registration DID succeed, the OS delivers the chord to the
    // globalShortcut hook instead of this window, so nothing double-fires.
    const onKey = (e: KeyboardEvent): void => {
      if (!IN_ELECTRON) return // the browser shim already installs its own
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault()
        run('find')
      } else if (k === 'h' && e.shiftKey) {
        e.preventDefault()
        run('toggle-collapse')
      } else if (k === 'r' && e.shiftKey) {
        e.preventDefault()
        run('recap')
      } else if (k === 'd' && e.shiftKey) {
        e.preventDefault()
        run('diagnostics')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offCommand()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (SCREEN) {
    return (
      <Suspense fallback={null}>
        <Gallery screen={SCREEN} />
      </Suspense>
    )
  }

  if (WINDOW === 'strip') {
    // the session lives in the main window's renderer — this window renders
    // relayed snapshots
    return <StripContainer overlay feed={IN_ELECTRON ? 'ipc' : 'local'} />
  }
  if (WINDOW === 'bank') {
    return <BankContainer />
  }

  return (
    <div className={IN_ELECTRON ? 'app-root' : 'app-root app-root--web app-shell'}>
      <MainWindow />
      <DiagnosticsContainer />
    </div>
  )
}
