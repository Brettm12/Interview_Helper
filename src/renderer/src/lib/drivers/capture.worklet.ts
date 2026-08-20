// AudioWorkletProcessor: accumulates 128-frame process() quanta into ~2048-
// sample Float32 blocks and posts them (transferred) to the node. No
// downsampling here — that stays in the source so the DSP lives in one
// testable place. Runs on the audio rendering thread; never blocks the UI.

// the AudioWorklet global scope isn't in lib.dom — declare what we use
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor
): void

const BLOCK_SIZE = 2048

class CaptureProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(BLOCK_SIZE)
  private offset = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true // keep alive through source gaps
    let read = 0
    while (read < channel.length) {
      const take = Math.min(channel.length - read, BLOCK_SIZE - this.offset)
      this.buffer.set(channel.subarray(read, read + take), this.offset)
      this.offset += take
      read += take
      if (this.offset === BLOCK_SIZE) {
        const block = this.buffer
        this.port.postMessage(block, [block.buffer])
        this.buffer = new Float32Array(BLOCK_SIZE)
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('capture', CaptureProcessor)

export {}
