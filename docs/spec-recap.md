# Screen 9: Recap (authoritative spec — no mock exists for this screen)

The setup screen's footer already advertises `⌘⇧R recap after`, and the privacy line says nothing is recorded unless the recap is on. This is that screen. Same window frame as setup, 880×812, background `#16181b`. It opens on ⌘⇧R and automatically when the session ends.

Header — `padding:26px 30px 20px`, `border-bottom:1px solid #23262b`, `align-items:flex-end`, `space-between`:

- Left: eyebrow "SESSION ENDED · 42 MINUTES" (500 9.5px monospace, `.1em`, `#8d8880`, `margin-bottom:10px`); title 400 26px/1.25 Instrument Serif `#f4f2ee` — the loop name; sub 400 13.5px/1.4 Helvetica `#a8a39b`, `margin-top:8px` — "9 questions heard · 7 matched to your bank".
- Right, flex row `gap:14px`, `align-items:center`: "Delete session" (500 11px Helvetica `#8d8880`) then primary CTA "Save to loop" — 500 12px `#16181b` on `#c9c4ba`, `padding:12px 18px`, radius 6px.

Body — `padding:24px 30px`, column, `gap:24px`. Three labelled groups, each `gap:12px`, labels in the standard 9.5px mono style.

1. HOW IT WENT — three stat cards, identical spec to the setup screen's: `flex:1`, `1px solid #2b2f35`, radius 9px, background `#1c1f23`, `padding:15px 16px`, number 400 25px Instrument Serif `#f4f2ee`, caption 400 12.5px/1.4 `#8d8880`, `margin-top:7px`. Cards: "26 / points covered out of 31", "7 / questions matched to your bank", and "2 / questions not in the bank at all" — the third takes the warning variant (border `oklch(0.42 0.07 75)`, background `#221e19`, number `oklch(0.86 0.12 75)`, caption `#bfb3a0`) whenever the count is above zero, and the standard variant when it's zero.

2. QUESTION BY QUESTION — one bordered container (`1px solid #2b2f35`, radius 9px, background `#1c1f23`), one row per question in the order asked, `padding:14px 16px`, split by `border-bottom:1px solid #23262b`, no border on the last. Row is a flex row, `gap:14px`, `align-items:flex-start`:
   - Timestamp column, `width:40px`, `flex:none`: "08:12" in 500 10.5px monospace `#8d8880`.
   - Middle, `flex:1`: question text 400 15.5px/1.4 Helvetica `#e6e3dd`, `text-wrap:pretty`; below it `margin-top:6px` a sub-line 400 12.5px/1.4 `#8d8880` naming what was missed — "Missed: named the actual number · what I'd do differently". When everything was covered the sub-line reads "All 4 points covered" and stays `#8d8880`.
   - Right, `flex:none`, flex row `gap:9px`, `align-items:center`: the same 44×2px progress bar as the live panel (`linear-gradient(90deg, oklch(0.72 0.15 145) X%, #2e3238 X%)` where X is the covered percentage) and a count "3/4" in 500 10.5px monospace `#8d8880`.
   - Unmatched rows — a question that was heard but hit nothing in the bank: the row gets `border-left:2px solid oklch(0.78 0.15 75)` and its `padding-left` drops to 14px to keep the text aligned. Sub-line reads "Not in your bank" in `oklch(0.78 0.15 75)`. The right side replaces the bar with a single action, "Add to bank →", 500 11px Helvetica `#c9c4ba`, which opens the editor prefilled with the question text and the transcript excerpt.
   - Rows are clickable and expand in place to show the transcript for that answer: 400 12px/1.5 monospace `#8d8880`, `margin-top:11px`, `text-wrap:pretty`, `you:` / `them:` prefixes preserved, the matched phrase highlighted `#eceae5` on `#2b2f35`, `padding:1px 3px`, radius 3px — same treatment as the live transcript footer. Expansion animates height over ~200ms ease-out. If the transcript wasn't kept, the row doesn't expand and the sub-line gets a trailing "· transcript off".

3. WORTH FIXING — the point of the screen. Up to four cards, `gap:10px`, column. Each: `1px solid #2b2f35`, radius 9px, background `#1c1f23`, `padding:13px 14px`, flex row `space-between`, `align-items:center`. Left: title 500 14px `#f4f2ee`, why-line 400 12.5px/1.4 `#8d8880`, `margin-top:5px`. Right: action chip 500 11px `#c9c4ba` on `#2b2f35`, `padding:6px 9px`, radius 5px. These are generated from the session (the screen just renders `fixes` from props):
   - A question wasn't in the bank → "Draft an answer from what I said" → chip "Draft it".
   - A point on a matched answer never got covered → "You never said the 18% figure" / "It's on the card but it didn't make it out loud" → chip "Open answer".
   - An answer ran long (over ~2:30 of mic time on one entry) → "Checkout redesign ran 2:40" / "Trim it to the two metrics that landed" → chip "Edit story".
   - The matcher was overridden via ⌘K → "You pulled this one up by hand" / "Add the phrase they actually used as a trigger" → chip "Add trigger".

When the session produces none of these, the group collapses to a single line in 400 13.5px/1.4 `#a8a39b`: "Nothing to fix — every question matched and every point landed."

Below the last group, the privacy line, 400 12px/1.5 `#8d8880`: "Transcript is on this machine only. Deleting the session removes it."

Footer — `margin-top:auto`, `padding-top:18px`, `border-top:1px solid #21242a`, `space-between`: left, shortcut list `gap:20px`, 500 11.5px `#8d8880` — "⌘E export as notes", "⌘⌫ delete session"; right "Practice the 3 I missed →" in `#c9c4ba`, which opens the bank filtered to those entries.
