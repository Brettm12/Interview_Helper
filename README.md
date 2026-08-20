# Live Interview Helper

A local-first desktop assistant for a candidate in a live job interview. It
listens to both audio streams (their side and your mic), works out which
question the interviewer just asked, and shows your saved answer — 3–5 key
points plus one story — in a panel beside the call. As you talk, points strike
through. Around that: a question bank for prep, an entry editor, a
pre-interview setup screen, and a post-interview recap.

Everything runs on this machine. The bank, matching, transcription, and the
session transcript never touch the network; a dead connection changes nothing.

## Running it

```bash
npm install

npm run dev:mock   # Electron, scripted mock session — no mic, no meeting
npm run dev        # Electron, real audio capture path
npm run dev:web    # browser-only demo of the same app (localhost:5199)

npm test           # vitest: matcher thresholds, coverage model, engine, recap
npm run typecheck  # both tsconfigs
npm run build      # electron-vite production build
```

`dev:mock` plays a complete session hands-free: arm it from the setup screen
("Start listening" enables once the mock meters report a level) and the
scripted interview runs armed → confident match → points striking through →
an ambiguous question with the 4s auto-pick → a ⌘K override → collapse to the
share-safe strip and back → session end → recap with flagged fixes. The same
script drives `dev:web`, so every screen is demoable with nothing installed
but a browser. `VITE_MOCK_SPEED=2` (any factor) compresses the playback.

### Screen gallery

Every screen/state renders statically at its reference frame for design
review: append `?screen=<name>` in `dev:web` — `live`, `unsure`, `find`,
`strip`, `strip-queued`, `strip-new`, `bank`, `editor`, `setup`,
`setup-noperm`, `armed`, `recap`, `recap-off`. No value lists an index page;
any unknown name shows the list.

## macOS permissions

Two separate grants, both under **System Settings → Privacy & Security**:

- **Microphone** — your own mic, for ticking off points as you say them.
  macOS prompts on first use; the setup screen's "Test" re-requests it.
- **Screen Recording** — required for system-audio loopback (the meeting's
  audio). macOS never prompts for this one: add the app manually, then
  relaunch it.

The setup screen's two status dots reflect the real permission + signal state:
green means granted *and* hearing sound; amber means missing, and the row's
why-line becomes the fix instruction. "Start listening" stays disabled until
both sources report a level.

## Where things live

- **Tuning constants** — `src/shared/tuning.ts`. Every matching and coverage
  threshold (confidence bar, runner-up margin, trigger boost, fuzz, debounce,
  auto-pick delay, coverage thresholds, long-answer flag) in one exported
  object with a tuning comment per value. Change the number, not call sites;
  `tests/matcher.test.ts` and `tests/coverage.test.ts` pin the behaviour.
- **Data** — three JSON files in Electron's `userData` directory (`bank.json`,
  `sessions.json`, `settings.json`), zod-validated on read, written atomically
  (temp file + rename), with a `.bak` of the last good read per file. Deleting
  `bank.json` loses the bank and nothing else. First run seeds from
  `src/shared/seed.json`. The browser build keeps the same repository contract
  on localStorage.
- **Architecture** — the UI never touches audio directly. Four interfaces in
  `src/shared/types.ts` (`AudioSource`, `Transcriber`, `Matcher`,
  `CoverageModel`) with two capture implementations: the real path
  (`src/renderer/src/lib/drivers/real.ts` — getUserMedia mic +
  getDisplayMedia loopback, Whisper + MiniLM in Web Workers) and the mock
  driver (`drivers/mock.ts`) replaying `fixtures/demo-session.json`. Speaker
  attribution is stream identity: system audio is `them`, mic is `you` — one
  transcriber per stream, no diarisation. `lib/engine.ts` wires segments →
  matcher → panel state and mic segments → coverage; screens are
  presentational (`screens/`, contracts in `screens/contracts.ts`);
  containers bind stores to screens (`containers/`).
- **Design reference** — `docs/handoff/` (spec + original mock),
  `docs/reference/` (per-screen fragments), `docs/CONVENTIONS.md` (build
  rules), `DECISIONS.md` (every call the spec didn't make).

## Desktop behaviour

⌘K (find), ⌘⇧H (collapse to strip), ⌘⇧R (recap) register as global
shortcuts — they work while the meeting window has focus. Helper windows are
always-on-top at floating level, visible across spaces, shown without stealing
focus, and content-protected by default (`setContentProtection`) so they are
excluded from screen capture; the strip's tooltip states the protection state.
The strip is frameless, draggable by its background, and remembers its
position. Panel placement (docked right / floating strip / second screen) is
chosen on the setup screen; second screen errors gracefully with one line if
only one display is connected.

## Offline models (real capture path)

Transcription uses Whisper (`Xenova/whisper-tiny.en`) and matching uses
MiniLM (`Xenova/all-MiniLM-L6-v2`) via `@xenova/transformers`, loaded from a
local model directory only (`env.allowRemoteModels = false`) — fetch the two
model folders once before interview day and the app never needs the network.
Until the models are warm, matching and coverage run on the lexical fallback
paths (bigram Dice + trigger phrases), so the panel works from the first
second.
