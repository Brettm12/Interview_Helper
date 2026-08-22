import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The app ships onnxruntime's WebAssembly runtime as a build asset, because
// the library's default is a CDN and that broke the offline promise
// (REVIEW.md C2). Those binaries come from `onnxruntime-web`, which is a
// direct dependency ONLY so the files can be imported — the JavaScript that
// loads them comes from transformers.js's own copy.
//
// So the two have to be the same version. A binary from a different runtime
// than the JS expects is not a build error and not a type error: it is a
// session that fails to create at load time, on the user's machine, offline,
// with the interview about to start.

const read = (p: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(resolve(__dirname, '..', p), 'utf8'))

describe('the inference stack pins itself together', () => {
  const pkg = read('package.json')
  const transformers = read('node_modules/@huggingface/transformers/package.json')

  it('ships the exact onnxruntime-web that transformers.js loads', () => {
    const ours = pkg.devDependencies?.['onnxruntime-web']
    const theirs = transformers.dependencies?.['onnxruntime-web']
    expect(ours, 'onnxruntime-web must be a direct devDependency').toBeTruthy()
    expect(ours, 'pin it exactly — a range would drift from the JS silently').not.toMatch(/[\^~]/)
    expect(ours).toBe(theirs)
  })

  it('keeps the runtime out of the shipped dependency tree', () => {
    // both are bundled into the renderer at build time; listing them as
    // runtime dependencies would drag them (and sharp) into the packaged app
    expect(pkg.dependencies?.['@huggingface/transformers']).toBeUndefined()
    expect(pkg.dependencies?.['onnxruntime-web']).toBeUndefined()
  })
})
