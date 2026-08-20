# Build conventions (screens)

Read this before writing any screen component.

## Ground rules

- **Pixel-accurate to the reference HTML.** Every value (font size/weight/line-height, padding, gap, color, radius, border) is inline on the reference markup in `docs/reference/*.html` — copy those values, do not eyeball or improvise. Where the handoff README prose and the HTML differ, **the HTML wins**.
- Plain CSS, one `.css` file next to each screen component. No Tailwind, no CSS-in-JS, no component libraries.
- Use the CSS custom properties from `src/renderer/src/styles/tokens.css` for every color/font/shadow that has a token. Hard-code a hex only if it genuinely has no token (then add a comment).
- Shared micro-classes live in `src/renderer/src/styles/base.css` (`.label`, `.chip`, `.metric-chip`, `.cta`, `.action`, `.footer-hint`, `.pretty`, `.caret`) and shared atoms in `src/renderer/src/components/primitives.tsx` (`StatusDot`, `Label`, `ProgressBar`, `AutoPickBar`, `LevelMeter`, `StatCard`, `StoryCard`, `PointRow`, `PhraseChip`). **Use them** instead of re-implementing; if a primitive is slightly off for your screen, extend it via props in place (keep it backward compatible) rather than forking.
- Class naming: BEM-ish, prefixed by screen (`.live-`, `.find-`, `.strip-`, `.bank-`, `.editor-`, `.setup-`, `.armed-`, `.recap-`).
- Components are **presentational only**: props in, callbacks out, typed exactly against the interfaces in `src/renderer/src/screens/contracts.ts`. No zustand, no `window.api`, no timers except purely visual animation. Export the component as the **default export**, typed `(props: XProps) => JSX.Element`.
- Screens fill their window: root element `width:100%; height:100%` (the window itself provides the reference frame size). Never hard-code the reference frame's outer width/height inside the screen — the demo gallery provides the frame.
- No icons: glyphs are text characters `✓ → ⠿ ▾ × ↑↓ ↵ ⌘ ⇧`.
- Fonts via tokens: `var(--font-serif)` (Instrument Serif), `var(--font-ui)` (Helvetica Neue stack), `var(--font-mono)` (JetBrains Mono). Use the CSS `font:` shorthand like the reference does, e.g. `font: 500 9.5px/1 var(--font-mono)`.
- Do **not** build the `dv-*` review chrome (badges, card frames, labels) from the reference files — only the design inside `.dv-card`.

## Motion

- Question swap: quick crossfade, no layout jump; animate container height (~200ms ease-out) since question text height varies.
- Point state changes: opacity + strike-through over ~200ms ease-out (already wired in `PointRow`'s CSS).
- Nothing flashes, bounces, or slides in from an edge.

## Interaction affordances

Anything the contract exposes a callback for gets `cursor:pointer` (buttons/rows/chips) — but keep default cursor on plain text. Hover states are not in the design; do not invent them beyond `cursor`.

## Text inputs

Real `<input>`/`<textarea>` (autosized) styled to the reference values. The reference shows a fake caret (`|` at opacity .55) — that is the *mock's* stand-in for a real caret; use a real caret (`caret-color: #f4f2ee`) in inputs. Focused states use the exact focused styles from the reference (border `var(--border-strong)`, etc.).
