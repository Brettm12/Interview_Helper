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
- "Practice" (bank detail) and "Dry run · 2 min" (setup) both start the
  scripted mock session — that is what a dry run is, and it works with no
  hardware.
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

## Known limitations (phase 4)

- The real capture path (getUserMedia / getDisplayMedia loopback → Whisper +
  MiniLM workers) typechecks and is wired end to end, but has not run against
  real hardware in this environment; the `lih-models://` delivery to
  `@xenova/transformers` inside workers needs a runtime spike on a desktop
  (fallback if it misbehaves: a localhost HTTP server in main).
- macOS permission checks use Electron's `systemPreferences` via the main
  process; on other platforms they report granted and the dots follow signal
  level alone.
