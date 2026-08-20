// Renders build/icon.png from the app's own design tokens: the panel
// background, the listening-green dot, and a short points list with the
// covered ones struck through — the thing you actually glance at mid-answer.
// electron-builder converts this single PNG to .icns / .ico at package time.
//   node build/make-icon.mjs
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))

/** oklch → sRGB hex, so the icon green is exactly the app's status/live token */
function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
  const enc = (u) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(v * 255)))
  }
  return '#' + lin.map(enc).map((n) => n.toString(16).padStart(2, '0')).join('')
}

const GREEN = oklchToHex(0.72, 0.15, 145) // --status-live
const PANEL = '#16181b' // --bg-panel
const BORDER = '#2b2f35' // --border-mid
const BODY = '#e6e3dd' // --text-body
const DIM = '#4f545b' // --dot-inactive

// --- geometry, all measured from the panel box (this is the bit that has to
// stay inside the rounded square, not the full canvas) ---
const S = 1024
const PAD = 132 // macOS icons sit inset in their canvas
const PANEL_X = PAD
const PANEL_W = S - PAD * 2
const GUTTER = 86 // padding inside the panel
const LEFT = PANEL_X + GUTTER
const RIGHT = PANEL_X + PANEL_W - GUTTER
const DOT_R = 25
const BAR_H = 44
const BAR_X = LEFT + DOT_R * 2 + 42
const BAR_MAX = RIGHT - BAR_X

// header: the listening dot + the covered-progress rail. The +30 centres the
// whole group (header + three rows) vertically inside the panel.
const HEAD_Y = PANEL_X + 118 + 30
// three point rows, generously spaced so they survive a 32px dock icon
const ROWS = [
  { y: HEAD_Y + 168, covered: true, w: 0.96 },
  { y: HEAD_Y + 316, covered: true, w: 0.78 },
  { y: HEAD_Y + 464, covered: false, w: 0.9 }
]

const rows = ROWS.map(({ y, covered, w }) => {
  const barW = Math.round(BAR_MAX * w)
  const fill = covered ? BODY : BODY
  const opacity = covered ? 0.3 : 1
  const strike = covered
    ? `<rect x="${BAR_X - 14}" y="${y - 5}" width="${barW + 28}" height="10" rx="5" fill="${BODY}" opacity="0.9"/>`
    : ''
  return `
    <circle cx="${LEFT + DOT_R}" cy="${y}" r="${DOT_R}" fill="${covered ? GREEN : GREEN}" opacity="${covered ? 0.35 : 1}"/>
    <rect x="${BAR_X}" y="${y - BAR_H / 2}" width="${barW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${fill}" opacity="${opacity}"/>
    ${strike}`
}).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect x="${PANEL_X}" y="${PANEL_X}" width="${PANEL_W}" height="${PANEL_W}" rx="196" fill="${PANEL}"/>
  <rect x="${PANEL_X + 2}" y="${PANEL_X + 2}" width="${PANEL_W - 4}" height="${PANEL_W - 4}" rx="194"
        fill="none" stroke="${BORDER}" stroke-width="4"/>

  <!-- header: listening dot + covered-progress rail -->
  <circle cx="${LEFT + DOT_R}" cy="${HEAD_Y}" r="${DOT_R + 7}" fill="${GREEN}"/>
  <rect x="${BAR_X}" y="${HEAD_Y - 7}" width="${Math.round(BAR_MAX * 0.52)}" height="14" rx="7" fill="${GREEN}"/>
  <rect x="${BAR_X + Math.round(BAR_MAX * 0.52)}" y="${HEAD_Y - 7}"
        width="${BAR_MAX - Math.round(BAR_MAX * 0.52)}" height="14" rx="7" fill="${DIM}" opacity="0.6"/>

  <g>${rows}</g>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(join(here, 'icon.png'))
console.log(`build/icon.png written (${S}×${S}), listening green = ${GREEN}`)
console.log(`panel ${PANEL_X}..${PANEL_X + PANEL_W}, content ${LEFT}..${RIGHT}`)
