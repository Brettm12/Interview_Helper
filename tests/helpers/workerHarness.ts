import { vi } from 'vitest'

// Loads a web-worker module (src/renderer/src/workers/*) in node by shimming
// the worker global scope, so its message protocol is testable without a
// browser. The module's `self.onmessage = …` assignment is captured and every
// `postMessage` it makes is recorded.
//
// One harness per load; `vi.resetModules()` lets the same worker module be
// re-evaluated with fresh module state in a later load.

export interface WorkerHarness {
  /** dispatch a message to the worker's onmessage handler and await it */
  send(msg: unknown): Promise<void>
  /** every message the worker posted, in order */
  posted: unknown[]
  /** wait until a posted message satisfies the predicate (or time out) */
  waitFor<T = unknown>(pred: (m: T) => boolean, timeoutMs?: number): Promise<T>
}

interface WorkerSelfShim {
  onmessage: ((e: { data: unknown }) => unknown) | null
  postMessage(msg: unknown): void
  location: { href: string }
}

export async function loadWorker(importer: () => Promise<unknown>): Promise<WorkerHarness> {
  vi.resetModules()
  const posted: unknown[] = []
  const shim: WorkerSelfShim = {
    onmessage: null,
    postMessage: (msg) => posted.push(msg),
    location: { href: 'lih-test://worker/' }
  }
  const g = globalThis as { self?: unknown }
  const prev = g.self
  g.self = shim
  try {
    await importer()
  } finally {
    // the module captured `self` at evaluation time; restore the global so
    // parallel test files aren't affected
    g.self = prev
  }
  const handler = shim.onmessage
  if (!handler) throw new Error('worker module did not set self.onmessage')

  return {
    posted,
    async send(msg: unknown): Promise<void> {
      await handler.call(shim, { data: msg })
    },
    async waitFor<T>(pred: (m: T) => boolean, timeoutMs = 5000): Promise<T> {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const hit = posted.find((m) => pred(m as T))
        if (hit !== undefined) return hit as T
        if (Date.now() > deadline) {
          throw new Error(`worker never posted the expected message; saw: ${JSON.stringify(posted)}`)
        }
        await new Promise((r) => setTimeout(r, 10))
      }
    }
  }
}
