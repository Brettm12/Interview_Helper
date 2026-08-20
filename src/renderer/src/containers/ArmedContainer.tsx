import ArmedCard from '../screens/setup/ArmedCard'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { useSessionStore } from '../state/sessionStore'
import { pauseSession } from './runtime'

// Armed / waiting: the 412×400 card shown between "Start listening" and the
// first recognized question.

export default function ArmedContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  const status = useSessionStore((s) => s.status)
  const transcript = useSessionStore((s) => s.transcript)
  if (!bank) return null

  const loop = bank.loops.find((l) => l.id === bank.activeLoopId) ?? bank.loops[0]
  const count = answersForLoop(bank, bank.activeLoopId).length

  const statusLeft =
    status === 'paused' ? 'Paused' : transcript.length > 0 ? 'Listening…' : 'Nothing heard yet'

  return (
    <ArmedCard
      headline={`${count} answers loaded. I'll pull one up the moment they ask.`}
      openers={loop.likelyOpeners.slice(0, 2)}
      statusLeft={statusLeft}
      onPause={pauseSession}
    />
  )
}
