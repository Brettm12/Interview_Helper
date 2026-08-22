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

import { api } from './api'

export interface AudioDevice {
  deviceId: string
  label: string
}

/** virtual audio cables (macOS) and monitor sources (Linux — PulseAudio and
 *  PipeWire expose each output as an input named "Monitor of …"), which is
 *  what "system audio" has to be routed through off Windows. Matching is by
 *  name because there is no other signal — the Web Audio API cannot tell a
 *  loopback device from a real microphone. */
const LOOPBACK_NAMES = /blackhole|loopback|soundflower|vb-?(audio|cable)|virtual|aggregate|multi-output|monitor of/i

export function looksLikeLoopback(label: string): boolean {
  return LOOPBACK_NAMES.test(label)
}

/** the fix for "no system audio" is different on every OS — naming the wrong
 *  one sends the user hunting for BlackHole on Windows (REVIEW.md M21) */
export function loopbackGuidance(platform = api.env.platform): string {
  switch (platform) {
    case 'darwin':
      return 'macOS cannot capture system audio directly. Install a loopback device (BlackHole), route the meeting output through it, and pick it as the meeting input below.'
    case 'linux':
      return 'pick your system’s monitor source as the meeting input below — PulseAudio/PipeWire expose one per output, named "Monitor of …".'
    case 'win32':
      return 'Windows normally captures system audio directly — check that the meeting is audible and try again, or route it through a virtual cable (VB-Audio) and pick it below.'
    default:
      return 'route the meeting through a loopback device and pick it as the meeting input below.'
  }
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
