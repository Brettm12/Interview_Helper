import { describe, expect, it } from 'vitest'
import { looksLikeLoopback, suggestLoopback } from '@/lib/devices'

// On macOS the meeting side only works through a virtual audio cable, and the
// setup row names one when it can see it. Naming the wrong device would send
// someone to configure their headset as system audio, so the matching has to
// be conservative about what counts.

describe('looksLikeLoopback', () => {
  it('recognises the cables people actually install', () => {
    for (const name of [
      'BlackHole 2ch',
      'BlackHole 16ch',
      'Loopback Audio',
      'Soundflower (2ch)',
      'VB-Audio Virtual Cable',
      'VB-Cable Input',
      'Multi-Output Device'
    ]) {
      expect(looksLikeLoopback(name), name).toBe(true)
    }
  })

  it('does not mistake a real microphone for one', () => {
    for (const name of [
      'MacBook Pro Microphone',
      'Jabra Evolve2 65',
      'External Microphone',
      'AirPods Pro',
      'Yeti Nano',
      'Default'
    ]) {
      expect(looksLikeLoopback(name), name).toBe(false)
    }
  })
})

describe('suggestLoopback', () => {
  const dev = (label: string): { deviceId: string; label: string } => ({ deviceId: label, label })

  it('picks the virtual cable out of an ordinary device list', () => {
    const found = suggestLoopback([
      dev('MacBook Pro Microphone'),
      dev('AirPods Pro'),
      dev('BlackHole 2ch')
    ])
    expect(found?.label).toBe('BlackHole 2ch')
  })

  it('suggests nothing when nothing qualifies, rather than guessing', () => {
    expect(suggestLoopback([dev('MacBook Pro Microphone'), dev('AirPods Pro')])).toBeNull()
    expect(suggestLoopback([])).toBeNull()
  })
})
