# Live Interview Helper

A local-first desktop assistant for a candidate in a live job interview. It
listens to both audio streams (their side and your mic), works out which
question the interviewer just asked, and shows your saved answer — 3–5 key
points plus one story — in a panel beside the call. As you talk, points strike
through. Around that: a question bank for prep, an entry editor, a
pre-interview setup screen, and a post-interview recap.

Everything runs on this machine. The bank, matching, transcription, and the
session transcript never touch the network; a dead connection changes nothing.
(That includes the inference runtime itself: onnxruntime's WASM binaries are
bundled into the build and served internally, not fetched from a CDN.)

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
so Gatekeeper will refuse it on a double-click. On macOS 14 and earlier:
right-click the app → **Open** → **Open**, once. On macOS 15 (Sequoia) the
right-click path is gone: double-click it once to get the refusal, then open
**System Settings → Privacy & Security**, scroll to the message about the
blocked app, and click **Open Anyway**. Either way it's a one-time step;
after that it launches normally. (If you'd rather sign it, set `mac.identity`
in `electron-builder.yml` and flip `hardenedRuntime` back on;
`build/entitlements.mac.plist` is already written for the microphone and the
WASM models.)

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
`setup-noperm`, `setup-devices`, `importer`, `armed`, `recap`, `recap-off`.
No value lists an index page; any unknown name shows the list.

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
Windows-only — there it works out of the box. On macOS the meeting has to
reach the app as an ordinary *input device*: install a virtual cable
(BlackHole is the usual choice), route the meeting's output through it —
typically as part of a Multi-Output Device so you can still hear the call —
and then pick it in the **meeting row's device picker** on the setup screen.
On Linux no install is needed: PulseAudio and PipeWire already expose every
output as a capturable input named **"Monitor of …"** — pick the monitor of
whatever output the meeting plays through. If the app can already see
something that looks like a virtual cable or a monitor source, the row names
it.

Both rows are pickers: the microphone one exists because a default input that
silently switches to a narrowband Bluetooth headset is otherwise invisible.
The device name comes off the live track, so what you read is what is
actually open.

## Rehearsing an answer

**Practice** on any bank entry arms your microphone against that one answer:
points strike through as you actually say them, and it ends in a one-entry
recap showing what you covered and how long you took. Nothing is written —
rehearsals never enter your session history. It needs the same models and
microphone a real session does, and refuses with the same plain explanation
if either is missing.

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

`docs/hardware-checklist.md` is the longer version: the handful of things no
automated suite here can prove — a real microphone, a second monitor, a real
screen share, a screen reader — with what "working" looks like for each. Worth
one pass the evening before, not ten minutes prior.

## Checking the bank itself

**"Check bank"** on the setup screen opens a prep-time rehearsal of the live
decision, in the bank's third pane:

- **Paste a question you expect** and it tells you what the panel would do
  with it — the answer that would come up on its own, the two or three you
  would be asked to choose between, or nothing at all, with one click to start
  writing the answer you turn out not to have. It scores exactly the way the
  interview does, on the same encoder, so it warms the model on entry rather
  than answering from word overlap and calling it a match.
- **The three answers most likely to fight**, each with something to do about
  it: merge them into one, or open the one that loses. Three findings with
  remedies beat twenty without — and the report is capped there deliberately.

It uses the embedding model only, never the speech model, and it steps aside
while a session is running: the interview gets the model.

Answers, stories and the fifteen examples the app ships with can all be
deleted — two presses on the same button, no modal. "Remove the untouched
examples" in the import pane keys on both the example ids and their content,
so anything you have rewritten is yours and stays.

## Turning what you said into points

Draft an answer from the recap and the editor shows **your own lines from the
session** beside the points field. Click one to make it a point; click **"Make
points from this"** to have the app cut the whole thing down for you — it picks
the clauses that carry the most, drops the ones that say nothing, and keeps
them in the order you said them.

It is extractive, not generative: every word it gives back is a word you said.
Three small instruction models were measured against this exact job first
(`node tools/spike/llm-spike.mjs --models-dir <dir>`) and all three invented
details about the speaker's own experience — one of them a scandal that never
happened. A fabricated detail in prep material is the worst kind, because you
rehearse it and then say it in the room. The table is in DECISIONS.md.

Nothing the interviewer said reaches this. The excerpt is filtered to your own
lines where it is built, and both the unit tests and the end-to-end run fail
if an interviewer line — or any word you did not say — turns up in the result.

## Building the bank

The bank is the product: matching can only ever be as good as what it is
matching against. Three ways in:

- **Type it** — "New answer" in the bank screen opens the editor. It is
  keyboard-complete: ↵ commits a point and opens the next row, ⌥↑/⌥↓ move the
  one you are on, ⌘↵ saves, and Esc cancels — asking first if there is unsaved
  work.
- **Paste it** — "Import from a job post" in the bank sidebar opens an
  import/export pane. Paste prep notes in whatever shape you already keep them:
  a question per line (or as a heading) with its points as bullets underneath,
  optionally `> triggers: a, b` and `> story: title`. It shows you what it
  found — how many questions, how many points, which look like duplicates of
  entries you already have — **before** anything is added.
- **Re-import an export** — the same pane exports the bank as markdown (for
  reading and editing anywhere) or as JSON (a lossless backup). Pasting a
  JSON backup back in offers an exact **Restore** — sections, loops, stories,
  ids and usage history all intact — alongside the ordinary merge. Worth
  doing: your prepared material otherwise lives in a single `bank.json`.

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
  (temp file + fsync + rename), with a `.bak` refreshed on every good read
  *and* write. An unreadable `bank.json` is quarantined under a timestamped
  name — never silently replaced — and the app says which bank you're looking
  at. Deleting `bank.json` loses the bank and nothing else. First run seeds
  from `src/shared/seed.json`. The browser build keeps the same repository
  contract on localStorage.
- **Architecture** — the UI never touches audio directly. Four interfaces in
  `src/shared/types.ts` (`AudioSource`, `Transcriber`, `Matcher`,
  `CoverageModel`) with two capture implementations: the real path
  (`src/renderer/src/lib/drivers/real.ts` — getUserMedia mic, meeting audio
  from either a loopback input device or getDisplayMedia;
  `drivers/transcription.ts` — one Whisper worker serving both streams behind
  two Transcriber views, with the interviewer's audio prioritised; MiniLM in
  its own worker) and the mock
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
  (`verify:pixels`, gating six screens at ≤0.1% against the reference), the
  scripted end-to-end drive (`e2e`), the Electron multi-window check
  (`e2e:electron`), the window-lifecycle probe (`probe:windows`: strip
  placement, off-screen clamp, close interception, single instance) and the
  offline-inference probe (`probe:wasm`: real models on the bundled WASM with
  the network dead). `.github/workflows/ci.yml` runs the Linux suite on every
  push, plus a real-model job (calibration against the actual MiniLM) and
  macOS/Windows packaging jobs.
- **Stories library** — the bank sidebar's "Stories library" opens a pane
  for the shared stories themselves (title, body, metric chips); saving one
  updates every answer that references it.

## Desktop behaviour

**Keys during a session.** When the panel is unsure between two or three
answers, **1 / 2 / 3** pick one and **Esc** dismisses — the four-second
countdown is not enough time to find the mouse, and your eyes belong on the
interviewer. How long that countdown runs is a setting: 4s (default), 8s, or
never (it waits for you). Everything clickable is a real button with a visible
focus ring, so the whole app is operable from the keyboard; the setup screen
also has a switch that raises the faintest text and the struck-through points
for half-second glances.

⌘K (find), ⌘⇧H (collapse to strip), ⌘⇧R (recap) register as global
shortcuts — they work while the meeting window has focus, and they are held
only while a session is armed or live, so ⌘K goes back to other apps the
moment the session ends. Helper windows are always-on-top at floating level,
visible across spaces, shown without stealing focus, and content-protected by
default (`setContentProtection`) so they are excluded from screen capture on
macOS and Windows — **Linux cannot do this at all** (the OS offers no way to
exclude a window from capture), and the strip's tooltip says so there instead
of claiming share-safety.
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
which shows per-file and per-byte progress with a Cancel that keeps partial
files for resume) or with `npm run fetch-models` from a checkout. Every file
is verified against a pinned sha256 + size before it counts as installed, and
interrupted downloads resume where they stopped. Both paths write into
`userData/models`, and the app then serves the files to its workers over an
internal `lih-models://` protocol.

There is **one** speech model: `Xenova/whisper-base.en`, 75MB. There used to be
a picker offering `tiny.en` beside it as "lower latency on an older machine,
misses more words" — an invitation to make your own interview worse. The saving
was never what the screen said either: it read "~145MB", which is the size of
the *entire* install (base.en + tiny.en + the matching model), so the real
choice was 34MB against dropped words. A word Whisper drops is a question the
matcher scores wrong, and this round measured a mangled transcript costing more
match score than the difference between three different embedding models. That
is not a trade to put in front of someone six minutes before an interview.

`tiny.en` is still downloaded and still loads automatically if base.en can't be
loaded — the transcriber says so rather than going silent, and that safety net
only works if the fallback is actually on disk. `npm run fetch-models` follows
the same rule; pass `--model <id>` for a specific model or `--all` for
everything. ⌘⇧D always names the model actually running, fallback included.

Until the models are present (or while they're still warming up), matching
and coverage run on the lexical fallback paths — bigram Dice plus your
trigger phrases — so the panel works from the first second either way. The
setup screen tells you which mode you're in.
