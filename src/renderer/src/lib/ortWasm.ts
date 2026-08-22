// onnxruntime-web resolves its WebAssembly runtime from `wasmPaths` — and its
// default is a CDN URL, which quietly broke the offline promise: the first
// pipeline() on a machine without internet hung and died trying to reach
// jsdelivr (REVIEW.md C2). These two imports make the runtime part of the
// build, and every worker points ORT at the bundled copies before constructing
// a pipeline.
//
// Two files now, not four. ORT 1.14 shipped a matrix of builds (plain, SIMD,
// threaded, SIMD+threaded, ~38MB) and picked one by feature detection; ORT
// 1.22 ships one CPU build that degrades internally — no SharedArrayBuffer
// means one thread rather than a different binary. We import that one (11MB)
// and its loader. transformers.js statically references the WebGPU (jsep)
// build as well, so vite emits that too and the package carries ~33MB of
// runtime rather than 38MB. The extra copy is unused: wasmPaths below points
// at the CPU pair, and nothing here asks for WebGPU.
//
// The .mjs is the loader glue ORT fetches alongside the binary; it is imported
// `?url` rather than as a module on purpose, because ORT wants a URL to load
// itself, not an import graph.
import ortWasmUrl from '@ort-wasm/ort-wasm-simd-threaded.wasm?url'
import ortLoaderUrl from '@ort-wasm/ort-wasm-simd-threaded.mjs?url'

/**
 * `env.backends.onnx.wasm.wasmPaths`, in the shape ORT 1.22 wants: the binary
 * and its loader, named explicitly. (ORT 1.14 wanted a map keyed by every
 * possible filename; that map is what the four old imports were for.)
 *
 * In dev and in the browser build the vite asset URLs are fetchable as-is; in
 * the packaged app the worker runs from file://, where fetch() cannot reach
 * them, so those are rewritten onto the privileged lih-models://wasm/ root
 * that main serves from the same assets directory.
 */
export function localWasmPaths(): { wasm: string; mjs: string } {
  const local = (assetUrl: string): string => {
    const abs = new URL(assetUrl, self.location.href)
    if (abs.protocol === 'file:') {
      const base = abs.pathname.split('/').pop() ?? ''
      return `lih-models://wasm/${base}`
    }
    return abs.toString()
  }
  return { wasm: local(ortWasmUrl), mjs: local(ortLoaderUrl) }
}
