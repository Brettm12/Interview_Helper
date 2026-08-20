# Setup screen addition: transcript toggle (authoritative — not in the mock)

The setup copy promises "Nothing is recorded unless you turn on the recap", but `4a` has no control for it. Add one to the WHAT IT HEARS container as a third row, same row spec as the other two (`padding:14px 16px`, `border-bottom` above it): title 500 14px `#f4f2ee` "Keep a transcript for the recap", why-line 400 12.5px/1.4 `#8d8880` "so you can see what you missed afterwards". Right side is a small toggle — 32×18px track, radius 9px, `#2b2f35` off / `oklch(0.55 0.09 145)` on, 14px knob `#c9c4ba`, 120ms ease. Default off. (When it's off, the recap still works from in-memory session state; it just can't show transcript excerpts.)

Also required on setup (from the handoff, restated):

- The two status dots are a live signal: green only when that source's permission is granted **and** it reports a level. If permission is missing, the dot goes **amber** (`oklch(0.78 0.15 75)`) and the why-line becomes the fix instruction (comes in via props — the screen just renders `ok` + `why`).
- "Start listening" stays disabled until both sources report a level (`canStart` prop) — render the CTA at `opacity:.45` and no pointer cursor when disabled.
- The warning stat card ("2 / no story yet — fix now") is clickable → `onFixNoStory` (links into a filtered bank view).
- Placement cards are a single-select of three (`placement` + `onPlacement`). `placementError` (when not null) renders as one quiet line under the placement cards: 400 12px/1.5 `#8d8880`.
