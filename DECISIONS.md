# Decisions

Calls made where the spec (handoff README + `docs/reference/*.html` + the build
brief) was silent or contradicted itself. One line of reasoning each. Where the
README prose and the reference HTML differ, the HTML won, per the brief.

## Box model & frames

- **Fixed-width bordered panes are content-box** (bank sidebar 214px, bank list
  396px, live panel 412px, strip 340px): the mock's children use the browser
  default content-box, so the visible width is spec + border; matching it
  border-box would shift every pane by 1px.
- **Strip window is 366×39** (340px content + 24px padding + 2px border): the
  primary 2c frame renders the strip content-box; the 2c variant cards are
  narrower only because the `dv-card` review chrome forces border-box.
- **Strip radius stays 8px** though the 2c variant cards show 10px — 10 is the
  `dv-card` chrome radius; §4 and the token table say 8.
- Screens fill their window (`width/height:100%`); the window (Electron) or the
  demo gallery provides the reference frame, so frames aren't duplicated inside
  components.

## Live panel & unsure state

- Unsure-state transcript line drops the `you:/them:` prefix (per the 1a mock)
  but keeps the 2a footer colors (`#8d8880`, trailing at .45) — the token table
  assigns those to "transcript" globally; 1a's `#7d7871/.4` reads as an earlier
  palette pass.
- Unsure footer renders only when a transcript line exists — the 1a unsure card
  has no label/hide row to render on its own.
- "TAP THE ONE THEY MEANT" uses `#6f6b64` per the 1a HTML, not the default
  label `#8d8880` (HTML wins over prose).
- `UnsureBody` adds the curly quotes around the heard phrase itself; the
  leading "…" arrives in the value.
- Candidate sub-line format is `"4 points · <story title> story"` (1a shows
  "Roadmap freeze story"); entries without a story read "no story yet".
- Question crossfade animates only on swaps, not initial mount — nothing should
  move when the panel first appears.
- The trailing-fade on in-flight transcription is the last 2 words of an
  unconfirmed segment; confirmed segments render solid.
- "EARLIER" lists prior history rows (excluding the active entry), newest
  first, capped at 4 — the mock shows two.
- MockCallFrame's name pill is a prop: the gallery shows the mock's
  "Priya R. · speaking", the live mock session shows the seeded interviewer.

## Find (⌘K)

- Real `<input>` with a real caret replaces the mock's `|` span (same for every
  editor field); input height pinned to 17px so the header matches the mock's
  text-div metrics.
- Selected and last rows carry no bottom divider, matching the reference markup
  (the prose only mentions dividers on unselected rows).
- Search scoring: normalized substring ≥ token hit ≥ word-bigram Dice across
  question, points, and story title; 8 results max. Simple and predictable
  beats clever here — the user is mid-panic.
- ⌘K is a no-op in the bank view (it has its own search field); find overlays
  the live/armed panel only.

## Strip

- Counter = position of the shown point (`3/4` = showing point 3), per the 2c
  cards ("next point queued" shows the last point as `4/4`); the `queued`
  variant drops the ▾ exactly as the reference card does.
- "New question" nudge triggers when a different entry activates (or the
  matcher goes ambiguous) while collapsed; a heard-but-unmatched question
  doesn't nudge — nothing new is ready to show.
- ▾/"open" stopPropagation so a click fires expand once, not twice via the
  also-clickable root.
- With every point covered, the strip keeps showing the last point at N/N.

## Bank & editor

- Detail trigger chips are display-only (mock 3a has no ×); removal lives in
  the editor. "+ add phrase" swaps to a dashed input chip (borrowed from 3b),
  Enter commits, Escape cancels.
- `BankRowView` distinguishes "no story yet" (amber, incomplete entry) from the
  mock's points-only gray meta rows — the mock shows both forms.
- Story card grew a `detail` variant (padding 16/17, body line-height 1.5,
  metrics gap 13) — the 3a card genuinely differs from the 2a card.
- "Swap" cycles through the stories library in order — a picker modal isn't in
  the design, and cycling is one click and reversible.
- "Import from a job post" and "Stories library" are static footer affordances
  — no design exists for either surface; wiring them to nothing beats inventing
  screens.
- Editor question border is `--border-mid` at rest, `--border-strong` on focus
  (the mock inlines the focused state).
- Drag-reorder arms on mousedown on the ⠿ handle only, so text selection
  inside the point input still works.
- "Dry run · 2 min" (setup) starts the scripted mock session — that is what a
  dry run is, and it works with no hardware. "Practice" (bank detail) used to
  do the same, which meant you could watch a demo of someone else's interview
  but never rehearse your own answer; it now arms the real microphone against
  that one entry (see the Part 2 round below).
- Backspace in an empty point input deletes the row.

## Setup

- The added transcript-toggle row has no status dot (the addition spec lists
  only title/why/toggle), so its text starts at the container padding.
- Missing permission turns the dot amber and swaps the why-line for the fix
  instruction ("grant Screen Recording / Microphone access in System Settings →
  Privacy & Security"); granted-but-silent reads "waiting for sound from the
  meeting".
- Level meter animates the mock's 6/13/9/14/5 bar pattern scaled by the live
  RMS level — the design's heights are treated as the at-full-signal shape.
- "Stories attached" counts distinct stories referenced by the loop's answers
  (not the library size) — that is what "attached" means on a per-loop screen.
- Second-screen placement only commits when the second window actually opens;
  on one display the selection stays put and the one-line error renders below
  the cards.
- Third stat card at zero reads "0 / all have stories" in the standard variant
  per the brief's recap-card rule (warning only above zero).
- "Test" on the mic row requests mic permission when missing; with permission
  granted the level meter/dot already are the test.

## Session engine & matching

- Every threshold lives in `src/shared/tuning.ts` with tuning comments;
  matcher/coverage read it, tests pin it.
- While embeddings are cold the matcher score is bigram Dice alone; once warm
  it blends `0.75·cosine + 0.25·Dice` — Dice keeps rare exact wordings alive.
- Trigger phrases hit via a sliding fuzzy window (edit distance ≥ 0.82) that
  also compares sorted-token forms, so "burning their team out" matches the
  trigger "burning out their team"; one boost per entry.
- The unsure state only fires on question-like utterances (terminal "?" or an
  interrogative lead-in) — mid-answer interviewer back-channel shouldn't pop
  candidate cards.
- A heard question that matches nothing is recorded immediately for the recap;
  if the user then pins an entry via ⌘K within 45s, the unmatched row merges
  into that activation instead of double-counting.
- Your own speech is the interviewer window's turn boundary (it empties the
  rolling window).
- Coverage falls back to lexical scoring (Dice + stopword-filtered token
  recall, stricter 0.38 threshold) while embeddings are cold; embedding path
  uses the spec'd 0.55. Never un-covers automatically; clicking a point always
  toggles it.
- Auto-pick keeps its original deadline while the ambiguous state refreshes
  with new candidates — restarting the 4s clock on every segment would let it
  starve.
- ⌘⇧R during a session ends the session (that is "the recap after"); when
  idle it reopens the last recap.
- Pause is a toggle: segments arriving while paused are dropped, matching a
  "stop listening" promise, not buffered.
- `lastUsed` is stamped on every matched entry when the session ends, from the
  session's own coverage numbers.

## Recap

- Sessions auto-save when they end; "Save to loop" confirms and returns to
  setup, "Delete session" (and ⌘⌫) removes the record and its transcript.
- Fix-card actions: "Draft it"/"Add to bank →" open the editor prefilled with
  the question and the `you:` transcript excerpt; "Open answer"/"Add trigger"
  open the bank at the entry; "Edit story" opens the entry in the editor.
- "Ran long" uses the story title when the entry has one ("Checkout redesign
  ran 2:40" names a story in the brief), else the truncated question.
- The transcript block's 11px top gap is padding (not margin) so the expand
  animation's measured height includes it.
- Fix cards add `gap:14px` so a wrapping why-line never touches the chip; title
  line-height 1.3 borrowed from the setup rows' identical 14px titles.
- Rows never expand when the transcript was off, even if excerpt data exists.
- The row list container clips (overflow:hidden) so the amber left border
  follows the 9px radius, per the setup container idiom.
- Export filename is `<loop short name> — session notes.md`.

## Data & persistence

- One JSON file per store (`bank.json`, `sessions.json`, `settings.json`) in
  `userData`, atomic temp-file+rename writes, `.bak` of the last good read,
  zod-validated on load; the browser build shims the same API on localStorage
  so every screen and the whole mock session run without Electron.
- Seed: HR/people-operations bank — 15 answers across Behavioural / Employee
  relations / Compliance / Closing, three shared stories with metrics, two
  entries deliberately story-less, three loops.
- The two entries sharing the "harassment complaint" trigger are deliberate:
  they make the fixture's investigation question genuinely ambiguous.

## Mock driver & fixture

- Fixture timing is compressed (~105s wall) relative to its session clock
  (~13 min) so a demo run fits in two minutes; `VITE_MOCK_SPEED` scales it.
- Control events (find-open/query/pin, collapse, expand, end) live in the same
  fixture stream as speech so the whole demo is hands-free and deterministic.
- The fixture supplies per-segment highlight phrases; the runtime applies them
  when the engine's trigger-substring pass didn't (covers reordered wordings).
- Mock audio sources synthesize a gently varying RMS so the setup meters are
  alive before a session starts.

## Verification

- `?screen=<name>` serves a static gallery of every screen/state with the
  mock's exact copy; it was screenshot-diffed against the reference HTML
  (fonts aliased to the bundled files). live, unsure, find, bank, armed and
  the primary strip land at 0.0% pixel diff; setup differs only by the
  specified transcript-toggle addition; editor is within ~1.7px (the mock's
  fake-caret glyph inflates its question box).

## Hardening round (post-handoff)

- **Strip window bridge**: each Electron window is its own renderer with its
  own stores, so the session-owning window derives a small `StripState`
  snapshot (`lib/strip.ts`) and main relays it to the strip window
  (`strip:publish` → `strip:state`, primed by `strip:get`). Only material
  changes send, throttled leading+trailing at 100ms; expand goes back as the
  `strip-expand` command so the session window stays the single owner of
  collapse state.
- **Cross-window bank freshness**: main broadcasts `bank:did-change` to every
  window except the saver; windows reload in place. `load()` preserves the
  selection and any open draft, so a remote save never clobbers in-progress
  edits — a draft saved after a remote change last-writer-wins, matching the
  single-file storage model.
- **System-audio loopback**: `setDisplayMediaRequestHandler` hands
  getDisplayMedia the primary screen with `audio: 'loopback'` (not
  `loopbackWithMute` — the candidate must keep hearing the meeting). Electron
  loopback is Windows-only, so a stream arriving without an audio track stops
  cleanly and the setup row's why-line becomes the platform instruction
  (macOS: loopback audio device, see README).
- **AudioWorklet capture** replaces the deprecated main-thread
  ScriptProcessorNode; ~2048-sample blocks post from the audio thread, and a
  zero-gain sink keeps the graph pulled without echoing the meeting or the
  mic out of the speakers (the old path connected capture to `destination`).
  Acquisition failures surface via `AudioSource.onError` instead of dying as
  unhandled rejections.
- **Model delivery**: workers fetch model files, so main serves
  `userData/models` over a privileged `lih-models://` protocol (a bare
  filesystem path isn't fetchable from a renderer). `npm run fetch-models`
  downloads the two model folders once; the setup screen shows a one-line
  notice while they're absent (suppressed in mock mode, which never loads
  models). The app degrades to lexical matching either way.
- **Crash resilience**: an error boundary per window falls back to a static
  points list read imperatively from the stores (zustand state survives a
  render crash), with Try again / Reload. The engine snapshots the session
  record every 20s (`incomplete: true`, same id as the final save, so end()
  overwrites); on boot the newest incomplete record becomes the last session,
  and its recap eyebrow reads "RECOVERED · …". Snapshots respect the
  transcript toggle exactly like the final record.
- **Rescore on embedding warm-up**: a window scored while the model was cold
  is rescored once its vectors land, provided the window hasn't changed and
  nothing is pinned; a rescore that still lands on "none" doesn't re-record
  the unmatched question, and one that turns confident merges into the
  already-recorded row via the existing 45s merge.
- **Deferred swap**: a confident match that lands inside the 2.5s swap
  debounce is queued and fires when the window expires (unless something else
  activated meanwhile) — previously it was silently dropped, losing a
  question asked right after a swap.
- **Strip position** persists on drag (debounced 500ms), not only on hide.
- **Electron mock mode** now shows the real strip window on collapse: window
  plumbing is gated on being in Electron, not on which driver runs.
- **Stories library**: the sidebar link opens a pane-3 surface (list +
  title/body/metric-chip editor). No mock exists — it borrows the 3b editor's
  field styles and the bank's row idiom. Saving updates every answer that
  references the story; "used in N answers" stays live. Deleting stories is
  deliberately out: answers reference them by id, and orphaning mid-prep is
  worse than a longer list.
- **Verification in-repo**: `tools/verify/` (pixel harness + e2e) with
  `verify:pixels` gating live/unsure/find/bank/armed/strip at ≤0.1% diff
  against the reference (setup/editor/strip-variants report-only for the
  documented reasons); CI runs typecheck → unit tests → both.

## Packaging (electron-builder)

- **`productName: "Live Interview Helper"`** makes the app read properly in
  Finder, but it also becomes `app.getName()` and therefore the `userData`
  directory. `scripts/fetch-models.mjs` reads `productName` from
  `package.json` rather than hard-coding a path, so the CLI and the app agree
  on where models live — verified end to end (the app reported the exact
  directory the script wrote to).
- **transformers.js is a devDependency, not a runtime one.** Vite
  bundles it into the renderer chunk at build time (1.4MB), so nothing
  imports it at runtime. Keeping it in `dependencies` dragged ~200MB of
  unused native ONNX builds and `sharp` into the package and triggered a
  native rebuild pass on every build.
- **`files` is an allowlist**, not a denylist: `out/**`, `package.json`, and
  `node_modules/zod` (the only module main externalizes). That's the whole
  app — 5.6MB asar versus 13MB when excluding heavy packages one by one,
  because transitive deps kept slipping through.
- **`npmRebuild: false`** — nothing shipped is a native module, so the
  rebuild pass only ever rebuilt `sharp`, which exists solely for the icon
  script.
- **Unsigned by default** (`mac.identity: null`, `hardenedRuntime: false`).
  Signing needs a Developer ID; the README documents the one-time
  right-click → Open. `build/entitlements.mac.plist` is written and wired up
  so turning signing on is a two-line change — it grants audio input plus the
  JIT/unsigned-memory entitlements ONNX Runtime's WASM backend needs under the
  hardened runtime.
- **`NSMicrophoneUsageDescription` and `NSScreenCaptureUsageDescription`** go
  in via `mac.extendInfo`. The first is not optional: macOS terminates an app
  that requests the mic without it. Both strings say the audio stays on the
  machine, matching the setup screen's promise.
- **Icon generated from the design tokens** (`build/make-icon.mjs`, one
  1024px PNG that electron-builder converts to `.icns`/`.ico`): the panel
  background, the listening-green dot converted from the app's own
  `oklch(0.72 0.15 145)`, and three point rows with the covered ones struck
  through. Checked at 64px so it survives a dock icon.
- **In-app model download.** A packaged user has no npm scripts, so the setup
  screen's models notice offers "Download now" with per-file progress, driven
  by the same `src/shared/models.json` manifest as the CLI script. Without it
  a packaged install could never get semantic matching.
- The macOS binary is named `Live Interview` — macOS caps
  `CFBundleExecutable` at 15 characters and electron-builder truncates to
  match. Finder still shows the full `CFBundleName`. Only worth recording
  because tooling that looks for a binary named after the `.app` will miss.

## Real-use round (audio quality, honest status, quitting)

Everything here came from one real session on a Mac. None of it was
reachable from the mock driver, which has no microphone, no room and no
window lifecycle.

- **The status dot was dishonest, and that is the worst bug in the list.**
  It flickered several times per sentence because it was a bare threshold on
  a 42ms instantaneous RMS window, and the flicker read as activity for a
  meeting source that may never have worked at all. Liveness is now an
  envelope follower into a hysteretic gate with a hold, published at ~10Hz,
  and "no audio track" is a *third* state with its own colour — a source that
  cannot work must never look like one that is merely quiet.
- **The VAD threshold is adaptive, not a constant.** `SILENCE_RMS = 0.008`
  meant a microphone quieter than that produced no transcript, no error and
  no warning — indistinguishable from a silent room. The floor is estimated
  continuously (primed from the room, slow rise, fast fall, frozen while
  speech is open) with an absolute backstop 18dB lower than the old constant.
- **Silence is kept, not excised.** Sub-threshold chunks used to be dropped
  *before buffering*, so Whisper received speech spliced at every inter-word
  gap with the low-energy phonemes clipped off both ends of every word. That
  is close to a worst case for a model trained on continuous speech. Once a
  segment opens, everything is kept until it closes, with 300ms of pre-roll
  ahead of the onset and a trimmed tail pad after it.
- **Proper resampling.** 48k → 16k was every third sample with no filter, so
  everything from 8–24kHz folded onto the vowels. Now a windowed-sinc
  polyphase resampler with a 75Hz high-pass ahead of it. `resample.test.ts`
  reproduces the old decimator so the 40dB improvement is visible rather than
  asserted.
- **`channelCountMode: 'explicit'`.** With the default `'max'` the node's
  `channelCount: 1` was ignored and the worklet only ever saw the left
  channel — the right one was silently discarded rather than mixed.
- **A serial queue instead of a `busy` flag.** The old guard *dropped*
  whatever arrived during a decode, losing real speech exactly when the
  machine was under load. Partials are bounded to a trailing window (they used
  to re-transcribe the whole growing buffer, so each cost more than the last)
  and are the only thing the queue is allowed to discard.
- **Whisper's silence boilerplate is filtered.** Handed room tone the model
  emits "Thank you.", "[BLANK_AUDIO]", music notes or a repetition loop, and
  every one of those would be scored against the answer bank. The filler rule
  keys off *voiced* time, not the words, so a real "thank you" survives.
- **The meeting side takes a device, not just a screen capture.** Electron's
  loopback capture is Windows-only; on macOS the meeting has to arrive
  through a virtual cable as an ordinary input. Both sources now have a
  picker, and a source with no track names a virtual cable it can see rather
  than leaving you to guess. The loopback path asks for no echo cancellation,
  AGC or noise suppression — the feed is already clean digital audio and AEC
  would gate out the interviewer whenever you spoke. The microphone asks for
  all three.
- **"Test" records and transcribes.** It used to call `requestMicrophone()`
  and do nothing when permission was already granted, which is the normal
  case on that screen. A check that cannot fail is worse than no check.
- **Pause stops the tracks.** It used to flip a status flag while the
  microphone stayed open, which does not square with "audio stays on this
  machine and nothing is recorded". The meters going dark is the proof.
- **A ⌘⇧D diagnostics panel** reporting level, the estimated noise floor and
  the threshold speech has to clear, segments transcribed, model state and
  the last few lines heard — with one plain-language verdict on top. The mic
  bug was invisible precisely because nothing reported any of this.
- **base.en is the speech model, and there is no picker.** tiny.en used to sit
  beside it on the setup screen, described honestly as "misses more words" —
  which makes it an offer to trade away the thing the product is for. It is
  still downloaded, still the automatic fallback when base.en cannot be loaded,
  and still named honestly in ⌘⇧D when it is what is running; it is simply not
  a choice on a screen. A word Whisper drops is a question the matcher scores
  wrong, and the measurement that closed this question is in the round below: a
  mangled transcript costs more match score than the entire spread between
  three encoders.
- **The size the picker quoted was the whole install.** "~145 MB" for base.en
  was base.en *plus* tiny.en *plus* MiniLM, attributed to one tier — so the
  choice looked like it saved 105MB when it saved 34. Sizes now come with a
  test that reads the manifest and fails if a quoted number drifts from the
  bytes actually downloaded.
- **A stored tier that is no longer offered is migrated on read.** Both read
  sites, not just load: `updateSettings` read-merge-writes, so migrating only
  on load would let the next strip drag write the stale model straight back.
- **The speech model is never swapped while a session runs.** The engine closes
  over the transcription service's transcribers, and a disposed service
  swallows pushes in silence rather than throwing — so a mid-interview swap
  would not change models, it would end transcription for the rest of the
  session under a live-green dot. `ensureModels()` refuses; the change lands at
  the next arm.
- **Quitting exists.** Every window is frameless, so there was no close
  button anywhere, no menu, no tray, and no quit shortcut — and `showStrip`
  hid the main window rather than closing it, so destroying the strip left a
  running, invisible, unquittable process that `window-all-closed` would
  never fire for. There is now an application menu (a File menu on
  non-macOS, where a frameless window renders no menu bar), a tray, ⌘⇧Q, and
  an `activate` handler. `smoke-package.mjs` asserts all of it, including that
  plain ⌘Q is *not* registered globally — that would hijack Quit in every
  other app on the machine.
- **Every new Settings field carries a zod `.default()`.** `readValidated`
  falls back to `DEFAULT_SETTINGS` wholesale when parsing fails, so a new
  required field would silently wipe an existing user's placement, transcript
  preference and strip position on upgrade.

## Latency and prep round

Everything here came from reading the code after the audio round, not from a
new symptom. Two of the three were structural: they had been true since the
first build and were invisible because nothing measured them.

- **The models load on the setup screen, not at "Start listening".** Creating
  them inside `startSession` meant the opening minute of every interview ran
  while ~145MB of Whisper came off disk — utterances queued behind the load and
  were dropped past the cap of four — and while MiniLM was still cold, which
  left the matcher with no embeddings at all and falling back to bigram Dice.
  The first question is usually the one you most want the card up for, and it
  was the one least likely to work. Transcription stays *disabled* until a
  session arms: warm model, idle pipeline, nothing said in front of the setup
  screen transcribed. Ending a session no longer disposes them, so a second one
  costs nothing.
- **One transcription worker, not one per stream.** Two copies of base.en is
  ~290MB resident and two decodes competing for the same cores with no way to
  express which mattered. The queue now knows: the interviewer's audio puts the
  card on screen, yours only ticks off points already on it. Order is
  confirmed-them → confirmed-you → partial-them → partial-you, and overflow
  sheds the least urgent job rather than the oldest — which in a two-stream
  queue would mean discarding their question to keep your answer. The ordering
  lives in a pure `AsrQueue` because inside a worker it could only ever be
  reasoned about, never tested.
- **The panel matches on partials.** It used to ignore every unconfirmed
  segment, so a swap needed the VAD's 750ms of silence plus a decode and landed
  1.5–3s after the question ended — in the pause you were meant to be filling.
  Partials always warm the embedding now, and swap the panel when they clear a
  bar well above the confirmed one (0.78 against 0.62, with a wider margin).
  Being early is worth a lot; being early and wrong is worth less than nothing.
  When the full sentence arrives it corrects the wording on the row the partial
  opened rather than adding a second row to the recap.
- **Trigger phrases are embedded.** They only ever reached the score through
  fuzzy edit distance, so "hardest investigation" matched "the hardest
  investigation" and missed "the case that gave you the most trouble" — exactly
  the job a trigger phrase exists to do. Best cosine across the question and its
  phrases wins, phrases discounted 5% so the canonical wording takes a tie.
- **Coverage is scored over a rolling window as well as per segment.** A point
  delivered across two breaths could clear the bar in neither. The window
  carries a higher threshold, because more text is easier to match by accident.
- **A silence between *their* segments ends a turn.** Only your own speech used
  to, so a question could be scored together with preamble from a minute
  earlier. The question-like tail of the window is also scored separately and
  the better reading wins.
- **A small repeat prior.** An entry already answered is less likely to be
  asked again. Applying it exposed that clamping the score to 1 *before* the
  prior made it a no-op on precisely the saturated entries it exists to demote,
  so evidence now saturates first and the prior is applied after.
- **Import and export.** The bank sidebar already had an "Import from a job
  post" link wired to `() => {}` — a dead affordance in the shipped app. It now
  opens a real import/export pane in pane 3. Its text is deliberately unchanged:
  the `bank` screen is pixel-gated at ≤0.1% and the sidebar sits inside the
  compared region, so the pinned screenshot stays at 0.00%. The parser is
  forgiving because real prep notes are messy, and a heading earns an entry only
  if it reads like a question or carries content — otherwise the markdown this
  module exports would re-import its own section headings as questions. Nothing
  is written until the preview has been seen: merging pasted text blind into
  someone's prepared material the night before an interview is not a mistake
  they can undo.

## Post-review round

Calls made while fixing the findings of the full-codebase review (REVIEW.md);
the review's finding IDs are the cross-reference.

- **⌘K steals focus, deliberately (C1).** The find overlay needs real keyboard
  focus or everything typed lands in the meeting app — which is worse than the
  interviewer seeing a brief window flash. Closing the overlay (Esc, pin,
  click-away) blurs the panel so keys drift back toward the meeting. The
  no-focus-steal rule everywhere else stands; find is the one exception.
- **The trigger boost is a disambiguator, not a conjurer (C7).** A trigger
  phrase can lift a plausible semantic match over the confidence bar, but can
  no longer put a card up on its own: boosted scores cap at the ambiguous band
  unless the utterance also reads as a question. Triggers exist to break ties
  between entries the interviewer is plausibly asking about — hearing "your
  manager" in a war story should never claim a match.
- **Thresholds come from measurement, not intuition (H1).** The confident/
  ambiguous bars are now pinned by `tests/calibration.real.test.ts`, which runs
  honest paraphrases, off-bank questions and trigger-abuse utterances against
  the real MiniLM. Any future retune has to keep that suite green; symbolic
  unit tests alone cannot catch thresholds that are consistently wrong.
- **Coverage has its own calibration, and it is asymmetric.**
  `tests/coverage.real.test.ts` scores spoken deliveries of the seed points
  against the real embedder. A missed point leaves something on the card you
  have already said; a false strike-through hides something you have *not*
  said and you leave the interview without having made it. So the fixtures
  assert exactly which points a delivery may cover — including that it strikes
  nothing on any other answer — and the suite prints the two score
  populations, because an encoder that cannot separate them at all cannot be
  fixed by moving a threshold.
- **The transcript is a variable, not a constant.** The clean fixtures are
  prose; Whisper is not. `mangled` in the paraphrase fixture carries dropped
  question marks, run-ons, disfluencies and mishearings, tested as invariants
  against their own clean wording rather than as new absolute bars: the match
  may weaken, but it may not vanish, lose the entry off the shortlist, or turn
  confidently wrong. Measured today, a run-on or a disfluency costs about
  0.10–0.15 of score — enough on its own to push a question from the confident
  card onto the unsure one. That is a transcript problem, and no encoder swap
  fixes it.
- **The inference library moved from `@xenova/transformers` 2.17 to
  `@huggingface/transformers` 3.8.1**, so that a modern instruct model is even
  loadable: the old one could take a single self-contained int8 `.onnx` under
  2 GB, on an ONNX Runtime from February 2023, with no WebGPU, no 4-bit
  weights, no external-data files, and no support for any architecture newer
  than 2023. It runs the interview, so it landed as its own change with every
  existing gate green and nothing else in it.

  What it cost, in order of how long each took to find:
  - The new library defaults `allowLocalModels` to **false** in a browser
    context. Setting only `allowRemoteModels = false`, as before, leaves both
    disabled and it refuses to load anything: "both local and remote models are
    disabled". The offline probe caught it; nothing else would have.
  - Quantization is no longer the default. The old library loaded
    `model_quantized.onnx` unless told otherwise; the new one wants an explicit
    `dtype`, and an omitted one asks for an fp32 file that was never
    downloaded. Every pipeline call now names `dtype: 'q8'`.
  - The runtime's WebAssembly moved from four feature-detected binaries to one
    that degrades internally, under new names and a new `wasmPaths` shape.
  - `onnxruntime-web` 1.22 does not export its `.wasm` as a package subpath, so
    the build reaches it through a path alias, and it is a direct devDependency
    pinned to the exact version transformers.js loads. A binary from a
    different runtime than the JS expects is not a build error — it is a
    session that fails to create, offline, on the user's machine, with the
    interview about to start. `tests/inferenceStack.test.ts` fails if the two
    drift.

  **4.2.0 was tried first and rejected on evidence.** Its ONNX Runtime
  (1.26-dev) cannot create a session from the quantized Whisper decoders — not
  the ones we ship and not the current re-exports either: "Missing required
  scale ... for node model.decoder.embed_tokens.weight_transposed_
  DequantizeLinear". MiniLM was fine; transcription was dead. 3.8.1 runs the
  existing model files unchanged, and still brings 4-bit weights, WebGPU,
  external data and the current architectures.

  The proof that matching did not move is the strongest available: the encoder
  and coverage reports are **byte-identical** to the ones taken on the old
  library — same distributions, same d′, same headroom, same word errors — so
  not one threshold needed a second look.
- **The prep-time model was measured, and the job shipped without it.** The
  ask was "compress my own rambling into points I could say". Three candidates
  small enough to install were run against a real spoken answer
  (`tools/spike/llm-spike.mjs`, onnxruntime-node — the app's wasm path is
  slower still):

  | | on disk | generate | peak RSS | what it said |
  |---|---|---|---|---|
  | flan-t5-small | 93MB | 0.3s | 620MB | invented a "sex scandal" that is nowhere in the transcript |
  | LaMini-Flan-T5-248M | 265MB | 1.8s | 1400MB | refused the task as "inappropriate and offensive"; on a second prompt, inverted a fact (said the supervisor had a history of suspending people — the opposite of what was said) |
  | Qwen1.5-0.5B-Chat | 467MB | 10.9s | 2261MB | best of the three: two faithful lines, one invented ("I wrote each one up as if they were going to happen at any time") |
  | **extractive, on the encoder already installed** | **0MB** | **0.03s** | **210MB** | three of the speaker's own sentences, trimmed |

  Every model at this size invented something about the user's own
  experience. A fabricated detail in prep material is worse than no prep
  material: you rehearse it, and then you say it in the room, about your own
  career, to someone who may check. So the feature ships extractive — it cuts
  the user's own clauses, ranks them by what they carry, and drops the ones
  that say nothing. Every word it returns is a word they said, by
  construction, and it costs nothing to download and 40ms to run.

  The spike is committed. If a better candidate appears, the comparison is one
  command; the bar it has to clear is on this table.
- **The writing model was asked for, built a gate for, and still did not
  ship.** With the library upgraded, the best candidate inside the agreed
  budget — Qwen2.5-1.5B-Instruct at 4-bit with fp16 activations, 1.18 GB —
  was measured against a gate written before the run: a generated line passes
  only if every content word in it was said (stems compared), every number in
  it was said, it does not flip a negation, and it sits within 0.6 cosine of
  something actually said. The bar for shipping was 90% of lines passing.

  | prompt | lines passing | cost |
  |---|---|---|
  | plain ask | 0/3 | 23.8s, 5.3 GB peak |
  | "use only facts and words below" | 0/3 | 10.9s |
  | few-shot, *showing* it the copy operation | 1/5 | 21.1s |
  | **the extractive helper that ships** | **3/3** | **0.04s, 0 MB extra** |

  The failures are not pedantry. It wrote "each interview was documented
  immediately to avoid hindsight bias" (nobody said hindsight bias), "wrote
  down **decisions** as they happened" (they wrote up *interviews*), "I focused
  on avoiding any appearance of guilt" (the speaker said *suspension* reads as
  guilt — the model moved the guilt onto them), and "the site's history made
  things challenging", which is editorial invention. Forgiving the two pure
  synonym swaps still leaves 60% against a 90% bar.

  It also cost 21 seconds per request under native ONNX Runtime, where the app
  runs wasm and would be several times slower, and 5.4 GB of peak memory on a
  machine that will be running a video call. It fails on fidelity, on memory
  and on speed at once — and it is competing with something that takes 40
  milliseconds, downloads nothing and cannot invent anything by construction.

  The gate stays in `tools/spike/llm-spike.mjs`. It is the artifact that makes
  the answer re-checkable rather than an opinion: when a model can pass it, the
  question can be re-opened in one command.
- **The prep-time helper cannot receive interviewer speech, structurally.**
  Not by policy — by plumbing. The only text that reaches it is the excerpt
  the recap builds, and that is filtered to `speaker === 'you'` at the source.
  `tests/condense.test.ts` drives a transcript with interviewer lines in it
  through the real path and fails if any of them arrive; the e2e does the same
  against the running app, and additionally fails if any word in the generated
  points is a word the user never said.
- **A bigger encoder was measured and declined.** bge-small-en-v1.5 and
  gte-small (both ~+11MB over MiniLM, quantized ONNX) were scored against the
  same fixtures by `tests/encoder.real.test.ts`, which reports only
  threshold-free numbers — d′, pair-ordering, and the best bar each encoder
  could possibly have — because a comparison made at MiniLM's thresholds
  would just be measuring MiniLM's thresholds.

  | | MiniLM | bge-small | gte-small |
  |---|---|---|---|
  | matching d′ | **2.58** | 2.38 | 1.92 |
  | right entry top-1 | **23/26** | 21/26 | 21/26 |
  | right entry top-3 | 26/26 | 26/26 | 26/26 |
  | coverage d′ | **7.26** | 6.29 | 7.01 |
  | coverage headroom | **0.112** | 0.107 | 0.034 |

  Every population is perfectly orderable under all three (pair-ordering
  100%), so the difference is entirely in the margins — and MiniLM has the
  widest ones. The candidates also compress everything upward: gte's
  "never said it" median sits at 0.781 against MiniLM's 0.160, which is the
  failure the review's critique predicted — not "quality regresses" but
  "everything becomes ambiguous", silently, on a green build. Swapping would
  cost +11MB, a re-derivation of all ten constants and a fallback path, for no
  measured gain on this bank. The suite stays, so the question can be re-asked
  against a different bank or a different candidate in one command.
- **A bigger speech model was measured and declined too.** The transcript is
  the bottleneck, so the transcriber is where an upgrade would pay — if it
  could be afforded. `tools/spike/whisper-spike.mjs` measured the two
  candidates that exist in this stack's file layout, each in its own process
  (the first attempt loaded all three into one and reported memory figures that
  meant nothing):

  | | on disk | 8s partial window | peak RSS | word errors |
  |---|---|---|---|---|
  | `whisper-base.en` (incumbent) | 75 MB | **2.82s** | 1388 MB | **0.0%** |
  | `distil-whisper/distil-small.en` | 167 MB | 6.24s (2.21×) | 2374 MB | 31.8% |
  | `Xenova/whisper-small.en` | 240 MB | 6.35s (2.25×) | 2730 MB | 0.0% |

  The bar came from `tuning.ts` before any number was taken: a partial covers
  8 seconds and is produced every 1.6, so an 8-second clip has to decode in
  under 1.6 or the early card stops being early. Both candidates cost about
  **2.2× the incumbent** at exactly that window — a floor, since the app runs
  wasm and this ran native — and about **+1 GB of RSS**, on a machine that will
  also be running a video call.

  The accuracy case never arrived to argue against the cost. distil-small.en
  was measurably *worse*: it dropped half a sentence ("ask not what your
  country can do **for your country**"). small.en matched the incumbent
  exactly — which is what a ceiling looks like, not what an improvement looks
  like: base.en has no errors left to fix on a clean clip. Where a gain would
  show is disfluent interview speech, and that needs a real recording, so it is
  on the hardware checklist rather than guessed at here.
- **Distillation is not free.** Two decoder layers instead of twelve did not
  make distil-small.en faster than small.en in any measured length — they share
  an encoder byte-for-byte, and Whisper pads every clip to a fixed 30-second
  window, so the fixed cost dominates a 6-second question.
- **What actually costs matches is the transcript, not the encoder.** A
  run-on or a left-in disfluency costs 0.10–0.15 of score — larger than the
  entire spread between these three encoders. Effort belongs there.
- **An encoder that fails to load says so.** Transcription dying is obvious:
  the transcript stops. The matcher losing its embeddings is not — cards keep
  appearing, matched on bigram overlap, wrong more often, and nothing about
  the screen changes. It reached a `console.warn` and stopped there; it now
  raises the same notice strip the live panel and setup screen already read.
- **The bank check runs the real matcher, or it does not run.** A prep-time
  check that scores differently from the interview is worse than no check: it
  sends someone into the room confident about a bank that behaves differently.
  So it warms the encoder on entry instead of answering from bigram overlap,
  it constructs embeddings *only* — a prep tool must not put a speech model in
  memory, let alone one that could start listening — and it refuses outright
  while a session is running.
- **A finding without a remedy is homework.** The collision report is capped
  at the worst three, each carrying a merge or an open-it. The full N² list of
  confusable pairs is a ranked pile of work the night before an interview,
  which is exactly when nobody does it. The bar for reporting a rival is one
  confidence margin below the confident bar, not the ambiguous bar: in a bank
  of "tell me about a time you…" questions most entries have *some* rival
  above ambiguous, and three findings drawn from nine are noise.
- **No score reaches a user-facing surface.** Not in the check, not in the
  recap. A number invites tuning a bank against a threshold, and it means
  nothing without the distribution behind it — which is why the distribution
  lives in the calibration suites instead.
- **Nothing writes a trigger phrase on the user's behalf.** Both trigger
  defects in the review (C7, H13) were the app deciding a phrase for someone.
  The recap's near-miss fix opens the editor with the wording that missed
  sitting in the trigger *input* — uncommitted, one keystroke from being
  discarded, and not on disk until the answer is saved.
- **The excerpt the editor gets is your side only.** The recap has always
  handed the editor the transcript of an unmatched question and the editor has
  always thrown it away; it now renders those lines beside the points field,
  one click from becoming a point. Only `speaker === 'you'` lines travel:
  the interviewer's words are not the user's to keep, quote, or carry into
  anything downstream.
- **The 45s merge only trusts explicit context (H3).** Merging a new question
  into the current row is limited to ⌘K pins and same-window rescores. The old
  time-window heuristic swallowed genuine not-in-bank questions whenever any
  confident match had landed within 45 seconds.
- **Session chords are held only while a session runs (M19/H15).** Global
  shortcuts are system-wide; holding ⌘K all day steals it from every other
  app. Registration results are checked and failures surface on the setup
  screen — a silently dead panic chord is the worst failure this app has.
- **⌘⇧R ends a session only on a double press (H17).** It collides with the
  browsers' hard-reload chord; one reflexive press in a flaky CoderPad tab
  must not end the interview. Idle behaviour (reopen last recap) is unchanged.
- **An unreadable bank quarantines; it never silently seeds (H8).** The demo
  bank appearing where someone's prep should be — and the first save then
  destroying the original — is the single worst data outcome this app can
  produce. The corrupt file is renamed aside, the fallback is labelled in the
  UI, and restoring a JSON export is a first-class import path (M9).
- **Re-asking a question starts its coverage over (L19).** A recap row records
  "covered THIS time", not "covered at some point today" — inheriting the
  morning's strikethroughs made a skipped repeat answer look delivered.
- **Fresh-run seeding is still silent, by design.** The H8 rule above applies
  to *failed reads*; on a genuine first run (no bank.json, no backup) the seed
  is the product and a warning banner would be noise. `loadBank` distinguishes
  the two ('new' vs 'seed').

## Part 2 round (proposals)

The review's Part 2 was ten proposals rather than defects. Calls made while
building them:

- **Keyboard picks ship hint-less (P1).** Visible "1 2 3" badges on the
  candidate cards would change a pixel-gated screen, and the countdown block
  already says a decision is wanted. The keys are documented on the setup
  screen instead. The guards matter more than the feature: a bare digit is
  inert while ⌘K is open, while collapsed to the strip, inside any text field,
  or with a modifier held — otherwise typing "3 complaints" into find would
  swap the panel mid-interview.
- **Pause tells the truth in two places (P2).** The panel header and the strip
  both go grey and say so. A green dot over a closed microphone was the last
  dishonest signal in the app, and the strip counting off your next point
  while the mic is shut is the same lie in a smaller space.
- **"Never" is a real auto-pick option (P5).** The card then waits
  indefinitely, which can leave the panel ambiguous through an answer. That is
  the user's call to make: matching keeps re-resolving underneath, and a
  wrong answer committed while you were still reading is worse. The default
  stays 4s.
- **Legibility is a switch, not a fix (P7).** #6f6b64 on #16181b is 3.36:1 and
  fails AA — but the design reference IS the shipped look, and changing the
  tokens outright would fail the pixel gate on two screens and re-baseline the
  reference for everyone. Default off, three declarations, one root class.
- **The pixel gate outranked clean markup (P8).** Three elements stay
  non-buttons deliberately: the recap row (it contains its own button), the
  strip root (it is the window's drag region and contains the affordance
  buttons), and point rows and chips in their non-interactive variants (a
  button there is a tab stop that goes nowhere). Two lessons kept as comments:
  `all: unset` also resets box-sizing, which silently grew the strip by its
  padding and border; and the focus ring is scoped away from text fields,
  since the ⌘K overlay autofocuses its input and would have put a ring in the
  reference frame.
- **Practice is firewalled (P10).** A rehearsal writes nothing: no session
  record, no interim snapshots, no `lastUsed` stamp. An evening of practice
  runs must not dilute the interview history — and a practice record must
  never be the "RECOVERED" recap waiting at the next boot. The mini-recap
  lives in memory, and its header offers Done rather than Save or Delete,
  because both would be lies.
- **The pacing cue is text (P9).** No colour change, no motion, no sound. It
  appears past 150s — the same threshold the recap already uses for "ran
  long" — and says how long you have been on this one. Anything more
  attention-grabbing mid-answer would cost more than it gives.

## Known limitations

- The real capture path is wired end to end and its model delivery is now
  verified in a packaged build — a Web Worker fetched the full 23MB ONNX over
  `lih-models://`, which was the open question — but it has never run against
  a real microphone or meeting here: this container has no audio hardware.
  Transcription quality and the loopback route are still unproven on a
  desktop.
- macOS permission checks use Electron's `systemPreferences` via the main
  process; on other platforms they report granted and the dots follow signal
  level alone.
- Electron's loopback audio capture is Windows-only, so macOS needs a
  loopback audio device (BlackHole or similar) for the meeting side. The app
  detects the missing audio track, names a virtual cable if it can see one,
  and lets you select it as the meeting input — but whether that route
  actually carries a real meeting has still only been reasoned about here,
  not observed.
- Transcription accuracy, the adaptive VAD's behaviour in a real room, and
  the mic test's output can only be judged on a machine with audio hardware.
  Every DSP claim above is unit-tested against synthesised signals, which
  proves the maths and not the experience.
