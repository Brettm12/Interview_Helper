import { Suspense, lazy, useEffect } from 'react'
import { api } from './lib/api'
import { useAudioStore } from './state/audioStore'
import { useBankStore } from './state/bankStore'
import { usePanelStore } from './state/panelStore'
import { useSessionStore } from './state/sessionStore'
import { useSettingsStore } from './state/settingsStore'
import { formatClock } from './lib/recap'
import { recapCommand, setCollapsed } from './containers/runtime'
import LiveContainer from './containers/LiveContainer'
import FindContainer from './containers/FindContainer'
import StripContainer from './containers/StripContainer'
import SetupContainer from './containers/SetupContainer'
import ArmedContainer from './containers/ArmedContainer'
import BankContainer from './containers/BankContainer'
import RecapContainer from './containers/RecapContainer'
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
  }, [])

  // global shortcuts (Electron globalShortcut → 'command'; browser keydown shim)
  useEffect(() => {
    if (SCREEN) return
    return api.onCommand((cmd) => {
      const panel = usePanelStore.getState()
      switch (cmd) {
        case 'find':
          if (panel.view === 'bank') return // bank has its own search field
          if (panel.find.open) panel.closeFind()
          else panel.openFind()
          break
        case 'toggle-collapse':
          if (panel.view === 'live') setCollapsed(!panel.collapsed)
          break
        case 'recap':
          recapCommand()
          break
        case 'strip-expand':
          setCollapsed(false)
          break
      }
    })
  }, [])

  if (SCREEN) {
    return (
      <Suspense fallback={null}>
        <Gallery screen={SCREEN} />
      </Suspense>
    )
  }

  if (WINDOW === 'strip') {
    return <StripContainer overlay />
  }
  if (WINDOW === 'bank') {
    return <BankContainer />
  }

  return (
    <div className={IN_ELECTRON ? 'app-root' : 'app-root app-root--web app-shell'}>
      <MainWindow />
    </div>
  )
}
