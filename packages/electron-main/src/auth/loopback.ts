import http from 'http'
import { URL } from 'url'

export type LoopbackOptions = { port?: number }
export function startLoopbackServer(
  onCode: (code: string, state?: string) => void,
  opts: LoopbackOptions = {},
) {
  const server = http.createServer((req, res) => {
    if (!req.url) return
    const url = new URL(req.url, 'http://localhost')
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
  return new Promise<{ server: http.Server; port: number }>(
    (resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string')
          return reject(new Error('no address'))
        resolve({ server, port: address.port })
      })
    },
  )
}
