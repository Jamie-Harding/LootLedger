// packages/electron-main/src/auth/loopback.ts
import http from 'node:http'
import { URL } from 'node:url'

export function startLoopbackServer(
  onCode: (code: string, state?: string) => void,
  port = Number(process.env.OAUTH_LOOPBACK_PORT ?? '8802'),
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (!req.url) return
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code') || ''
      const state = url.searchParams.get('state') || undefined
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        '<html><body>Login complete. You can close this window.</body></html>',
      )
      onCode(code, state)
    } else {
      res.statusCode = 404
      res.end()
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', (err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)))
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port })
    })
  })
}
