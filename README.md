# Live Interview Helper

A local-first desktop assistant for a candidate in a live job interview. It
listens to both audio streams (their side and your mic), works out which
question the interviewer just asked, and shows your saved answer — 3–5 key
points plus one story — in a panel beside the call. As you talk, points strike
through. Around that: a question bank for prep, an entry editor, a
pre-interview setup screen, and a post-interview recap.

Everything runs on this machine. The bank, matching, transcription, and the
session transcript never touch the network; a dead connection changes nothing.

## Building the app

To get a real double-clickable app rather than a terminal command:

```bash
npm install
npm run package        # builds for the machine you're on
```

The result lands in `release/`: a `.dmg` on macOS, an installer `.exe` on
Windows, an `.AppImage` on Linux. `npm run package:mac|:win|:linux` targets a
specific platform, though each has to be built on that platform (a `.dmg`
can only be produced on a Mac).

**First launch on macOS.** The build is unsigned — I have no Developer ID —
so Gatekeeper will refuse it on a double-click. Right-click the app →
**Open** → **Open**, once; after that it launches normally. (If you'd rather
sign it, set `mac.identity` in `electron-builder.yml` and flip
`hardenedRuntime` back on; `build/entitlements.mac.plist` is already written
for the microphone and the WASM models.)

The app stores everything under `~/Library/Application Support/Live Interview
Helper/` on macOS (`%APPDATA%` on Windows, `~/.config` on Linux): the bank,
your sessions, settings, and the downloaded models. Deleting that folder
resets the app and nothing else.

## Running from source

```bash
npm install

npm run dev:mock   # Electron, scripted mock session — no mic, no meeting
npm run dev        # Electron, real audio capture path
npm run dev:web    # browser-only demo of the same app (localhost:5199)

npm test           # vitest: matcher, coverage, engine, recap, strip, find
npm run typecheck  # both tsconfigs
npm run build      # electron-vite production build

npm run fetch-models   # one-time model download for the real capture path
npm run verify:pixels  # screenshot-diff every screen against docs/reference
npm run e2e            # drive the full scripted session in a headless browser
npm run e2e:electron   # multi-window check: the strip window over IPC
npm run smoke:package  # launch-test the packaged build in release/
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
`setup-noperm`, `setup-devices`, `armed`, `recap`, `recap-off`. No value lists an index page;
any unknown name shows the list.

## macOS permissions

Two separate grants, both under **System Settings → Privacy & Security**:

- **Microphone** — your own mic, for ticking off points as you say them.
  macOS prompts on first use; the setup screen's "Test" requests it if it
  hasn't been granted.
- **Screen Recording** — required for screen capture (which carries the
  meeting audio on Windows). macOS never prompts for this one: add the app
  manually, then relaunch it.

The setup screen's two status dots have three states, because the failures
need three different reactions: **green** means granted and hearing sound,
**amber** means connected but silent, and **red** means there is no audio
track at all. A source that cannot work never looks like one that is merely
quiet. The dots are driven by a smoothed level through a hysteretic gate with
a hold, so they don't flicker on the gaps between your words, and "Start
listening" is never disabled by a live signal — a click landing in a pause
used to hit an undefined handler and be silently dropped.

**Meeting audio by platform.** Electron's loopback audio capture is
Windows-only. On macOS the meeting has to reach the app as an ordinary *input
device*: install a virtual cable (BlackHole is the usual choice), route the
meeting's output through it — typically as part of a Multi-Output Device so
you can still hear the call — and then pick it in the **meeting row's device
picker** on the setup screen. If the app can already see something that looks
like a virtual cable, the row names it.

Both rows are pickers: the microphone one exists because a default input that
silently switches to a narrowband Bluetooth headset is otherwise invisible.
The device name comes off the live track, so what you read is what is
actually open.

## Checking it works before the interview

Two things to do on the setup screen, in this order:

1. **Hit "Test".** It records five seconds through the real capture path,
   transcribes it with the real model, and prints back what it heard on the
   mic row. Compare that against what you said — that is the whole check, and
   it exercises the exact path that runs during the call.
2. **Press ⌘⇧D** for the diagnostics panel: input level in dB, the estimated
   room-noise floor and the level your speech has to clear, how many segments
   have been transcribed, which models are installed and the last few lines
   heard — with one plain-language verdict on top naming the most likely
   problem. If the mic is 8dB under the threshold, this is where it says so.

## Where things live

- **Tuning constants** — `src/shared/tuning.ts`. Every matching, coverage,
  audio and voice-activity threshold in one exported object with a tuning
  comment per value: the confidence bar, runner-up margin, trigger boost,
  auto-pick delay and coverage thresholds; and on the audio side the resampler
  kernel, the high-pass corner, the VAD's open/close margins over the noise
  floor, pre-roll and hangover, segment caps, and the loudness targets applied
  before Whisper. Change the number, not the call sites;
  `tests/matcher.test.ts`, `tests/coverage.test.ts`, `tests/vad.test.ts`,
  `tests/resample.test.ts` and `tests/level.test.ts` pin the behaviour.
- **Audio DSP** — `src/renderer/src/lib/dsp/`: `resample.ts` (windowed-sinc
  polyphase resampler + biquad high-pass), `vad.ts` (adaptive noise floor and
  the segmenter), `level.ts` (meter ballistics and the liveness gate). All
  pure and browser-free, so the behaviour that actually went wrong is testable
  without audio hardware.
- **Data** — three JSON files in Electron's `userData` directory (`bank.json`,
  `sessions.json`, `settings.json`), zod-validated on read, written atomically
  (temp file + rename), with a `.bak` of the last good read per file. Deleting
  `bank.json` loses the bank and nothing else. First run seeds from
  `src/shared/seed.json`. The browser build keeps the same repository contract
  on localStorage.
- **Architecture** — the UI never touches audio directly. Four interfaces in
  `src/shared/types.ts` (`AudioSource`, `Transcriber`, `Matcher`,
  `CoverageModel`) with two capture implementations: the real path
  (`src/renderer/src/lib/drivers/real.ts` — getUserMedia mic, meeting audio
  from either a loopback input device or getDisplayMedia, Whisper + MiniLM in
  Web Workers) and the mock
  driver (`drivers/mock.ts`) replaying `fixtures/demo-session.json`. Speaker
  attribution is stream identity: system audio is `them`, mic is `you` — one
  transcriber per stream, no diarisation. `lib/engine.ts` wires segments →
  matcher → panel state and mic segments → coverage; screens are
  presentational (`screens/`, contracts in `screens/contracts.ts`);
  containers bind stores to screens (`containers/`).
- **Design reference** — `docs/handoff/` (spec + original mock),
  `docs/reference/` (per-screen fragments), `docs/CONVENTIONS.md` (build
  rules), `DECISIONS.md` (every call the spec didn't make).
- **Verification** — `tools/verify/` holds the pixel-diff harness
  (`verify:pixels`, gating six screens at ≤0.1% against the reference) and
  the scripted end-to-end drive (`e2e`); `.github/workflows/ci.yml` runs
  typecheck → unit tests → both on every push.
- **Stories library** — the bank sidebar's "Stories library" opens a pane
  for the shared stories themselves (title, body, metric chips); saving one
  updates every answer that references it.

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

Transcription uses Whisper and matching uses MiniLM
(`Xenova/all-MiniLM-L6-v2`) via `@xenova/transformers`, loaded from the app's
`userData/models` directory only (`env.allowRemoteModels = false`). Get them
once before interview day — the only moment this app ever touches the network
— either from the **setup screen** ("Download now" on the models notice,
which shows per-file progress) or with `npm run fetch-models` from a
checkout. Both write into `userData/models`, and the app then serves them to
its workers over an internal `lih-models://` protocol.

There are two Whisper tiers, picked on the setup screen and persisted:

| tier | size | when |
| --- | --- | --- |
| `Xenova/whisper-base.en` (default) | ~145MB | noticeably more accurate, still real-time on a modern machine |
| `Xenova/whisper-tiny.en` | ~40MB | lower latency on an older machine, misses more words |

Only the selected tier is downloaded. `npm run fetch-models` follows the same
rule; pass `--model <id>` for a specific tier or `--all` for both. If the
selected model can't be loaded, the transcriber falls back to `tiny.en` and
says so rather than going silent.

Until the models are present (or while they're still warming up), matching
and coverage run on the lexical fallback paths — bigram Dice plus your
trigger phrases — so the panel works from the first second either way. The
setup screen tells you which mode you're in.
