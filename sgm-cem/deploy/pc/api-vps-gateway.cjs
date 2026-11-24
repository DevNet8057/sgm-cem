'use strict'

// Passerelle de développement exclusivement locale, à destination fixe via SSH.
const http = require('node:http')
const { isIP } = require('node:net')

const PUBLIC_ORIGIN = 'https://sgm-cem.16-16-63-155.sslip.io'
const PUBLIC_HOST = new URL(PUBLIC_ORIGIN).host
const LOCAL_PORT = 13001
const UPSTREAM_PORT = 13002
const HOSTS = new Set([`localhost:${LOCAL_PORT}`, `127.0.0.1:${LOCAL_PORT}`])
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade']

function permitted(req, origins) {
  return HOSTS.has(req.headers.host)
    && (!req.headers.origin || origins.has(req.headers.origin))
    && typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//')
}

function cleanHeaders(input) {
  const headers = { ...input }
  const named = String(headers.connection || '').split(',').map(value => value.trim().toLowerCase())
  for (const name of [...HOP_HEADERS, ...named]) delete headers[name]
  return headers
}

function requestHeaders(req, upgrade = false) {
  const headers = cleanHeaders(req.headers)
  for (const name of Object.keys(headers)) {
    if (name.startsWith('x-forwarded-') || name === 'forwarded' || name === 'x-real-ip') delete headers[name]
  }
  headers.host = PUBLIC_HOST
  headers.origin = PUBLIC_ORIGIN
  headers['x-forwarded-host'] = PUBLIC_HOST
  headers['x-forwarded-proto'] = 'https'
  if (upgrade) {
    headers.connection = 'Upgrade'
    headers.upgrade = 'websocket'
  }
  return headers
}

function responseHeaders(headers, origin) {
  const result = cleanHeaders(headers)
  delete result['access-control-allow-origin']
  delete result['access-control-allow-credentials']
  if (origin) {
    result['access-control-allow-origin'] = origin
    result['access-control-allow-credentials'] = 'true'
  }
  const vary = new Set(String(result.vary || '').split(',').map(item => item.trim()).filter(Boolean))
  vary.add('Origin')
  result.vary = [...vary].join(', ')
  // HTTP loopback uniquement : garder notamment HttpOnly, SameSite, Path et expiration.
  if (result['set-cookie']) {
    result['set-cookie'] = result['set-cookie'].map(cookie => cookie.split(';')
      .filter((part, index) => index === 0 || !/^\s*(secure\s*$|domain\s*=)/i.test(part)).join(';'))
  }
  return result
}

function refusal(res) {
  res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end('Accès réservé au développement local autorisé.\n')
}

function createGateway({ webPort = 3000 } = {}) {
  if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535 || [LOCAL_PORT, UPSTREAM_PORT].includes(webPort)) {
    throw new Error('Port frontend local invalide.')
  }
  const origins = new Set([`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`])
  const server = http.createServer((req, res) => {
    if (!permitted(req, origins)) return refusal(res)
    const upstream = http.request({ hostname: '127.0.0.1', port: UPSTREAM_PORT,
      method: req.method, path: req.url, headers: requestHeaders(req) }, remote => {
      res.writeHead(remote.statusCode, responseHeaders(remote.headers, req.headers.origin))
      remote.on('error', () => res.destroy())
      remote.pipe(res)
    })
    upstream.setTimeout(120000, () => upstream.destroy())
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy()
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('API indisponible : vérifier le tunnel SSH et la connexion réseau.\n')
    })
    req.on('aborted', () => upstream.destroy())
    req.on('error', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })

  server.on('upgrade', (req, socket, head) => {
    if (!permitted(req, origins) || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: UPSTREAM_PORT,
      method: req.method, path: req.url, headers: requestHeaders(req, true) })
    upstream.setTimeout(15000, () => upstream.destroy())
    upstream.on('upgrade', (remote, remoteSocket, remoteHead) => {
      upstream.setTimeout(0)
      const headers = responseHeaders(remote.headers, req.headers.origin)
      headers.connection = 'Upgrade'
      headers.upgrade = 'websocket'
      const lines = ['HTTP/1.1 101 Switching Protocols']
      for (const [key, value] of Object.entries(headers)) {
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${item}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remoteSocket.write(head)
      remoteSocket.on('error', () => socket.destroy())
      socket.on('error', () => remoteSocket.destroy())
      socket.on('close', () => remoteSocket.destroy())
      remoteSocket.on('close', () => socket.destroy())
      socket.pipe(remoteSocket).pipe(socket)
    })
    upstream.on('response', remote => {
      remote.resume()
      socket.end(`HTTP/1.1 ${remote.statusCode} Upstream refused upgrade\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  })
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'))
  return server
}

if (require.main === module) {
  // Aucune option de cible ou de bind externe : ce fichier ne constitue pas un proxy ouvert.
  const address = '127.0.0.1'
  if (isIP(address) !== 4) throw new Error('Adresse locale incorrecte')
  const configuredPort = process.env.SGM_LOCAL_WEB_PORT ?? '3000'
  if (!/^\d{4,5}$/.test(configuredPort)) throw new Error('SGM_LOCAL_WEB_PORT doit contenir un port numérique local.')
  const server = createGateway({ webPort: Number(configuredPort) })
  server.on('error', () => {
    console.error('Passerelle non démarrée : vérifier que le port local 13001 est disponible.')
    process.exitCode = 1
  })
  server.listen(LOCAL_PORT, address, () => console.log('Passerelle locale prête sur http://localhost:13001'))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()))
}

module.exports = { createGateway }
