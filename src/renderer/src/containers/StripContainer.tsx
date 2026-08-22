import { useEffect, useRef, useState } from 'react'
import type { StripState } from '@shared/ipc'
import Strip from '../screens/strip/Strip'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { useSessionStore } from '../state/sessionStore'
import { useSettingsStore } from '../state/settingsStore'
import { deriveStripState } from '../lib/strip'
import { api } from '../lib/api'
import { setCollapsed } from './runtime'

// Share-safe strip, two feeds:
//  - 'local'  (web/mock): derived from this window's stores — the strip is an
//    inline overlay in the same renderer as the session.
//  - 'ipc'    (Electron strip window): the session lives in the main window's
//    renderer; main relays StripState snapshots published from there.

function StripLocalFeed({ overlay }: { overlay: boolean }): JSX.Element | null {
  const match = useSessionStore((s) => s.match)
  const coverage = useSessionStore((s) => s.coverage)
  const loopId = useSessionStore((s) => s.loopId)
  const bank = useBankStore((s) => s.bank)
  const protectionOn = useSettingsStore((s) => s.contentProtection)

  // the entry that was showing when the strip collapsed (= when this mounted)
  const entryAtCollapse = useRef<string | null>(match.entryId)

  if (!bank) return null
  const state = deriveStripState({
    entries: answersForLoop(bank, loopId ?? bank.activeLoopId),
    match,
    coverage,
    entryAtCollapse: entryAtCollapse.current,
    protectionOn
  })

  return (
    <Strip
      variant={state.variant}
      text={state.text}
      counter={state.counter}
      overlay={overlay}
      protectionOn={state.protectionOn}
      protectionUnsupported={api.env.platform === 'linux'}
      onExpand={() => setCollapsed(false)}
    />
  )
}

const FALLBACK: StripState = {
  variant: 'current',
  text: 'Listening — nothing matched yet',
  counter: null,
  protectionOn: true
}

function StripIpcFeed({ overlay }: { overlay: boolean }): JSX.Element {
  const [state, setState] = useState<StripState | null>(null)

  useEffect(() => {
    let alive = true
    // prime with the last published state, then follow the relay
    void api.strip.getState().then((s) => {
      if (alive && s) setState((cur) => cur ?? s)
    })
    const off = api.strip.onState((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const s = state ?? FALLBACK
  return (
    <Strip
      variant={s.variant}
      text={s.text}
      counter={s.counter}
      overlay={overlay}
      protectionOn={s.protectionOn}
      protectionUnsupported={api.env.platform === 'linux'}
      onExpand={() => void api.strip.expand()}
    />
  )
}

export default function StripContainer({
  overlay = true,
  feed = 'local'
}: {
  overlay?: boolean
  feed?: 'local' | 'ipc'
}): JSX.Element | null {
  return feed === 'ipc' ? <StripIpcFeed overlay={overlay} /> : <StripLocalFeed overlay={overlay} />
}
