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
 *  npx sometimes stalls for minutes on registry checks behind a proxy.
 *
 *  Vite is also pinned to 127.0.0.1. Its default host is `localhost`, which
 *  on a dual-stack machine resolves to ::1 first — so it bound IPv6 while
 *  this poll (and every URL we hand the browser) used IPv4, and the wait
 *  timed out every single time on the CI runner while passing here, where
 *  `localhost` is IPv4-only. */
export async function spawnServer(command, args, port, { env } = {}) {
  if (command === 'npx' && args[0] === 'vite') {
    command = process.execPath
    args = [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), ...args.slice(1)]
  }
  if (args.some((a) => a.endsWith('vite.js')) && !args.some((a) => a.startsWith('--host'))) {
    args = [...args, '--host', '127.0.0.1']
  }
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  })
  // keep the tail of what the child said, so a failure to start says WHY
  // rather than only that it didn't
  const noise = []
  const note = (buf) => {
    noise.push(String(buf))
    if (noise.length > 40) noise.splice(0, noise.length - 40)
  }
  child.stdout?.on('data', note)
  child.stderr?.on('data', note)

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
  const said = noise.join('').trim()
  throw new Error(
    `server on :${port} never came up (${command} ${args.join(' ')})` +
      (said ? `\n--- last output from the server ---\n${said}` : '\n(the server printed nothing)')
  )
}

export async function launchBrowser() {
  const { chromium } = await import('playwright')
  const preinstalled = '/opt/pw-browsers/chromium'
  const executablePath =
    process.env.CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined)
  return chromium.launch({ executablePath })
}
