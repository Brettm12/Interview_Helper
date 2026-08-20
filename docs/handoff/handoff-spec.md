# Handoff: Live Interview Helper

## Overview
A desktop assistant for a **candidate** during a live job interview. It listens to the call, recognizes which question the interviewer just asked, and pulls up that question's saved answer — 3–5 key points plus a specific story to tell — in a panel docked beside the video call. As the candidate speaks, points strike through so they can see what they've already covered. Supporting surfaces: a question bank for prep, an entry editor, and a pre-interview setup screen.

## About the Design Files
`Live Interview Helper.dc.html` in this bundle is a **design reference created in HTML** — a prototype showing intended look, layout, and states. It is not production code to copy.

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Electron, SwiftUI, etc.) using its established component patterns, styling approach, and libraries. If no codebase exists yet, choose an appropriate framework — note that the live panel needs to sit over/next to a video call and capture system + mic audio, which in practice means Electron/Tauri (desktop overlay) or a browser extension side panel.

Open the file in a browser to view it. It uses a host runtime (`support.js`) for streaming/preview; that runtime is **not** part of the design — ignore it. All styling is inline on the elements, so every value below can be read directly off the markup.

The file is organized as four `<section class="dv-turn">` blocks, newest first: `t4` (setup), `t3` (question bank), `t2` (live panel built out), `t1` (three original directions). Each design option carries a stable id: `4a`, `4b`, `3a`, `3b`, `2a`, `2b`, `2c`, `1a`, `1b`, `1c`.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and copy. Recreate pixel-accurately using the codebase's existing libraries and patterns. The `dv-*` wrapper chrome (turn sections, id badges, card frames, "Try next" lines) is **presentation scaffolding for design review only** — do not build it.

**The chosen direction is `1a`, built out in turn 2 (`2a`, `2b`, `2c`).** Options `1b` and `1c` are rejected alternatives, kept for reference only — do not build them.

## Screens / Views

### 1. Live panel docked beside the call — `2a` (primary screen)
**Purpose:** The main runtime surface. Candidate glances at it mid-answer.

**Layout:** Full app window, `display:flex`, background `#0e0f11`. Reference frame 1428×836.
- Left region: `flex:1`, `padding:16px`, column, `gap:12px` — the video call.
- Right region: `width:412px; flex:none`, `border-left:1px solid #26292e`, background `#16181b` — the helper panel. This width is the real spec; the call area is whatever is left.

**Call area (left)** — placeholder in the mock; in production this is the actual meeting window or a captured stream:
- Header row, `space-between`: "Senior PM · Round 2 · 3 participants" (500 11.5px Helvetica, `#6f6b64`) and a timer "12:41" (500 11.5px monospace, `#6f6b64`).
- Main tile: `flex:1`, `border-radius:10px`. Placeholder fill `repeating-linear-gradient(135deg,#1a1c1f 0 9px,#191b1e 9px 18px)`. Centered label "INTERVIEWER VIDEO" (500 11px monospace, letter-spacing `.1em`, `#4c4f54`). Bottom-left name pill: "Priya R. · speaking", 500 12px Helvetica `#a9a5a0`, background `rgba(0,0,0,.5)`, padding `6px 9px`, radius 5px.
- Thumbnail row: `height:150px`, `gap:12px`, three equal cells (third empty), radius 9px, same stripe fill.
- Control bar: centered, `gap:9px`. Pills: `padding:10px 16px`, `border-radius:20px`, 500 11.5px Helvetica. Secondary = `1px solid #2b2f35`, text `#8d8880`. "Leave" = background `#c9c4ba`, text `#16181b`.

**Helper panel (right)** — three stacked regions:

*Header* — `padding:14px 18px`, `border-bottom:1px solid #23262b`, `space-between`:
- Left: 7px circle, `oklch(0.72 0.15 145)` (the "listening" green) + "Listening" (500 11.5px Helvetica, `#b6b2aa`).
- Right: `⌘K find` chip — 500 10.5px monospace, `#c9c4ba` on `#2b2f35`, `padding:6px 8px`, radius 5px; then "Collapse" (500 11px Helvetica, `#6f6b64`).

*Body* — `flex:1`, `padding:22px 18px`, column, `gap:20px`:
1. **Progress + question.** Progress row: a 44×2px bar, `linear-gradient(90deg, oklch(0.72 0.15 145) 50%, #2e3238 50%)` where the split % = points covered; label "2 OF 4 COVERED" (500 9.5px monospace, letter-spacing `.1em`, `#8d8880`). Below, `margin-bottom:11px` gap, the question: **400 21px/1.32 Instrument Serif, `#f4f2ee`, `text-wrap:pretty`** — "Tell me about a time you disagreed with your manager."
2. **Key points**, column `gap:13px`. Three visual states:
   - *Covered:* `opacity:.4`, marker is a `✓` (400 12px monospace, `oklch(0.72 0.15 145)`), text 400 15.5px/1.42 Helvetica `#e6e3dd` with `text-decoration:line-through; text-decoration-thickness:1px`.
   - *Current:* marker is a 5px dot `oklch(0.72 0.15 145)` (`margin-top:7px`), text **500** 16px/1.42 Helvetica `#f4f2ee`.
   - *Upcoming:* 5px dot `#4f545b`, text 400 15.5px/1.42 Helvetica `#c3bfb8`.
   - Marker column and text sit in a flex row with `gap:11px`; markers are `flex:none`.
3. **Story card.** `border:1px solid #2b2f35`, radius 9px, `padding:15px 16px`, background `#1c1f23`. Label "STORY TO TELL" (500 9.5px monospace, `.1em`, `#8d8880`, `margin-bottom:9px`). Body 400 14px/1.45 Helvetica `#d9d5ce`. Metric chips row `gap:6px`, `margin-top:12px`: 500 10.5px monospace, text `#16181b` on `#c9c4ba`, `padding:5px 8px`, radius 4px ("9 days", "−18% drop-off").
4. **Earlier** (pushed down with `margin-top:auto`), column `gap:7px`: label "EARLIER" (same label style) + rows 400 13px/1.35 Helvetica `#9c968e`, format `Question? · 08:12`.

*Transcript footer* — `border-top:1px solid #23262b`, `padding:12px 18px`, background `#131518`:
- Row: "TRANSCRIPT" label + "hide" affordance, both 500 9.5px monospace `#8d8880`.
- Live text: 400 12px/1.5 monospace, `#8d8880`, `text-wrap:pretty`, prefixed with `you:` or `them:`. The matched phrase is highlighted: `#eceae5` on `#2b2f35`, `padding:1px 3px`, radius 3px. The last few words trail off at `opacity:.45` to convey in-flight recognition.

### 2. Unsure state — `1a` second frame
Shown when no single question clears the confidence bar. Same 404×760 panel shell.
- Header: dot becomes amber `oklch(0.78 0.15 75)`, label "Not sure which one"; right side "Search bank".
- Body (`flex:1`, `padding:22px 18px`, `gap:14px`): the heard phrase quoted in 400 17px/1.35 Instrument Serif `#cfcbc4`; label "TAP THE ONE THEY MEANT".
- **Candidate cards, 2–3, ranked.** Top candidate: `border:1px solid #3a3f46`, background `#1f2327`. Others: `border:1px solid #2b2f35`, no fill. All radius 9px, `padding:14px 15px`. Inside: title (500 15px/1.35 Helvetica; `#f4f2ee` top / `#e6e3dd` rest) with a right-aligned confidence figure (500 10.5px monospace; green `oklch(0.72 0.15 145)` for the leader, `#8d8880` otherwise) — 81% / 64% / 52%. Sub-line 400 12.5px/1.4 Helvetica `#8d8880`: "4 points · Roadmap freeze story".
- Bottom of body (`margin-top:auto`, `gap:9px`): "Keeps listening — picks on its own" + countdown "4s" (`#8d8880`); a 3px auto-pick progress bar (track `#26292e`, fill `oklch(0.78 0.15 75)`, radius 2px); then two equal buttons `gap:7px` — "None of these" and "Search bank", 500 11.5px Helvetica `#cfcbc4`, `1px solid #2b2f35`, radius 6px, `padding:9px 0`.
- Transcript footer as above.

### 3. Panic find (⌘K) — `2b`
**Purpose:** Pull up any answer instantly when the matcher is wrong or the question isn't in the bank. Overlays the panel; 412px wide.
- Search header: `padding:16px 18px 14px`, background `#1c1f23`, `border-bottom:1px solid #23262b`. `⌘K` glyph (500 10.5px monospace `#8d8880`) + query text 400 17px Helvetica `#f4f2ee` with a `|` caret at `opacity:.5`.
- "3 MATCHES" label, `padding:6px 18px 10px`.
- Result rows, `padding:13px 18px`. Selected row: background `#1f2327` + `border-left:2px solid oklch(0.72 0.15 145)`, title 500 15.5px/1.35 `#f4f2ee` with the query term highlighted on `#2f3a33`, and a **preview of the answer's key points inline** (400 13px/1.45 `#a8a39b`, points joined with " · "). Unselected rows: `border-bottom:1px solid #21242a`, title 400 15px `#e6e3dd`, sub-line "3 points · Notifications rollback" in `#8d8880`.
- Footer hints (`margin-top:auto`, `padding:14px 18px`, `gap:16px`, 500 11px monospace `#8d8880`): "↑↓ move", "↵ pin it", "esc back to live".

### 4. Share-safe strip — `2c`
**Purpose:** When the candidate screen-shares, the panel collapses to one line that reveals nothing incriminating at a glance.
- Strip: `width:340px`, background `rgba(18,20,23,.94)` (opaque `#121417` when not overlaying), `1px solid #2b2f35`, radius 8px, `padding:10px 12px`, flex row `gap:10px`, `box-shadow:0 6px 20px rgba(0,0,0,.28)`. Positioned `top:14px; right:14px` over the shared surface.
- Contents: 6px status dot; the current point only — 500 12.5px/1.3 Helvetica `#eceae5`, `flex:1`, `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`; progress "3/4" (500 10px monospace `#8d8880`); a `▾` expand affordance.
- Variants: *next point queued* — same, counter "4/4". *New question heard* — border becomes `oklch(0.5 0.09 145)`, dot amber `oklch(0.78 0.15 75)`, text prefixed "New: ", right affordance reads "open" in `#c9c4ba`.

### 5. Question bank — `3a`
**Purpose:** Prep surface. Reference frame 1280×812, three panes, background `#16181b`.

**Pane 1 — loops/sections, `width:214px; flex:none`,** background `#131518`, `border-right:1px solid #23262b`, `padding:16px 0`:
- Title "Question bank" (500 12px `#b6b2aa`, `padding:0 16px 16px`).
- "LOOPS" label (`padding:0 16px 8px`). Rows `padding:8px 16px`; selected = background `#1f2327` + `border-left:2px solid oklch(0.72 0.15 145)`, 500 13.5px `#f4f2ee`; others 400 13.5px `#a8a39b`.
- "SECTIONS" label (`padding:20px 16px 8px`), rows `padding:7px 16px` `space-between`: name 400 13px `#c3bfb8` + count 500 10.5px monospace `#8d8880`.
- Footer (`margin-top:auto`, `border-top:1px solid #21242a`, `padding:14px 16px 0`, `gap:10px`): "Import from a job post", "Stories library · 11" — 500 12px `#a8a39b`.

**Pane 2 — answer list, `width:396px; flex:none`,** `border-right:1px solid #23262b`:
- Header `padding:14px 18px`, `border-bottom:1px solid #23262b`: "Search 23 answers" (400 13px `#8d8880`) + "New answer" chip (500 11px `#c9c4ba` on `#2b2f35`, `padding:6px 9px`, radius 5px).
- Section labels ("BEHAVIOURAL", "PRODUCT SENSE") `padding:11px 18px 9px`.
- Rows `padding:12px 18px`, `border-bottom:1px solid #21242a`; selected row drops the border and gets background `#1f2327` + `border-left:2px solid oklch(0.72 0.15 145)`, title 500 14.5px `#f4f2ee`. Others 400 14.5px `#e6e3dd`. Meta line `margin-top:8px`, 500 10.5px monospace `#8d8880`, dot-separated: "4 points · Checkout redesign". **Incomplete entries** show "no story yet" in amber `oklch(0.78 0.15 75)` instead.

**Pane 3 — entry detail, `flex:1`:**
- Header `padding:14px 22px`: breadcrumb-ish "BEHAVIOURAL · ASKED IN 3 LOOPS" (500 11px monospace, `.08em`, `#8d8880`) + "Edit" / "Practice" (500 11px `#c9c4ba`, `gap:12px`).
- Body `padding:26px 22px`, column `gap:24px`:
  - Question, 400 24px/1.28 Instrument Serif `#f4f2ee`.
  - "KEY POINTS" list — same dot + 400 15.5px/1.42 `#e6e3dd` rows as the live panel, `gap:12px`.
  - Story card (as in `2a`) with an extra right-aligned "used in 4 answers" note and three metric chips. **Stories are shared entities reused across answers.**
  - "ALSO TRIGGERS ON" — phrase chips, wrapping row `gap:7px`: 400 12.5px Helvetica `#c3bfb8`, `1px solid #2b2f35`, radius 14px, `padding:7px 11px`. Add-chip uses `1px dashed #3a3f46`, text `#8d8880`.
  - Footer (`margin-top:auto`, `border-top:1px solid #21242a`, `padding-top:16px`, `space-between`, 500 11.5px `#8d8880`): "Last used · Halcyon screen, 12 Aug" / "Covered 4/4 that time".

### 6. Editing an entry — `3b`
520×812 pane. Header: "EDITING" label + "Cancel" (500 11px `#8d8880`) and "Save" (500 11px `#16181b` on `#c9c4ba`, `padding:7px 11px`, radius 5px).
Body `padding:24px 22px`, `gap:22px`. Each field = label (500 9.5px monospace `.1em` `#8d8880`) + control, `gap:9px`:
- **Question:** `1px solid #3a3f46` (focused), background `#1c1f23`, radius 8px, `padding:14px 15px`, text 400 18px/1.32 Instrument Serif `#f4f2ee` + caret.
- **Key points:** label row has a right-aligned "drag to reorder" (500 10px monospace). Rows `gap:7px`: flex row `gap:10px`, `1px solid #2b2f35`, radius 7px, `padding:11px 12px`, background `#1a1d21`; drag handle `⠿` (500 11px monospace `#6f6b64`); text 400 14.5px/1.35 `#e6e3dd`. Focused row: border `#3a3f46`, background `#1f2327`, text `#f4f2ee` + caret. Add-row: `1px dashed #3a3f46`, placeholder "Add a point — keep it sayable in one breath" (400 13.5px `#8d8880`).
- **Story:** picker row, `1px solid #2b2f35`, background `#1c1f23`, radius 8px, `padding:13px 14px`, `space-between`: name 500 14px `#f4f2ee` + sub "from stories library · 3 metrics attached" (400 12.5px `#8d8880`, `margin-top:5px`); right action "Swap" (500 11px `#c9c4ba`).
- **Trigger phrases:** chips as in `3a`, each with a removable `×` (`#6f6b64`, `gap:7px`); input chip "type a phrase…" dashed. Helper text below: 400 12px/1.5 `#8d8880` — "Matching is fuzzy — phrases only help when the wording is unusual."

### 7. Pre-interview setup — `4a`
880×812 window.
- **Header** `padding:26px 30px 20px`, `border-bottom:1px solid #23262b`, `align-items:flex-end`, `space-between`: eyebrow "STARTS IN 6 MINUTES" (label style, `margin-bottom:10px`), title 400 26px/1.25 Instrument Serif `#f4f2ee`, sub 400 13.5px/1.4 Helvetica `#a8a39b` `margin-top:8px`. Primary CTA "Start listening": 500 12px `#16181b` on `#c9c4ba`, `padding:12px 18px`, radius 6px.
- **Body** `padding:24px 30px`, `gap:24px`, three labeled groups (`gap:12px` each):
  1. **BANK LOADED** — label row with right-aligned "Edit bank" (500 11px `#c9c4ba`). Three stat cards `gap:10px`, `flex:1`, `1px solid #2b2f35`, radius 9px, background `#1c1f23`, `padding:15px 16px`: number 400 25px Instrument Serif `#f4f2ee`, caption 400 12.5px/1.4 `#8d8880` `margin-top:7px`. **Warning variant** (2 answers with no story): border `oklch(0.42 0.07 75)`, background `#221e19`, number `oklch(0.86 0.12 75)`, caption `#bfb3a0`.
  2. **WHAT IT HEARS** — one bordered container (`1px solid #2b2f35`, radius 9px, background `#1c1f23`) with two rows `padding:14px 16px` split by `border-bottom:1px solid #23262b`. Each row: 7px green status dot, then title 500 14px `#f4f2ee` + why-line 400 12.5px/1.4 `#8d8880` (`margin-top:5px`). Row 1 "Meeting audio · Google Meet tab" / "so it hears their questions", right side a 5-bar level meter (2.5px bars, heights 6/13/9/14/5, green, `gap:2px`, `align-items:flex-end`). Row 2 "Your mic · MacBook Pro" / "so it can tick off points as you say them", right side "Test" (500 11px `#c9c4ba`). Below the container, privacy note 400 12px/1.5 `#8d8880`: "Audio stays on this machine. Nothing is recorded unless you turn on the recap."
  3. **WHERE THE PANEL SITS** — three selectable cards `gap:10px`, `flex:1`, radius 9px, `padding:13px 14px`. Selected: `1px solid #4b5158`, background `#1f2327`, title `#f4f2ee`. Unselected: `1px solid #2b2f35`, no fill, title `#e6e3dd`. Each holds a 52px-tall schematic (background `#131518`, radius 5px, `padding:4px`; call area filled with `repeating-linear-gradient(135deg,#242830 0 6px,#20242b 6px 12px)`; the panel represented as a solid block — `oklch(0.55 0.09 145)` when selected, `#4b5158` otherwise), then title 500 13px and caption 400 12px/1.4 `#8d8880` (`margin-top:5px`). Options: "Docked right / Full panel, resizes the call"; "Floating strip / One line, safe to share"; "Second screen / Full bank, off the shared display".
- **Footer** `margin-top:auto`, `padding-top:18px`, `border-top:1px solid #21242a`, `space-between`: shortcut list `gap:20px` (500 11.5px `#8d8880`) — "⌘K find answer", "⌘⇧H hide panel", "⌘⇧R recap after"; right "Dry run · 2 min" (`#c9c4ba`).

### 8. Armed / waiting — `4b`
412×400 card, `padding:26px 22px`. Green dot + "ARMED · WAITING FOR THEM" label (`margin-bottom:26px`). Headline 400 21px/1.3 Instrument Serif `#f4f2ee`: "23 answers loaded. I'll pull one up the moment they ask." Then `margin-top:26px`, `gap:11px`: "MOST LIKELY OPENER" label + two rows 400 15.5px/1.4 Helvetica (`#e6e3dd`, then `#a8a39b`). Footer `margin-top:auto`, `padding-top:18px`, `border-top:1px solid #21242a`, `space-between`: "Nothing heard yet" (`#8d8880`) / "Pause" (`#c9c4ba`).

## Interactions & Behavior

**Matching loop (core):**
1. Continuously transcribe meeting audio. The transcript footer streams words as they arrive; the trailing unconfirmed words render at `opacity:.45`.
2. Score each bank entry against the recent utterance (fuzzy semantic match; author-supplied trigger phrases boost specific entries).
3. If the top score clears the confidence threshold and beats the runner-up by a clear margin → swap the panel to that entry, highlight the matched phrase in the transcript, timestamp it into "EARLIER".
4. Otherwise → show the unsure state with the top 2–3 candidates and their confidence percentages, plus a countdown (≈4s) after which the leader is auto-selected. Tapping a candidate commits it immediately; "None of these" dismisses back to listening; "Search bank" opens the ⌘K find.
5. Keep listening during an answer: transcribe the candidate's own mic and mark a key point covered when its semantics appear in what they said. The covered count, the 44px progress bar split, and the "current point" emphasis all derive from this.

**Panel transitions:** question swap should be a quick crossfade with no layout jump (the panel is fixed-width; question text height varies — reserve space or animate height). Point state changes animate opacity/`line-through` over ~200ms ease-out. Nothing should flash or bounce — the user is mid-sentence and glancing.

**Panic find:** `⌘K` opens search over the panel, focus in the field, fuzzy across question text, key points, and story names. `↑↓` moves, `↵` pins the entry into the live panel (and suppresses auto-matching until the next detected question), `esc` returns to live.

**Collapse:** "Collapse" in the header and `⌘⇧H` collapse the panel to the share-safe strip. The strip shows only the current point; `▾` re-expands. When a new question is detected while collapsed, the strip changes border/dot color and shows "New: <question>" with an "open" affordance — it does not auto-expand.

**Bank:** selecting a loop filters the list; selecting a list row loads pane 3. "Edit" turns pane 3 into `3b`'s editor. Key points are drag-reorderable. Story is picked from a shared stories library (one story reused across many answers; editing it updates everywhere). Trigger-phrase chips add on `↵`, remove on `×`.

**Setup:** the warning stat card ("2 no story yet") links into a filtered bank view. Both audio sources must report a live signal before "Start listening" enables; the mic "Test" runs a short level check. Panel placement is a single-select of three. "Start listening" arms the app → `4b`.

## State Management
- `session`: `{ loopId, startedAt, elapsed, status: 'idle' | 'armed' | 'listening' | 'paused' }`
- `audio`: `{ meetingSource, micSource, meetingLevel, micLevel, permissionsOk }`
- `transcript`: rolling buffer of `{ speaker: 'them' | 'you', text, confirmed: boolean, t }`
- `match`: `{ state: 'none' | 'confident' | 'ambiguous' | 'pinned', entryId, candidates: [{entryId, score}], autoPickAt }`
- `coverage`: `{ [entryId]: Set<pointId> }` — drives strike-through and the progress bar
- `history`: `[{ entryId, askedAt, coveredCount, totalPoints }]` — feeds "EARLIER"
- `panel`: `{ placement: 'docked' | 'strip' | 'second-screen', collapsed, transcriptVisible }`
- `find`: `{ open, query, results, selectedIndex }`
- Bank data (persisted): `Loop`, `Section`, `Answer { question, points[], storyId, triggerPhrases[], lastUsed }`, `Story { title, body, metrics[] }`

Data fetching: bank data is local-first (it must work if the network hiccups mid-interview). Transcription and matching should run on-device if the platform allows — the setup screen promises "Audio stays on this machine."

## Design Tokens

**Colors**
| Token | Value | Use |
|---|---|---|
| bg/app | `#0e0f11` | Window behind the call |
| bg/panel | `#16181b` | Panel + bank surface |
| bg/panel-deep | `#131518` | Transcript footer, sidebar |
| bg/raised | `#1c1f23` | Story card, inputs, stat cards |
| bg/row-selected | `#1f2327` | Selected rows, top candidate |
| bg/row | `#1a1d21` | Editor point rows |
| bg/strip | `#121417` / `rgba(18,20,23,.94)` | Share-safe strip |
| border/strong | `#3a3f46` | Focused input, top candidate |
| border/mid | `#2b2f35` | Cards, chips, buttons |
| border/hairline | `#26292e`, `#23262b`, `#21242a` | Window, section, row dividers |
| text/primary | `#f4f2ee` | Questions, active point |
| text/body | `#e6e3dd` | Key points |
| text/secondary | `#c3bfb8`, `#c9c4ba`, `#cfcbc4` | Chips, actions, quiet buttons |
| text/muted | `#a8a39b`, `#9c968e` | Sub-lines, history |
| text/label | `#8d8880` | All monospace labels, transcript |
| text/inverse | `#16181b` | On light chips/CTA |
| accent/light | `#c9c4ba` | Primary CTA, metric chips |
| status/live | `oklch(0.72 0.15 145)` | Listening dot, ✓, covered progress |
| status/live-dim | `oklch(0.55 0.09 145)`, `oklch(0.5 0.09 145)` | Schematic fill, strip alert border |
| status/attention | `oklch(0.78 0.15 75)` | Unsure state, new-question alert |
| status/attention-text | `oklch(0.86 0.12 75)` | Warning stat number |
| warn/bg, warn/border, warn/text | `#221e19`, `oklch(0.42 0.07 75)`, `#bfb3a0` | Warning stat card |
| dot/inactive | `#4f545b` | Upcoming point marker |
| placeholder stripes | `repeating-linear-gradient(135deg,#1a1c1f 0 9px,#191b1e 9px 18px)` and `(135deg,#242830 0 6px,#20242b 6px 12px)` | Video/schematic placeholders — **replace with real content** |

**Typography** — three families:
- **Instrument Serif** 400 — questions and headline numbers only. 26px/1.25 (setup title), 24px/1.28 (bank detail), 21px/1.32 (live question, armed headline), 18px/1.32 (editor question), 17px/1.35 (heard phrase, italic where quoted), 25px/1 (stat numbers).
- **Helvetica Neue** — all UI text. 16px/1.42 500 (current point), 15.5px/1.42 400 (points), 15/15.5px 500 (candidate + result titles), 14.5px/1.35 (list rows, editor rows), 14px/1.45–1.5 (story body), 13.5px/1.3–1.4 (nav rows, subs), 13px/1.35 (history), 12.5px/1.4 (chips, meta), 12px/1.5 (helper text), 11.5px/1 500 (buttons, footers), 11px/1 500 (small actions).
- **JetBrains Mono** (or system mono) — machine text: 12/12.5px/1.5–1.6 400 (transcript), 11px 500 `.08em` (breadcrumbs), 10.5px 500 (counts, metric chips, confidence, shortcuts), 9.5px 500 `.1em` uppercase (all section labels).

**Spacing** — 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 30. Panel padding `22px 18px`; bank detail `26px 22px`; setup `24px 30px`. Section gap 20–24px, list gap 12–13px, tight rows 7px.

**Radius** — 4 (metric chips), 5 (name pill, small chips, schematics), 6 (CTA, quiet buttons), 7 (editor rows), 8 (strip, inputs), 9 (cards, tiles), 10 (main video tile), 14 (phrase chips), 20 (call controls), 50% (status dots).

**Shadows** — only one: `0 6px 20px rgba(0,0,0,.28)` on the floating strip. Everything else uses borders.

**Other** — status dots are 7px (panel/setup) or 6px (strip); point markers 5px. Accent rails are 2px (`border-left`). Progress bars are 2–3px. `text-wrap:pretty` on every multi-line text block.

## Assets
None. The video tiles and panel-placement schematics are CSS stripe placeholders — swap in the real meeting surface. There are no icons in the design by intent; the few glyphs are text characters: `✓`, `→`, `⠿` (drag handle), `▾`, `×`, `↑↓`, `↵`, `⌘`, `⇧`. Level meters are plain divs. If the codebase has an icon set, using it for the drag handle and chevron is fine; do not add icons where the design has none. Fonts: Instrument Serif and JetBrains Mono from Google Fonts; Helvetica Neue is a system stack (`"Helvetica Neue", Helvetica, sans-serif`).

## Files
- `Live Interview Helper.dc.html` — all screens. Turn `t2` (`2a`/`2b`/`2c`) is the primary spec; `t3` the bank; `t4` setup; `t1` the original directions (only `1a` matters, and its second frame is the unsure state).
- `support.js` — host preview runtime. Required only to open the HTML locally. **Not part of the design; do not port.**
