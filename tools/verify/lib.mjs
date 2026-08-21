// Shared plumbing for the verification scripts: repo paths, a tiny static
// file server (no dependency), child-process servers, and browser launch.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

export const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'))
export const outDir = join(repoRoot, 'tools', 'verify', '.out')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

/** static file server over a directory; resolves once listening */
export function serveStatic(root, port) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const file = normalize(join(root, path))
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

/** spawn an npm-resolved CLI and wait for its port to accept connections.
 *  `npx <tool>` is rewritten to run the local bin under the current node —
 *  npx sometimes stalls for minutes on registry checks behind a proxy. */
export async function spawnServer(command, args, port, { env } = {}) {
  if (command === 'npx' && args[0] === 'vite') {
    command = process.execPath
    args = [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), ...args.slice(1)]
  }
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
      if (res.status < 500) return child
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  child.kill()
  throw new Error(`server on :${port} never came up (${command} ${args.join(' ')})`)
}

export async function launchBrowser() {
  const { chromium } = await import('playwright')
  const preinstalled = '/opt/pw-browsers/chromium'
  const executablePath =
    process.env.CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined)
  return chromium.launch({ executablePath })
}
