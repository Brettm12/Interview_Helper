// Audio input device discovery.
//
// Two things depend on this. The obvious one: if your default input silently
// switches to a Bluetooth headset running 8kHz narrowband, nothing in the app
// would tell you — the label is the only clue you'd get.
//
// The less obvious one is the meeting side. Electron's loopback capture is
// Windows-only, so on macOS the meeting audio has to arrive as an ordinary
// *input* device fed by a virtual cable (BlackHole, Loopback, Soundflower).
// Finding those in the list is what makes the meeting side work at all there.

export interface AudioDevice {
  deviceId: string
  label: string
}

/** virtual audio cables, which is what "system audio" has to be routed
 *  through on macOS. Matching is by name because there is no other signal —
 *  the Web Audio API cannot tell a loopback device from a real microphone. */
const LOOPBACK_NAMES = /blackhole|loopback|soundflower|vb-?(audio|cable)|virtual|aggregate|multi-output/i

export function looksLikeLoopback(label: string): boolean {
  return LOOPBACK_NAMES.test(label)
}

/**
 * Every audio input, with a usable name.
 *
 * Labels are empty until microphone permission has been granted — that's a
 * privacy rule in the browser engine, not a bug — so callers should refresh
 * after permission changes rather than caching the first, nameless answer.
 */
export async function listInputDevices(): Promise<AudioDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []
  const all = await navigator.mediaDevices.enumerateDevices()
  return all
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Input ${i + 1}`
    }))
}

/** watch for devices appearing and disappearing — plugging in a headset
 *  mid-setup should not require a restart */
export function onDeviceChange(cb: () => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => {}
  navigator.mediaDevices.addEventListener('devicechange', cb)
  return () => navigator.mediaDevices.removeEventListener('devicechange', cb)
}

/** the best guess at which device carries the meeting, for the first-run
 *  nudge on macOS. Returns null when nothing looks like a virtual cable. */
export function suggestLoopback(devices: AudioDevice[]): AudioDevice | null {
  return devices.find((d) => looksLikeLoopback(d.label)) ?? null
}
