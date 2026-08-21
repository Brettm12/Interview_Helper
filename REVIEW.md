# Live Interview Helper — codebase review

Read-only review, 2026-08-21, on `58ac584`. No code was changed; this file is the only addition.

**Method and labels.** Every check the repo defines was executed. Findings marked **[ran]** were confirmed by executing something — a scratch test against the real module, a probe driving the built Electron app under xvfb, a real MiniLM downloaded and run against the seed bank, or a grep of the built artifacts. Findings marked **[read]** come from reading the source; each critical/high [read] finding had the cited code and its callers re-read independently at least twice (review agent + my own pass), but nothing was executed to demonstrate it. Anything neither pass could settle is in **Unsure** at the end, not asserted.

---

## The repo's own checks — all pass [ran]

| Check | Result |
|---|---|
| `npm run typecheck` | pass (both tsconfigs, no output) |
| `npm test` | pass — 17 files, 154/154 tests |
| `npm run build` | pass — electron-vite, 7.7s |
| `npm run e2e` | pass — full scripted session, every stage incl. auto-pick, ⌘K pin, strip, recap, persistence |
| `npm run verify:pixels` | pass — live/unsure/find/strip/bank/armed all ≤0.1% (four at 0.00%); report-only screens at their documented deltas (setup 2.17%, editor 2.38%, strip variants) |
| `npm run e2e:electron` | pass — strip window renders relayed session state over IPC, expand returns the panel |

The important caveat: every one of these runs the **mock driver**. The real capture path — models, workers, VAD, the transcription service, device handling — is exercised by none of them, and that is where most of what follows lives.

---

## Critical

These are the findings that most directly produce your stated nightmare: a dead, frozen, or confidently-wrong panel mid-interview, with no signal.

### C1. ⌘K opens the find overlay, but your keystrokes go to the meeting app — `src/main/index.ts:125`, `src/main/windows.ts:137` [read]

The global ⌘K handler only broadcasts the `find` command; nothing focuses the helper window. Helper windows are deliberately shown with `showInactive()`, and the only `focus()` call in the codebase is in `showMain()` (the ⌘⇧P path). `FindOverlay`'s `<input autoFocus>` sets DOM focus inside the renderer, but OS keyboard focus stays where it was — on the meeting window, which is the whole premise of using global shortcuts. So in the exact panic scenario the feature exists for, the overlay opens and then every character you type — your search query for a prepared answer — is delivered to the meeting app. If the meeting chat has focus, you just typed your crib-sheet query into the interview. The keyboard path (↑↓/↵/esc) never works either; the only way to use find is to first click the panel (which steals focus from the call), and clicking a result hits C5.

**Fix:** on the `find` command, focus the session window for the overlay's lifetime (`getMainWindow()?.show(); .focus()`) and restore the previous app on close — focus steal is unavoidable here because typing requires it; or host find in its own small panel-type window that accepts keys. Verify on macOS specifically (this analysis is from code; see Unsure).

### C2. The offline claim is false: ONNX Runtime's WASM loads from a CDN at runtime, and a truly offline machine can't transcribe at all — `src/renderer/src/workers/transcriber.worker.ts:57`, `embeddings.worker.ts:21` [ran]

Both workers set `env.allowRemoteModels = false` and `env.localModelPath`, but neither touches `env.backends.onnx.wasm.wasmPaths`. In a bundled browser worker, transformers.js's `RUNNING_LOCALLY` check is false, so it defaults `wasmPaths` to `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/`, and onnxruntime-web fetches ~10MB of `ort-wasm-simd.wasm` from jsdelivr the first time a pipeline is built. Verified: the jsdelivr URL is present in the built chunk (`out/renderer/assets/transformers-CXHiBIYM.js`), no `.wasm` file exists anywhere in `out/` or `dist-web/`, and nothing in `src/` or either vite config sets `wasmPaths`. Consequences: online, the app silently talks to a CDN during the interview, contradicting "the only moment this app ever touches the network"; offline (the README's "a dead connection changes nothing"), ONNX can't initialise, the Whisper pipeline load throws, the tiny.en fallback throws the same way, and the session arms with zero transcription — the mock-driven CI can never see this. Chromium's HTTP cache may mask it on a machine that ran the real path online once (jsdelivr serves immutable/1y), which makes it worse: it works in rehearsal and fails in the hotel.

**Fix:** copy `node_modules/@xenova/transformers/dist/ort-wasm*.wasm` into the build output (or serve via `lih-models://`) and set `env.backends.onnx.wasm.wasmPaths` to that local prefix in **both** workers before the first `pipeline()` call.

### C3. A mic test still in flight when you hit "Start listening" disables transcription for the whole session — `src/renderer/src/containers/runtime.ts:390` [read]

`runMicTest`'s `finally` block calls `svc.setEnabled(false)` unconditionally on the shared `TranscriptionService`. `startSession` has no guard against a running test (only the reverse is guarded). The natural sequence — click Test, it seems slow, click Start anyway — plays out as: `startSession` calls `clearSubscribers()` (silently removing the test's listener, so `heard` can never fill), the session arms and enables transcription, the test then waits its full 5s + up-to-20s decode window, reports "Heard nothing", and its `finally` turns transcription off — up to 25 seconds *after* the session armed. Nothing re-enables it. The meters stay alive (levels are computed upstream of the enable gate), the armed card shows "Nothing heard yet" forever, and cause and effect are so far apart the user can't connect them.

**Fix:** in the `finally`, only disable when no session is running (`if (!engine) svc.setEnabled(false)`), and bail out of the wait loop the moment `engine` becomes non-null; or have `startSession` cancel an in-flight test.

### C4. Device unplug, permission revoke, and sleep/wake are never detected — nothing recovers, the panel just goes quiet — `src/renderer/src/lib/drivers/real.ts:39` [read]

`MediaStreamSource.wire()` acquires the stream and builds the graph but registers no `track.onended`/`onmute` handlers and no `AudioContext.onstatechange`; a grep of all of `src/` finds none, and nothing anywhere re-acquires a source mid-session. So: Bluetooth headset dies, USB mic unplugged, AirPods auto-switch to the phone, macOS revokes mic permission, the user clicks the OS "Stop sharing" bar, or the laptop sleeps and the AudioContext stays suspended on wake — in every case the chunks stop, transcription stops, the card freezes on the last match, and there is no error, no red dot, no reconnect. The liveness gate only updates *inside the chunk callback*, so if chunks stop entirely, the last published state can stick at "live" — diagnostics then lies too. `onError` fires only for acquisition failures at start. This is the purest form of "the panel silently stops updating three minutes in".

**Fix:** attach `ended`/`mute` listeners on every audio track and forward to `onError` (or auto-reacquire with the same constraints); listen for AudioContext `statechange` and `resume()` on suspension; add a runtime watchdog — no chunk from a started source for N seconds during a live session → visible warning in the live panel, not just the setup screen.

### C5. Clicking a ⌘K result pins the wrong answer — `src/renderer/src/containers/FindContainer.tsx:76`, `screens/find/FindOverlay.tsx:70` [ran]

The row click handler runs `onMove(i - selectedIndex); onPin()` synchronously in one event. `moveFind` updates the store, but React 18 doesn't re-render until the handler returns, and `pin()` reads `find.selectedIndex` from the *render-time* snapshot — so it pins `results[oldIndex]`: whatever was selected before your click. Reproduced against the real `panelStore` in a scratch test: click row 2 while row 0 is selected → row 0 is pinned. Mid-panic, you search, click the answer you recognise, the overlay closes, and the panel confidently shows a different answer — and because pinning suppresses auto-matching until the next question-like segment, it stays wrong. The e2e misses it because the fixture pins via `engine.pinEntry` directly.

**Fix:** pass identity through the click — `onPinEntry(r.entryId)` on the row, or have `pin()` read `usePanelStore.getState().find.selectedIndex` instead of the render snapshot. Under an hour, testable.

### C6. Floating-strip placement: at the first matched question the main window loses always-on-top, re-centers, and steals focus — `src/main/windows.ts:156` [ran]

`setView` has a branch for `live` + docked and a branch for `armed`, but `live` + `strip` falls through to the ordinary-window branch: `setAlwaysOnTop(false)`, `setVisibleOnAllWorkspaces(false)`, bounds re-centered mid-screen, then `win.show()` — which takes focus (and on macOS can yank you out of the meeting's fullscreen Space) at the exact moment the first question lands. The IPC handler then hides it again behind the strip, so the user sees a flash and loses focus; and for the rest of the session, expanding from the strip shows a panel that is no longer always-on-top — it can sit *behind* the meeting window. Probe-verified against the built app: after the live transition the main window reads `{x:594, y:82, 412×836, alwaysOnTop:false}` where it had been `{x:1174, y:14, 412×400, alwaysOnTop:true}`.

**Fix:** add an explicit `view === 'live' && placement === 'strip'` branch that applies helper behaviour and the live frame without calling `show()`; or make `showStrip(false)` re-run `applyHelperBehaviour` + the live frame before `showInactive()`.

### C7. The +0.35 trigger boost turns interviewer *statements* into confident wrong answers — `src/renderer/src/lib/matcher.ts:49`, `engine.ts:199` [ran]

A fuzzy trigger hit adds a flat 0.35 — 56% of the 0.62 confident bar — so any utterance that contains (or fuzzily resembles, see H13) a trigger phrase needs only ~0.36 cosine of same-domain similarity to swap the panel, and the confident path has **no question-likeness gate** (only the ambiguous branch is gated, per DECISIONS). Run with the real MiniLM through the real `HybridMatcher`: "We're not asking you to bend the rules here, just to be pragmatic" → CONFIDENT `a-bend` at 0.764 (runner-up 0.249). An interviewer reading your CV back or framing a different question swaps the panel to a wrong prepared answer; you glance and answer the wrong prompt, coverage tracks the wrong entry, and a phantom row lands in the recap.

**Fix:** cap the boost so it cannot cross the confident bar without independent evidence (boost only up to the ambiguous band), and/or require `isQuestionLike` for a boost-driven confident swap.

### C8. One embeddings-worker error permanently kills semantic matching — and switching Whisper tier on the setup screen triggers it deterministically — `src/renderer/src/workers/embeddings.worker.ts:37`, `lib/drivers/real.ts:200`, `lib/embeddings.ts:38` [ran]

Three defects compound. (1) The worker's `onmessage` is async, so an `embed` that arrives while `init` is still awaiting the model load runs concurrently, hits `if (!extractor) throw`, and replies `{type:'error'}`. (2) That error carries no request `id`, and `WorkerEmbeddings` handles it with `console.warn` only — the pending promise never settles, and there is no `worker.onerror` at all. (3) `EmbeddingCache.ensure` deletes texts from `pending` only in the success path, so after one failed batch those texts are *never retried* — every future score for them silently falls back to bigram Dice while the UI still reports semantic matching. The deterministic trigger: `ensureModels()` constructs the worker and calls `warmBank()` on the next line; with a loaded bank that posts `embed` during `init` — reproduced by replaying the real worker module. On a fresh launch you're saved only by accident (the first `warmBank` no-ops because the bank hasn't loaded yet — see L13); after changing the Whisper tier on the setup screen, `ensureModels` re-creates the workers with the bank loaded, and every bank question is poisoned for the session.

**Fix:** buffer `embed` messages in the worker until init resolves; echo the request `id` on error replies and reject the pending promise; add `worker.onerror`; clear `pending` in a `.finally` so failed texts retry on the next `ensure`.

---

## High

### H1. Confidence thresholds are mis-calibrated against the real model: honest paraphrases show *nothing* — `src/shared/tuning.ts:6` [ran]

With `embeddingWeight` 0.75, `ambiguous: 0.45` needs ~0.60 raw cosine and `confident: 0.62` needs ~0.83. Real all-MiniLM-L6-v2 cosines for genuine paraphrases of the seed questions sit at 0.39–0.58: "Describe the toughest people issue you've ever had to sort out" scores 0.342 blended (right entry on top) → classified **none**; "What made you apply to us specifically?" → 0.291 despite `a-why` having "why us" triggers → **none**. Near-verbatim asks still work (1.000 confident even with Whisper-style mangling), and off-bank questions correctly stay below the bar (max 0.41 cosine measured — the margins are safe on the false-positive side without triggers). But the single most common live event — the interviewer asking your prepared question in their own words — shows no card, which under stress reads as "the app stopped working", and pushes users toward aggressive trigger phrases, which feeds C7. **Fix:** recalibrate against real embeddings (roughly: ambiguous ~0.30–0.35 blended, confident ~0.48–0.52, letting the runner-up margin do the discrimination — pairwise cosines between *different* bank questions measured max 0.706/median 0.20, so there's room), and add a calibration test that runs the real model over a paraphrase fixture so the numbers can't drift from reality again.

### H2. Whisper load failure or a mid-session worker crash is invisible, and `startSession` happily arms a dead pipeline — `src/renderer/src/lib/drivers/transcription.ts:41`, `runtime.ts:586` [read]

`load-failed` and `worker.onerror` only set `state = 'failed'`; the sole consumers are an empty store patch and the ⌘⇧D diagnostics label. `startSession` checks nothing — with both tiers unloadable (corrupt file, C2's WASM failure) it arms, shows the armed card, and feeds audio to a worker that will never decode. A worker crash mid-interview is the same silent stop with zero recovery. Per-decode errors (`{type:'error'}`) are `console.warn`ed, including the "transcription is falling behind — dropped the oldest segment" message the worker explicitly emits for the user's benefit — it never reaches the UI. **Fix:** gate Start on `modelState() !== 'failed'` with a visible reason; surface decode/drop errors in the live panel; on worker failure during a session, rebuild the `TranscriptionService` (the `models` plumbing already supports recreation) behind a "restarting transcription…" banner.

### H3. The 45s merge swallows a genuine not-in-bank question when any confident match lands within 45s — `src/renderer/src/lib/engine.ts:409` [ran]

`recordQuestion` merges an activation into the last question row whenever that row is unmatched and ≤45s old — with no check that the activation resolves the *same* utterance. DECISIONS scopes this merge to ⌘K pins and warm rescores; the code also merges organic matches for the *next, different* question. Reproduced: unmatched "pay transparency" question at t=10, confident `a-er-case` match at t=40 → one row, with the pay-transparency wording attached to the wrong entry. The recap loses the unmatched question (no "Draft it" card, wrong stats) — unrecoverable silent loss in the one artifact the session produces. **Fix:** merge only for `viaFind` pins and same-window rescores (pass a flag), or require text/window overlap with the unmatched row.

### H4. A deferred (debounced) swap is never invalidated by newer evidence — it fires on top of a newer unsure card and eats that question — `src/renderer/src/lib/engine.ts:269` [ran]

`queueSwap`'s timer only bails on `pinned` or same-entry. Reproduced: confident A → 200ms later confident B (queued, inside the 2.5s debounce) → 200ms later a new question goes ambiguous (3 candidates, countdown running) → the pending swap fires: the unsure card and its auto-pick vanish, the panel flips to stale B, and the newer question never gets a row. Two questions inside 2.5s is exactly what a decode backlog produces. **Fix:** clear `pendingSwapTimer` in the ambiguous, none, and same-entry branches of `applyScores`.

### H5. `VadSegmenter.reset()` doesn't reset `consumed` — after any pause/resume or a second session, timestamps roughly double — `src/renderer/src/lib/dsp/vad.ts:245` [ran]

`reset()` clears every field except `consumed`, while the worker's `clearStream` re-anchors `clockOffset` to the next chunk's session time and computes `t = clockOffset + u.startT` with `startT` still counted from the worker's first-ever sample. Reproduced: push ~30s of audio, `reset()`, push 1s → next utterance `startT = 30.76` instead of ~0.8. Every pause/resume (pause calls flush → clearStream) and every second session in one app run corrupts all downstream time: session clock, `askedAtSec`, window-gap pruning, recap durations and long-answer flags, and cross-boundary mic-time attribution. **Fix:** one line — `this.consumed = 0` in `reset()`.

### H6. Under sustained load the queue sheds the *newest* interviewer segment — the question being asked right now — `src/renderer/src/lib/asrQueue.ts:82` [ran]

On overflow, `push` sorts (stable) and `pop()`s the end: the lowest-priority rank, **most recent** insertion. With the queue full of confirmed-them jobs (decode slower than real time during interviewer monologue), the shed item is the just-arrived segment while up to ~60s of stale audio keeps decoding. Reproduced: push them-1..4 then them-5 → dropped `them-5`. The panel then reacts to questions from a minute ago — confidently stale — and the mic stream starves entirely (also verified). The worker's falling-behind error is console-only (H2). **Fix:** shed the oldest item within the lowest-priority rank instead of the newest, and surface the drop.

### H7. A sustained noise step (fan, AC) opens the VAD and keeps it open for minutes, flooding Whisper with 15s noise segments — `src/renderer/src/lib/dsp/vad.ts:56` [ran]

The floor only rises while the gate is closed, and once open, steady noise ≥ floor+4dB keeps the segment "loud" to the 15s cap, after which it closes for ~60ms (floor rises ~0.36dB) and reopens. The intended 6dB/s absorption collapses to ~0.36dB per 15s cycle. Reproduced with the real segmenter: a −55dBFS noise step after a −70dBFS prime produced 30 cap-length noise segments (450s of noise decode) before the gate re-closed. Those segments carry huge `speechMs`, so the hallucination filter passes whatever Whisper invents, real questions queue behind them (and get shed per H6), and partials stop. The loopback side has no noise suppression at all. **Fix:** let the floor rise slowly while open, or treat a cap-truncated, ~100%-loud, near-constant-level segment as noise and raise the floor toward its median on close.

### H8. Corrupt `bank.json` with a bad/missing `.bak` silently replaces your entire prep with the demo HR bank — and the first save destroys the original — `src/main/persistence.ts:63` [ran]

`loadBank`'s last-resort fallback is the bundled seed. Both failures are swallowed with a main-process `console.warn`; the renderer receives a perfectly valid (wrong) bank. Reproduced with the real persistence module. Worse, the corrupt-but-maybe-hand-recoverable `bank.json` survives only until the first bank mutation — and `selectLoop` alone triggers a full save — after which the user's data is gone for good. There is no in-app restore path, and the JSON "backup" export can't faithfully restore either (M9). **Fix:** never silently seed-fallback for the bank: quarantine the unreadable file (`bank.json.corrupt-<ts>`), surface a visible "your bank could not be read" state, and offer the seed only as an explicit choice.

### H9. Every bank/settings write is memory-first and fire-and-forget — a failing disk (full, EACCES) is invisible and the evening's prep evaporates — `src/renderer/src/state/bankStore.ts:186` [read]

All mutations `set()` the store, then save with no `.catch` and no UI error state anywhere in the renderer (`void store.saveEdit()` etc.). Edits look saved on screen; on relaunch they're gone. The same pattern covers settings. Main does validate before writing, so the *disk* stays consistent — the failure is pure silent loss. **Fix:** catch at the store level, flag `saveFailed`, and show a persistent "changes are NOT being saved: <error>" banner.

### H10. The 200-entry transcript ring empties saved excerpts for the first half of a real-length interview — `src/renderer/src/state/sessionStore.ts:110`, `engine.ts:536` [ran]

`buildRecord` derives each question's persisted transcript from the capped live buffer. Reproduced: 480 confirmed lines over a simulated hour → earliest surviving entry at minute 35; the minute-5 question's excerpt is empty. A 60–90 minute interview easily exceeds 200 segments, so the recap's opening questions — usually the ones you most want to review — expand to nothing, and "Draft an answer from what I said" is blank, with the transcript toggle on and no indication anything was dropped. **Fix:** accumulate confirmed lines into each `SessionQuestion` at question boundaries, or lift the cap for confirmed entries while `keepTranscript` is on (the UI only ever renders the last line anyway).

### H11. "Model installed" means "`config.json` exists" — and config.json downloads first, the 30–110MB weights last — `src/main/models.ts:36` [read]

Quit or crash during the minutes-long download and the manifest's small JSON files are present while the `.onnx` weights are missing; `modelsStatus` then reports installed, the setup notice is suppressed, nothing re-offers the download, and the session arms into a load failure whose only witnesses are H2's invisible states. The per-file `.part`+rename discipline is correct — the *multi-file sequence* is what isn't transactional. **Fix:** presence = every file in the manifest entry exists (download the big files first if you want a cheap completion marker), and let a `failed`/`loading` transcriber block or warn on arm.

### H12. No integrity verification of model downloads — a captive portal's HTML page gets installed as a model file, permanently — `src/main/models.ts:67`, `scripts/fetch-models.mjs:55`, `src/shared/models.json` [read]

The manifest carries file names only — no hashes, no sizes — and both downloaders validate only `res.ok`. Hotel wifi answering 200 with a login page installs that HTML atomically as `config.json` or an `.onnx`; every later presence check passes forever, and the load failure it eventually causes is invisible (H2). **Fix:** add per-file sha256 + size to `models.json`, hash the stream before renaming `.part` into place, and have the status check validate sizes so corruption re-triggers "Download now".

### H13. The fuzzy trigger window (0.82) fires on wrong short phrases — one edit on a two-word phrase, and sorted-token matching ignores word order — `src/renderer/src/lib/text.ts:114` [ran]

Reproduced: "why us" fires inside "and why is" and (via the sorted-token pass) inside "tell us why you left"; "why this role" fires on "why this rule matters"; "difficult ER case" on "difficult HR case"; "five years" on "five tears". Each false fire injects C7's flat 0.35. Short trigger phrases — which users naturally write; three of the seed's own are ≤3 words — become wildcards. **Fix:** scale the threshold with phrase length (exact containment for very short phrases), require one exact content-word match in the window, drop the sorted-token pass for 2-word phrases.

### H14. The strip restores at its saved position with no visible-area check — after a monitor change it opens fully off-screen while the main window hides — `src/main/windows.ts:182` [ran]

`showStrip` applies persisted `stripPosition` verbatim. Probe-verified: with `{x:4000,y:4000}` saved and a 1600×1000 display, the strip window is created exactly there — invisible — and `showStrip` has just hidden the main window. Prep at a desk with an external monitor, interview on the laptop: the first collapse makes every surface disappear mid-call. ⌘⇧P recovers, but nobody knows that in the moment. **Fix:** `screen.getDisplayMatching` on the saved rect; if it doesn't intersect a current display's work area, fall back to the default top-right.

### H15. Global shortcut registration failures are silent — the entire shortcut surface can be dead with no detection — `src/main/index.ts:125` [ran]

All six `globalShortcut.register()` return values are ignored. Probe-verified with two app instances: instance B runs normally with every shortcut dead (`{k:false,h:false,r:false,q:false,p:false}`) and nothing logged or shown. Any other app holding one of these chords produces the same silently. A dead ⌘K is the panic path failing; a dead ⌘⇧H means no collapse when you start screen-sharing. In Electron builds the renderer keydown fallbacks never install (`window.api` exists), so there is no second path. **Fix:** check the results, surface failures on the setup screen ("⌘K is held by another app"), and add a focused-window fallback via `before-input-event`.

### H16. ⌘W closes the session window mid-interview; the app then runs invisibly and every recovery affordance silently no-ops — `src/main/appMenu.ts:74`, `windows.ts:99` [ran]

The Window menu ships `role: 'close'`; one habitual ⌘W while the panel has focus destroys the session renderer (engine, stores, everything since the last 20s snapshot). Because a hidden strip window usually still exists, `window-all-closed` never fires — and `showMain()` starts with `if (!win) return`, so the tray, dock click, `activate`, and ⌘⇧P all do nothing. Probe-verified: after `main.close()` with a hidden strip, the app stays alive with zero visible windows and `activate` changes nothing. The user's natural next move — relaunch — creates a second instance with dead shortcuts (M18). **Fix:** `showMain()` should recreate the window when null; intercept `close` on the session window during a live session (hide instead), or drop `role:'close'`.

### H17. Global ⌘⇧R collides with the browsers' hard-reload chord and ends the session instantly, no confirmation — `src/main/index.ts:127` [read]

⌘⇧R/Ctrl+Shift+R is hard-reload in Chrome, Edge, and Firefox. While the helper runs, a reflexive hard reload of a flaky CoderPad or Meet tab is swallowed by the helper and — during a session — runs `endSession()` immediately: engine gone, recap window popping over the meeting, no resume. **Fix:** two-step confirm (press again within 2s / toast with Undo), and register it only while a session exists.

---

## Medium

### M1. `lih-models://` containment check misses the trailing separator — sibling-directory escape — `src/main/index.ts:159` [ran]
`file.startsWith(dir)` with no trailing `path.sep` treats any `userData/models*` sibling as inside the root. Verified in real Electron: `lih-models://models/..%2FmodelsX/secret.txt` → 200. Full escapes out of `userData` are correctly 403'd, and no sensitive `models*` sibling exists today, so this is a broken boundary rather than a live leak. Fix: compare against `dir + path.sep` or use `path.relative`.

### M2. The warm-embedding rescore overrides the user's explicit unsure-card choice — `src/renderer/src/lib/engine.ts:171` [ran]
`pickCandidate` sets state `confident` (not `pinned`), and `rescoreIfUnchanged` has no "user resolved this" guard: reproduced — user taps a candidate, vectors land a beat later, panel flips to a different entry and a duplicate row is recorded. Same hole for `dismissUnsure`. Fix: bump a resolution generation on manual commands and have the rescore bail.

### M3. A click racing the 4s auto-pick records a duplicate question — `src/renderer/src/lib/engine.ts:490` [ran]
`pickCandidate` doesn't check the state is still `ambiguous`; the countdown UI actively invites clicks at the deadline. Reproduced: auto-pick fires, in-flight click activates a second entry → two rows at the same `askedAtSec`, both entries eat a repeat penalty. Fix: no-op unless still ambiguous.

### M4. Auto-pick and the deferred swap keep firing while paused — `src/renderer/src/lib/engine.ts:468` [ran]
Pause never reaches the engine's timers. Reproduced: pause during unsure → 4s later a confident activation and a question row recorded while "not listening". Fix: clear both timers on pause or gate the callbacks on status.

### M5. A failed final save strands the app on the live view with the mic still hot — `src/renderer/src/lib/engine.ts:563`, `runtime.ts:601` [read]
`end()` awaits `sessions.save` *before* flipping to recap, `endSession` has no try/catch, and all callers are `void`. On a disk error at session end: no recap, no cleanup — `setEnabled(false)`, strip teardown, and `showStrip(false)` never run, so capture and transcription continue after the user ended the interview. (`lastSession` is set pre-save, so a second ⌘⇧R does reach the recap — but nothing says so.) Fix: flip the view and run cleanup in a `finally`; surface the save error on the recap.

### M6. Pause drops the flushed mid-sentence tail its own comment promises to keep — `src/renderer/src/containers/runtime.ts:639` [ran]
Status flips to `paused` *before* `setEnabled(false)` flushes; the flushed segments then arrive to an engine that drops everything while paused. Reproduced at store level. The last sentence before every pause vanishes from transcript and coverage. Fix: flush first and accept segments stamped before the pause.

### M7. Import preview accepts JSON the saver rejects — the in-memory bank is poisoned and every save fails silently until restart — `src/renderer/src/lib/bankIO.ts:138`, `bankStore.ts:231` [ran]
`parseJson` passes through non-array `triggerPhrases` and non-string point text; the preview shows no problem; `addAnswers` commits to the store *before* the save, main's `BankSchema.parse` throws, and the rejection is `void`ed. From then on the app is a no-op persister — everything looks saved and is gone on relaunch. Fix: sanitise in `parseJson`, or validate the merged bank before `set()`.

### M8. `parseBankText` throws on malformed JSON shapes, crashing the bank window to the error boundary and losing the paste — `src/renderer/src/lib/bankIO.ts:137` [ran]
`points` as a string or `stories` as an object escapes as a TypeError inside a render-time `useMemo`. Reproduced. Fix: try/catch → `problem: 'That JSON does not look like a bank export.'`.

### M9. The JSON "lossless backup" cannot be faithfully re-imported — `src/renderer/src/lib/bankIO.ts:135` [ran]
The only import path flattens every answer to `{question, points, triggers, storyTitle}`: sections, loop assignments, ids, `lastUsed`, and story bodies are all dropped, and comma-containing trigger phrases split in two (reproduced round-tripping the seed). After H8 wipes a bank, the export the app calls a backup restores a flattened shadow of it. Fix: detect a full bank export and restore via `BankSchema.parse` instead of flattening.

### M10. One corrupt record invalidates all of `sessions.json`, and the next save persists the wipe — `src/shared/schema.ts:88`, `persistence.ts:74` [ran]
`SessionsFileSchema` is a plain array — one bad field rejects the file (reproduced); `listSessions` falls back to `[]`; the next 20s snapshot rewrites the file containing only the new record. All prior recaps/transcripts gone silently. Fix: validate per-record, keep the good ones, quarantine the bad file.

### M11. `writeAtomic` never fsyncs, and `.bak` refreshes only on read — a power cut can revert the whole evening — `src/main/persistence.ts:57` [read]
temp+rename protects against app crashes but not power loss (rename metadata can commit before data pages; APFS makes no ordering promise), and the fallback `.bak` is a copy from the last successful *read* — i.e. app launch — so the recovery point excludes everything written since. Fix: `fh.sync()` before rename; refresh `.bak` on successful save too.

### M12. `isQuestionLike` misses common phrasings and false-fires mid-statement — `src/renderer/src/lib/engine.ts:16` [ran]
Ran against realistic phrasings: misses "I'd love to hear about…", "Talk about…", "Can/Could you…", "Give us a sense of…", "Suppose…" (8/8), and fires on statements containing "why"/"what is" mid-clause (3/3). With the terminal "?" absent from ASR, a mid-band real question gets neither a card nor a recap row. Fix: extend the lead-ins, anchor the single-word cues to clause starts.

### M13. Lexical (cold) coverage strikes points that were never made — `src/renderer/src/lib/coverage.ts:33` [ran]
`tokenRecall ≥ 0.38` after stopword-stripping means a 3-content-word point covers on any sentence containing those words, regardless of meaning or negation (reproduced: recall 1.0 on a non-delivery). Struck-through means "you already said this" — a false strike makes you skip content you never delivered, and it never un-covers. Fix: require ≥3 matched content words or skip the lexical path for short points.

### M14. Embedding coverage misses figurative points — `src/shared/tuning.ts:50` [ran]
Real-model check: a fair spoken delivery of "Separate the people, not the payroll…" scored 0.475 vs the 0.55 bar (noun-preserving deliveries hit 0.61–0.73; on-topic non-point speech peaked at 0.48, so headroom for lowering the bar is thin). Aphoristic points — several in the seed — under-strike, prompting mid-interview repetition. Fix: max(embedding, lexical) as the matcher already does, and nudge literal point wording at authoring time.

### M15. Multi-word Whisper repetition loops pass the hallucination filter — `src/renderer/src/lib/asrText.ts:59` [ran]
"Thank you. Thank you. Thank you." alternates words, so the ≥5-identical-words rule never trips, and `FILLERS` is exact-whole-string (reproduced: kept at 400ms voiced). These pollute the 12s matching window and the recap during interviewer silence. Fix: detect repeating n-grams (n≤4), apply the filler check per repeated sentence.

### M16. The documented tiny.en fallback doesn't exist in a default install — `src/main/models.ts:31`, `transcriber.worker.ts:68` [read]
Only the *selected* tier is ever downloaded, so when base.en fails to load, the fallback load of tiny.en fails identically — after an error message that said a fallback was happening. The README's safety net ("falls back to tiny.en and says so rather than going silent") is dead for the default user. Fix: always fetch tiny.en (~40MB) or drop the claim and surface "model broken — re-download".

### M17. In-app download: per-file progress only, no bytes, no cancel, no in-file resume — `src/main/models.ts:61` [read]
The 110MB decoder shows one frozen counter line for minutes — indistinguishable from a hang — with no cancel and a full restart of that file on any interruption. Exactly the pre-interview moment where users kill the app (feeding H11). Fix: stream with byte counts against Content-Length, AbortController + Cancel, Range resume on the `.part`.

### M18. No single-instance lock — `src/main/index.ts:137` [ran]
Probe-verified: a second launch runs fully, shares the three JSON files last-writer-wins, and registers zero shortcuts (H15) — the instance the user is looking at after a relaunch (H16's natural sequel) has a dead shortcut surface. Fix: `app.requestSingleInstanceLock()`; on `second-instance`, `showMain()`.

### M19. Shortcuts are held app-lifetime, not per-session — ⌘K is stolen system-wide whenever the helper is open — `src/main/index.ts:180` [read]
While the app is merely open (left running after prep), ⌘K stops working in Slack, VS Code (every ⌘K-chord), Notion, Linear, and browsers; background ⌘K presses also toggle the invisible overlay so the next in-interview press *closes* it. Fix: register ⌘K/⌘⇧H/⌘⇧R/⌘⇧D at arm, unregister at session end; keep ⌘⇧P/⌘⇧Q app-lifetime.

### M20. ⌘K on the setup/recap views sets latent `find.open`; the overlay then pops uninvited the moment the session arms — `src/renderer/src/App.tsx:152` [read]
The command is guarded only for the bank view; setup/recap mount no `FindContainer`, so an odd number of presses there leaves `find.open=true` invisible until the armed view mounts it. Fix: guard on views that render the overlay, or clear `find.open` on view change/arm.

### M21. Content protection is a silent no-op on Linux (and the strip tooltip still claims it) — `src/main/windows.ts:65` [read]
`setContentProtection` is honoured on macOS and Windows (Win10 2004+); on Linux/X11 it does nothing, while the strip's tooltip reports the protection state from the settings flag, not the platform's actual capability. A Linux user screen-sharing trusts a promise the OS can't keep. Fix: report per-platform capability honestly in the tooltip/setup, or hide the claim on Linux.

---

## Low

- **L1** `models:status` interpolates the renderer-supplied model id into a filesystem path — a file-existence oracle, no write primitive (`src/main/models.ts:36`) [ran]. Validate against the manifest ids.
- **L2** No `setWindowOpenHandler` on the strip/second-screen windows and no `setPermissionRequestHandler` anywhere — `window.open` from those windows creates a live child; geolocation/notifications default-grant (verified in an Electron replica). No injection vector exists to reach it (see Sound), hence low (`src/main/windows.ts:178,229`) [ran]. Add the handlers app-wide; deny non-media permissions.
- **L3** `sandbox: false` on every window — deliberate (ESM preload), and contextIsolation holds, but a renderer compromise isn't OS-contained (`src/main/windows.ts:57`) [read].
- **L4** The mic test enables *both* streams; meeting audio (rank 0) can starve the test's decode past its 20s deadline → false "Heard nothing" minutes before the call (`src/renderer/src/containers/runtime.ts:363`) [read]. Per-stream enable.
- **L5** The status dot's liveness threshold (−34dBFS) is 26dB stricter than the VAD's open gate (−60dBFS): a quiet-but-transcribable mic shows amber "silent" while transcription works, and `diagnose`'s too-quiet branch can never fire for it (`src/shared/tuning.ts:171`) [read]. Drive the dot from the same floor/openAt machinery.
- **L6** Level publishes re-render the whole setup screen ~20×/s while models load, and `DiagnosticsContainer` stays subscribed at that rate all session while closed (`SetupContainer.tsx:27`) [read]. Scalar selectors / gate on `open`.
- **L7** The root ErrorBoundary's full-panel fallback is unusable in the 39px strip window (clipped, buttons unreachable, "No answer was active" misleading) (`ErrorBoundary.tsx:39`) [ran]. Strip-sized fallback that calls `strip.expand()`.
- **L8** "EARLIER" rows keyed by `question-time` can collide (merge path can stamp duplicate times) (`MatchedBody.tsx:85`) [read]. Key on `entryId-askedAt`.
- **L9** A crashed session's `incomplete` record resurfaces as `lastSession` on every boot forever, shadowing newer recaps for idle ⌘⇧R (`App.tsx:137`) [read]. Clear the flag once surfaced, or prefer the newest record overall.
- **L10** Two writers race on `settings.json` (renderer full-object saves vs main's strip-drag/hide writes) — a dragged strip position can silently revert (`settingsStore.ts:39`, `windows.ts:199`) [read]. Patch-semantics via main.
- **L11** `saveSession` read-modify-write is unserialised: an in-flight 20s snapshot can overwrite the final save, leaving the finished session stored `incomplete` minus its tail (`persistence.ts:74`) [read]. Promise-queue per file.
- **L12** Arming a loop with zero answers transcribes but records nothing — unmatched questions are skipped before the recording branch, recap says "0 questions heard" (`engine.ts:99`) [ran]. Record unmatched even with an empty slice.
- **L13** `warmBank` no-ops on first mount (child effect runs before the bank loads), so the "bank already embedded from the setup screen" comment is false and the session-start cold window partially returns; `onThem`'s warm list also omits trigger phrases, unlike `onPartial`'s (`runtime.ts:240`, `engine.ts:104`) [read]. Warm from the bank-load path.
- **L14** Mock/dry-run control handlers accumulate across sessions — a second dry run applies every scripted pin/end twice (`runtime.ts:570`) [read]. Wire once per driver.
- **L15** The main-process downloader uses undici fetch, which ignores system/HTTPS_PROXY — clean, visible failure on proxied networks (`models.ts:66`) [read]. Use `net.fetch`.
- **L16** ⌘⇧H is dead during the armed phase; with strip placement the pre-first-question window can only be expanded by clicking the strip — which fails entirely if H14 put it off-screen (`App.tsx:158`) [read]. Allow `'armed'`.
- **L17** No `render-process-gone`/`unresponsive` handlers: a crashed strip renderer keeps displaying its last painted frame — stale but alive-looking (`windows.ts`) [read]. Reload the window on the event.
- **L18** No schema version field and zod strips unknown keys: the first schema evolution (or a downgrade) silently drops data with nothing to catch it (`schema.ts:51`) [ran]. Version field + passthrough.
- **L19** Repeat activations of the same entry inherit its earlier coverage — the new recap row starts with the previous asking's covered points (`engine.ts:430`) [read]. Snapshot coverage per question row.
- **L20** Browser shim writes are unguarded against localStorage quota (demo/e2e only) (`api.ts:44`) [read].
- **L21** `@xenova/transformers` sits in both `optionalDependencies` and `devDependencies` at the same version (`package.json:38,46`) [read]. The files allowlist means it never ships either way, so this is not the 200MB-package bug DECISIONS describes — but the optional entry contradicts DECISIONS ("a devDependency, not a runtime one"), silently tolerates its own install failure while the build hard-requires it, and drags ~200MB into `--omit=dev` installs for nothing. Verdict: leftover, delete the `optionalDependencies` entry.
- **L22** `endedAt = startedAt + clockSec*1000` uses the audio clock, so the recap's "N MINUTES" under-reports wall time across pauses (`engine.ts:545`) [read].

---

## Cross-platform verdicts

The code is macOS-first and honest about it; here is the concrete state per OS.

| | macOS | Windows | Linux |
|---|---|---|---|
| Meeting audio | **Degraded by design**: needs BlackHole/virtual cable as an input device; well-guided (picker, cable suggestion, honest no-track error). Unproven against a real meeting (DECISIONS admits this). | **Works natively** — the only platform where Electron's `audio:'loopback'` path functions. Ironically the least-tested platform for it (no Windows CI, no Windows run recorded). | **Broken for direct capture**, and the guidance is wrong: the no-track error and diagnostics name BlackHole (a macOS product). The real fix — selecting a PulseAudio/PipeWire "Monitor of …" source as the meeting input — actually works through the existing device picker, but `looksLikeLoopback` doesn't match "Monitor of", so the app never suggests it [read]. |
| Mic capture | Works; permission prompt + honest dots. | Works when Windows mic privacy allows Electron apps; `permissions.ts` reports `granted` unconditionally, so if Windows blocks it the dot's *permission* signal lies — but the failed `getUserMedia` still surfaces as a red no-track with an error, so it degrades to a misleadingly generic message rather than silence [read]. | Same as Windows. |
| Global shortcuts | Work (with H15/H17/M19 caveats). ⌘⇧Q shadows the system log-out chord when registration succeeds [read, unverified on real macOS]. | `CommandOrControl` maps to Ctrl — works; Ctrl+Shift+R hard-reload collision (H17) applies. | Works under X11; Wayland global shortcuts are unreliable in Electron — untested here, flag as unsure. |
| Content protection | Works (`NSWindowSharingNone`). | Works on Win10 2004+ (`WDA_EXCLUDEFROMCAPTURE`). | **Silent no-op**; the tooltip still claims protection (M21). |
| Quit/menus | Full app menu, tray, ⌘⇧Q. | Frameless windows show no menu bar; quit is reachable via tray + Ctrl+Shift+Q. Accelerator delivery without a visible menu bar is Electron-standard but untested here. | Tray creation failure is handled (`installTray` try/catch); menu/quit same caveat as Windows. |
| Packaging | dmg+zip, unsigned (see below). | NSIS x64. Untested in CI. | AppImage; the only OS that CI packages and smoke-tests. |

---

## Packaging and CI

**Sound:** the `files` allowlist ships everything the app needs (proven by `smoke-package.mjs` asserting seed, fonts, preload/IPC against the real asar); `npmRebuild:false` is correct (nothing native ships); the entitlements plist contains exactly what signing needs (mic + JIT + unsigned-memory + library-validation off) and is already wired; `fetch-models.mjs` resolves the same `userData` path Electron does on all three OSes; the icon/tray generation is self-contained.

**Gaps, in order of cost:**

1. **The WASM hole (C2) is also a packaging gap** — the package contains no `ort-wasm*.wasm` and the fix lands here: emit them into `out/` (they load via fetch, so either serve over `lih-models://` or confirm asar-internal fetch works and asarUnpack if not).
2. **CI never runs the real model path.** Every green check is mock-driven; C2, H11, H12, and the calibration drift (H1) are all invisible to it. A cheap fix exists: a CI job that runs `fetch-models` for MiniLM only (~23MB) and executes a real-embedding calibration/matching test in Node (this review did exactly that in scratch form).
3. **No macOS or Windows runners.** The primary target OS is never built or smoke-tested in CI; Linux — the least supported platform — is the only one exercised.
4. **The unsigned-build instruction is stale for macOS 15 (Sequoia)**: right-click → Open no longer offers the bypass; the path is System Settings → Privacy & Security → "Open Anyway" after the first blocked attempt. README should say so [read, from platform knowledge — verify on a current machine].
5. **No lint config at all** (no eslint/biome anywhere) — typecheck is the only static gate.
6. Minor: `smoke:package` runs with `MOCK_SESSION=1` (inherent — no audio in CI, but worth a comment); playwright `^1.62` in devDeps vs CI's `npx playwright install chromium` can drift browser/runner versions; failure artifacts only capture pixel shots, not e2e traces.
7. **L21** (the dual transformers dependency) — delete the `optionalDependencies` entry.

---

## Test coverage gaps

Every gap below is a place where this review found (or could have found) a real bug that no existing test constrains — not a generic plea for coverage. The scratch tests written during this review are the cheapest templates: the exact sequences are in the finding descriptions.

1. **`transcriber.worker.ts` orchestration** — the clock re-anchoring across flush/reset is where H5 lived (silent recap corruption); the queue/partial/flush interplay is pure enough to test by replaying the worker module (the review did). One test: push → flush → push, assert timestamps re-anchor.
2. **`TranscriptionService` enable/disable ownership** — C3 is a state machine bug in ~120 lines with no test. Simulate: test starts → session starts → test finishes → assert still enabled.
3. **`FindContainer`/`FindOverlay` interaction** — C5. `engine.pinEntry` is tested; the container binding — where the bug is — isn't. A component-level test with the real `panelStore` reproduces it in five lines (the review's scratch test did).
4. **`windows.ts` setView/placement matrix** — C6 and H14. A pure refactor (compute-frame function returning `{bounds, helper, show}` per `(view, placement)`) would make the matrix unit-testable; today it needs the xvfb probe this review used.
5. **Persistence corruption recovery** — H8/M10/M11. The review ran the real `persistence.ts` against an electron stub; that harness (corrupt file → assert quarantine-not-seed) belongs in `tests/`.
6. **Embeddings error paths** — C8. Replay `embeddings.worker.ts` with `embed` racing `init`; assert buffering; assert `EmbeddingCache.ensure` retries after a rejected batch.
7. **A real-model calibration test** — H1/C7/H13. `tests/` pins thresholds symbolically, so the numbers can be wrong *consistently*. An opt-in (env-gated, model pre-fetched) vitest that runs MiniLM over a paraphrase + trigger-abuse fixture and asserts classification would have caught all three.
8. **`runtime.ts`** — the second-biggest file has zero direct tests: the mic-test race (C3), pause ordering (M6), control-handler accumulation (L14), and clock park/zero logic all live there and are mockable at the `models`/store seams.
9. **Engine sequences beyond the happy path** — `engine.test.ts` is good but misses exactly the races found: 45s merge with an unrelated match (H3), deferred swap over new ambiguity (H4), pick-vs-autopick (M3), rescore-vs-user-pick (M2), events while paused (M4). Each is a ~15-line addition in the existing harness.

---

## Spec drift

Where implementation and documents diverge, with a verdict each.

| Divergence | Verdict |
|---|---|
| `spec-setup-addition.md`: "Start listening stays disabled until both sources report a level". Code deliberately loosened to "permissions granted + not no-track" (a never-live source can arm). README/DECISIONS document the rationale (click-in-a-pause bug). | **Doc stale** — but note what the loosening papers over: you can arm with a meeting source that has never produced sound and discover it mid-interview. The dots remain the only guard. |
| `spec-setup-addition.md`: dots are green/amber. Code + README: three states with red no-track. | **Doc stale** — the code's version is better. |
| README: "If the selected model can't be loaded, the transcriber falls back to tiny.en **and says so**". The say-so is a console.warn (H2), and the fallback model isn't installed by default (M16). | **Code wrong** on both halves. |
| README: "the only moment this app ever touches the network" / "a dead connection changes nothing". | **Code wrong** (C2). |
| DECISIONS: "The models load on the setup screen… the bank already embedded". Whisper/MiniLM do load; the bank warm no-ops on first mount (L13). | **Code wrong** (comment overstates). |
| DECISIONS: 45s merge is for "⌘K pin within 45s" + warm rescore. Code merges any activation (H3). | **Code wrong.** |
| `handoff-spec.md`: "↵ pins the entry". Keyboard pinning can't work without focus (C1); mouse pinning pins the wrong row (C5). | **Code wrong** — the spec's core interaction is unimplementable as shipped. |
| `spec-recap.md`: fully implemented — stat cards + warning-at-zero rule, row expansion incl. transcript-off suffix, all four fix kinds with the 2:30 threshold (150s), ⌘E/⌘⌫ wired, export filename matches DECISIONS, "Practice the N I missed" filter works. Two deviations: leftover card slots fill with extra unmatched-question drafts (reasonable extension), and `missedLabels` exists in the schema but is never populated — the sub-line derives from point text instead. | **Doc-compatible**; `missedLabels` is dead schema — remove or use. |
| DECISIONS spot-checks: strip 366×39 ✓, 100ms leading+trailing throttle ✓, strip:get priming ✓, seed 15 answers/3 stories/3 loops (+4 sections) ✓, deliberate harassment-twin ambiguity ✓ (real cosine 0.698, the bank's max), pixel-gate scope ✓. | **Accurate.** |
| README macOS first-launch: right-click → Open. | **Doc stale on macOS 15+** (see Packaging #4) [unverified on hardware]. |
| DECISIONS "Known limitations" — admits the real path never ran against hardware. | **Accurate, and load-bearing**: most criticals above live precisely in that admitted gap. |

---

# Part 2 — UI and feature proposals

Constraints respected: nothing below breaks the 0.1% pixel gate unless flagged, and everything is local. Ranked by value per unit of effort. (The original #1 candidate — fixing the ⌘K click — turned out to be a bug, and is C5 above.)

**P1. Keyboard picks in the unsure state: 1/2/3 selects a candidate, Esc = "None of these".**
*Moment:* the 4-second countdown, eyes on the interviewer, no mouse. Today the only inputs are mouse clicks or letting the auto-pick fire. *Effort:* a few hours (guard against the find overlay and focused inputs). *Risk:* accidental digit press — mitigate by binding only while the unsure body is visible. *Gate:* none if hint-less; visible "1 2 3" badges would break the gated unsure screen — ship hint-less, document in the setup footer. Note: inherits C1 — worth shipping together with the focus fix.

**P2. Honest paused state in the live panel header: gray dot + "Paused — mic is off".**
*Moment:* pause is reachable from menu/tray mid-session and stops the tracks, but the panel keeps a green "Listening" dot — the one dishonest dot left in an app whose DECISIONS call dot honesty "the worst bug in the list". *Effort:* a few hours. *Risk:* one more header state to keep consistent with the strip. *Gate:* none — the gated live frame renders the listening state.

**P3. Context-aware ⌘K empty state: seed the pre-typing list with current unsure candidates, then not-yet-asked entries.**
*Moment:* find opened from "Search bank" when the matcher was close-but-wrong; today the empty query shows bank order, so the entry you want is rarely visible and you must type under stress. *Effort:* a few hours, pure function + tests. *Risk:* non-obvious ordering; keep it deterministic, empty-query only. *Gate:* none — the gated find screenshot pins a non-empty query.

**P4. "Visible in share" marker on the strip when content protection is off.**
*Moment:* screen-sharing with `contentProtection` off (a persisted setting): the only signal is a hover tooltip nobody hovers mid-share, and on Linux the tooltip lies outright (M21). *Effort:* a few hours. *Risk:* extra chrome on a minimal surface; must not read as the amber new-question state. *Gate:* none — all three gallery strip variants pin `protectionOn`.

**P5. Auto-pick delay setting: 4s / 8s / never.**
*Moment:* the unsure card asks you to read 2–3 candidates and decide in 4 seconds; for a slower reader or anyone watching the interviewer, the leader commits before they finish reading — a wrong answer they now have to notice. *Effort:* a few hours (setting + engine reads it). *Risk:* "never" can leave the panel ambiguous through an answer — acceptable, matching keeps re-resolving; default stays 4s. *Gate:* none while the default is 4s.

**P6. Editor keyboard completeness: ⌘Enter save, Esc cancel (dirty-guarded), Enter commits point + new row, ⌥↑/↓ reorder.**
*Moment:* entering 15–23 answers the night before is currently a hands-off-keyboard dance per point. *Effort:* a few hours. *Risk:* Esc-discard needs a guard; ⌥-arrows vs caret movement. *Gate:* none — editor is report-only.

**P7. High-legibility toggle: `--text-dim` #6f6b64 → the #8d8880 class, covered-point opacity .4 → .55; default off.**
*Moment:* half-second glances. Computed WCAG: #6f6b64 on #16181b is 3.36:1 — fails AA — and it colours "TAP THE ONE THEY MEANT" (the panic instruction) and "Collapse"; covered points at .4 opacity fall below readable at 15.5px. *Effort:* half a day (three custom properties behind a body class + a settings row on the non-gated setup screen). *Risk:* two visual modes drift; scope to exactly three declarations. *Gate:* untouched while default-off (the gallery renders defaults); fixing the tokens outright would fail unsure+live and force a re-baseline.

**P8. Real keyboard/focus pass: `onClick` divs → reset-styled `<button>`s, `:focus-visible` rings, `prefers-reduced-motion`.**
*Moment:* keyboard-only or switch users cannot operate the app at all — "Start listening", placement cards, candidate cards, point rows, bank rows are all divs. *Effort:* 1–2 days including re-running `verify:pixels` on every gated screen. *Risk:* UA button styles leaking 1px metrics into gated layouts — mitigated by an `all:unset` reset; the harness verifies. *Gate:* touches the DOM of all six gated screens but not their at-rest rendering; needs a verification run, no re-baseline expected.

**P9. Live pacing cue: past ~2:30 mic time on one entry, the covered label gains "· 2:40 on this one".**
*Moment:* rambling on question two with three points left — the recap already flags "ran long" but only after it can't help. The engine already accrues the number. *Effort:* about a day (live micSeconds + label plumbing). *Risk:* mid-answer anxiety — text-only, label-gray, no motion; consider gating behind a setting. *Gate:* none — renders only past the threshold, which the static gallery never reaches.

**P10. Per-entry practice mode: "Practice" arms the mic against that answer, strikes points as you say them, ends in a one-entry mini-recap.**
*Moment:* the night-before rehearsal. Today "Practice" and "Dry run" both replay the scripted HR fixture — you can watch a demo but not rehearse your own answer, and every piece of machinery (pinEntry, mic coverage, mic-test capture path) already exists. *Effort:* 2–3 days. *Risk:* needs models + mic (reuse the mic test's honest failure copy); firewall its session bookkeeping from real sessions. *Gate:* none — reuses live-panel visuals; no gated frame renders it.

**Looked at, nothing worth proposing:** recap flows (real buttons, working shortcuts, spec-faithful); colour-as-sole-signal (every dot change is paired with a text change; deuteranopia-simulated distances acceptable); motion (only ~200ms eases, per spec — the reduced-motion query folds into P8); the setup arming sequence (three-state dots, real transcribing mic test, per-file download progress are already right); import/export preview flow; the bank's three-pane navigation; diagnostics panel layout; screen-reader live-narration of swaps (deliberately not proposed — spoken output or focus movement during a live call is worse than the gap; the wins here are keyboard + contrast, P7/P8).

---

## What's genuinely sound

Things checked deliberately and found solid — you don't need to worry about these.

**Security and process boundary.** contextIsolation/nodeIntegration/webSecurity are Electron defaults everywhere (never overridden); the preload surface is a fixed, typed API with no generic invoke passthrough and nothing that reaches fs/child_process; `bank:save` and `settings:save` re-validate with zod *in main*; `export:save-notes` always goes through the native save dialog; the models downloader builds URLs/paths from the bundled manifest, not renderer input; the `lih-models` scheme has only fetch+bypassCSP privileges and serves read-only; full `../` escapes out of userData are 403'd (M1's sibling-prefix gap aside); malformed percent-encodings are contained by Electron, not crashes; there are zero HTML-injection sinks (no dangerouslySetInnerHTML/innerHTML/eval anywhere — imported bank content only ever renders as React text), which is what keeps the missing permission/window-open handlers at low. The page CSP is strict and doesn't break the app (WASM runs in workers; verified in a real Electron replica).

**DSP.** The resampler is genuinely correct: block-boundary processing is bit-identical to one-shot (verified at 48k and the non-integer 44.1k ratio), passband gain error 0.02%, stopband leakage −114dB, zero cumulative drift over 60s. The biquad high-pass matches the analytic Butterworth response. The capture worklet's accumulate/transfer loop loses no samples and never touches a detached buffer; transfer ownership along worklet→main→worker is single-owner at every hop, and the meter reads before the transfer. `normalizeForAsr` and the blip filter behave exactly as the tests pin.

**VAD segment assembly** (the noise ratchet and `consumed` aside): once open it keeps every sample, pre-roll is contiguous with onset, tail-trim keeps exactly the pad, cap-truncated closes reopen within ~60ms with boundary frames preserved — no audio is lost at segment boundaries. Memory is bounded everywhere traced: queue ≤4 jobs, segments ≤15s, pre-roll ring capped, partials cost a constant 8s window regardless of monologue length, transcript ring 200.

**Queue policy** (the within-rank tie-break aside): confirmed-them always first, partials refused rather than queued under load, confirmed supersedes same-stream partials, `pump` can't double-run. The pressure-valve *design* — partials die first, confirmed speech only at the hard cap — is right.

**Engine lifecycle.** `end()` teardown is complete (stopped flag first; auto-pick, snapshot, pending-swap all cleared; post-end segments provably mutate nothing); a fresh engine per session plus `arm()`'s full store rewrite means a second session starts clean (H5 is the worker's fault, not the engine's); the session clock is monotonic through device switches and pauses; pin semantics hold everywhere they should (blocks partials, rescores, deferred swaps; unpins on the next question-like segment); partial-to-confirmed patching touches exactly one row exactly once; coverage is monotonic with manual toggle as the only un-cover; degenerate banks (empty, one entry, twins, long/non-ASCII text) crash nothing — cold degradation is toward silence, not wrong answers, C7's trigger route excepted.

**Persistence mechanics** (within the findings' limits): temp files are same-directory (rename never crosses filesystems) and pid+timestamp-unique; a corrupt file can never destroy a good `.bak` (parse-before-copy — verified); single-file corruption recovery from `.bak` works automatically (verified); saves validate before writing so the disk always holds a schema-valid file; the seed itself validates; snapshot/final-save id discipline means no duplicate records per run; snapshots respect the transcript toggle exactly like the final save, and their errors can't stall the engine; crash recovery is wired end-to-end (20s snapshot → boot scan → "RECOVERED ·" recap) and quitting mid-interview loses ≤20s.

**Rendering.** Selector granularity on the live path is genuinely good (all direct field selectors; audio-level publishes never reach the live panel — verified subscriber-by-subscriber); store writes per segment are exactly two notifications; all interactive lists key on stable ids; the crossfade handles interleaved swaps; hook order is safe in every container; the ErrorBoundary wraps every window, uses no hooks, reads stores imperatively, and actually renders points from a populated store (verified by rendering it).

**Multi-window plumbing** (its findings aside): the strip prime-vs-push race is handled (`cur ?? s`); the publisher's leading+trailing throttle and material-change dedupe are pinned by tests; a user-closed strip restores the main window; `setContentProtection` genuinely reaches every window including late-created ones, initialised from settings before any window exists; second-screen-with-one-display degrades exactly as documented without committing the placement; `bank:did-change` excludes the saver, fires post-save, and reload preserves selection and open drafts; the main window recomputes bounds per view change so only the strip can restore off-screen; a failed strip load leaves the panel visible (hide happens after load resolves).

**Offline, except C2:** model *weights* can never fetch remotely (`allowRemoteModels=false` before any pipeline in both workers); an exhaustive grep finds exactly two intended network call sites and nothing else — no telemetry, no beacons; fonts are fully bundled (woffs verified in the build, no external URL in the built CSS); per-file downloads are atomic and resumable; `fetch-models.mjs` writes exactly where Electron will look on all three OSes; the mock/browser builds construct no pipelines at all.

**Recap/derivation:** `deriveRecap`/`exportNotes` tolerate dangling entryIds (a post-crash bank edit can't break the recap screen); fix-card generation matches the spec's four kinds and thresholds; ⌘E/⌘⌫/practice-filter are wired.

**The verification tooling itself** is unusually good: the pixel harness is deterministic (bundled fonts aliased into the reference, 0.00% on four screens), the e2e drives the entire session shape, `e2e:electron` genuinely tests the strip IPC seam against empty stores, and `smoke-package` asserts the packaging regressions that actually happened (asar contents, preload, fonts, quit paths, the zombie-window recovery, and that plain ⌘Q is *not* globally registered).

---

## Unsure

Flagged rather than asserted; each would take hardware or a platform this container lacks.

1. **C1 on real macOS** — the mechanism (showInactive + no focus call) is certain from code, but macOS focus/Space behaviour when the overlay opens, and whether `win.show()` in C6 switches Spaces away from a fullscreen meeting, were not observed on hardware.
2. **Whether a Whisper decode can hang indefinitely** (WASM/ORT deadlock): there's no watchdog around `await transcribe(...)`, so one hung decode would freeze both streams permanently with `runningRank` stuck — the absence of a watchdog is fact; whether hangs occur in practice is unknown.
3. **Real decode throughput** of base.en WASM on target laptops — H6/H7's severity scales with how often decode runs slower than real time; mechanisms proven, frequency unmeasured.
4. **AudioContext behaviour across sleep/wake and default-device switches** on macOS Electron 33 — C4 rests on the verified absence of any handler, not on observed sleep behaviour.
5. **Background throttling of the hidden main window** while collapsed to the strip: low-nesting timers should only see the 1s clamp, but the 4s auto-pick and trailing strip send under long-hidden "intensive" throttling weren't exercised.
6. **Whether Electron applies the page CSP inside file://-loaded workers in the packaged app** — bears on whether C2's CDN fetch would be blocked (making offline-mode failure *louder*) or allowed (silent CDN dependency). DECISIONS' account of a working packaged run implies allowed.
7. **How long Chromium's HTTP cache masks C2** on a machine that ran the real path online once.
8. **Whisper's punctuation reliability** — how often the terminal "?" is dropped decides how much M12's detector gaps bite.
9. **AEC on the mic path**: whether Chromium's echo cancellation reliably prevents meeting audio played through speakers from being transcribed as *you*, across output devices — platform-dependent, unobserved.
10. **Wayland**: global shortcuts and frameless-window drag behaviour on Wayland Electron are known-flaky upstream; untested here.
11. **macOS 15 Gatekeeper wording** (Packaging #4) — from platform knowledge, not verified on a current machine.
12. **Menu accelerator delivery on frameless Windows/Linux windows** (no visible menu bar) — standard Electron behaviour says it works; untested here.
