// onnxruntime-web resolves its .wasm binaries from `wasmPaths` — and its
// default is a CDN URL, which quietly broke the offline promise: the first
// pipeline() on a machine without internet hung and died trying to reach
// jsdelivr (REVIEW.md C2). These four imports make the binaries part of the
// build, and every worker points the runtime at the bundled copies before
// constructing a pipeline.
import ortWasmUrl from '@xenova/transformers/dist/ort-wasm.wasm?url'
import ortWasmSimdUrl from '@xenova/transformers/dist/ort-wasm-simd.wasm?url'
import ortWasmThreadedUrl from '@xenova/transformers/dist/ort-wasm-threaded.wasm?url'
import ortWasmSimdThreadedUrl from '@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url'

/**
 * URL map for `env.backends.onnx.wasm.wasmPaths`, keyed by the exact file
 * names the runtime asks for. In dev and in the browser build the vite asset
 * URLs are fetchable as-is; in the packaged app the worker runs from file://
 * where fetch() can't reach them, so those are rewritten onto the privileged
 * lih-models://wasm/ root that main serves from the same assets directory.
 */
export function localWasmPaths(): Record<string, string> {
  const local = (assetUrl: string): string => {
    const abs = new URL(assetUrl, self.location.href)
    if (abs.protocol === 'file:') {
      const base = abs.pathname.split('/').pop() ?? ''
      return `lih-models://wasm/${base}`
    }
    return abs.toString()
  }
  return {
    'ort-wasm.wasm': local(ortWasmUrl),
    'ort-wasm-simd.wasm': local(ortWasmSimdUrl),
    'ort-wasm-threaded.wasm': local(ortWasmThreadedUrl),
    'ort-wasm-simd-threaded.wasm': local(ortWasmSimdThreadedUrl)
  }
}
