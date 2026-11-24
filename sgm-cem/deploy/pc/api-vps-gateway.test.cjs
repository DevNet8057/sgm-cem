'use strict'

// Aucun accès distant : l'API et le tunnel sont remplacés par un serveur loopback.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { createGateway } = require('./api-vps-gateway.cjs')

let upstream
let gateway
let port
let hits = 0
const sockets = new Set()
const PUBLIC_ORIGIN = 'https://sgm-cem.16-16-63-155.sslip.io'

before(async () => {
  upstream = http.createServer((req, res) => {
    hits++
    let body = ''
    req.on('data', part => { body += part })
    req.on('end', () => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': PUBLIC_ORIGIN,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,x-csrf-token',
        'set-cookie': ['access_token=faux; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.example.invalid',
          'csrf_token=faux; Secure; SameSite=Strict; Path=/'],
      })
      res.end(JSON.stringify({ headers: req.headers, path: req.url, method: req.method, body }))
    })
  })
  upstream.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.host, new URL(PUBLIC_ORIGIN).host)
    assert.equal(req.headers.origin, PUBLIC_ORIGIN)
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    if (head.length) socket.write(head)
    socket.on('data', part => socket.write(part))
    socket.on('error', () => {})
    socket.on('end', () => socket.end())
  })
  upstream.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  upstream.listen(13002, '127.0.0.1')
  await once(upstream, 'listening')
  gateway = createGateway()
  gateway.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  gateway.listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  port = gateway.address().port
})

after(async () => {
  for (const socket of sockets) socket.destroy()
  for (const server of [gateway, upstream]) {
    if (!server?.listening) continue
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

function request({ origin = 'http://localhost:3000', host = 'localhost:13001', path = '/api/health', method = 'GET', body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host, 'x-forwarded-for': 'fake', 'x-real-ip': 'fake', cookie: 'csrf_token=faux', 'x-csrf-token': 'faux' }
    if (origin !== null) headers.origin = origin
    const req = http.request({ hostname: '127.0.0.1', port, headers, path, method }, res => {
      let data = ''
      res.on('data', part => { data += part })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('transmet corps, cookies et CSRF ; réécrit Host, Origin, CORS sans affaiblir HttpOnly/SameSite', async () => {
  const response = await request({ method: 'POST', path: '/api/example?test=1', body: '{"fictif":true}' })
  assert.equal(response.status, 200)
  const sent = JSON.parse(response.data)
  assert.equal(sent.headers.host, new URL(PUBLIC_ORIGIN).host)
  assert.equal(sent.headers.origin, PUBLIC_ORIGIN)
  assert.equal(sent.headers['x-forwarded-for'], undefined)
  assert.equal(sent.headers['x-real-ip'], undefined)
  assert.equal(sent.headers.cookie, 'csrf_token=faux')
  assert.equal(sent.headers['x-csrf-token'], 'faux')
  assert.equal(sent.path, '/api/example?test=1')
  assert.equal(sent.body, '{"fictif":true}')
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000')
  assert.equal(response.headers['access-control-allow-credentials'], 'true')
  assert.match(response.headers.vary, /Origin/)
  assert.match(response.headers['set-cookie'][0], /HttpOnly/)
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/)
  assert.match(response.headers['set-cookie'][1], /SameSite=Strict/)
  assert.doesNotMatch(response.headers['set-cookie'].join(';'), /(?:Secure|Domain=)/i)
})

test('prévol autorisé pour la deuxième origine locale', async () => {
  const response = await request({ method: 'OPTIONS', origin: 'http://127.0.0.1:3000' })
  assert.equal(response.status, 200)
  assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:3000')
  assert.match(response.headers['access-control-allow-headers'], /x-csrf-token/)
})

test('refuse autres origines, Host et cibles absolues avant de contacter la destination', async () => {
  const previous = hits
  for (const input of [{ origin: 'https://evil.invalid' }, { origin: 'null' },
    { origin: 'http://localhost:3000.evil.invalid' }, { host: 'evil.invalid:13001' },
    { path: 'http://evil.invalid/' }, { path: '//evil.invalid/' }]) {
    assert.equal((await request(input)).status, 403)
  }
  assert.equal(hits, previous)
})

test('permet outils sans Origin et conserve une réponse sans autorisation CORS', async () => {
  const response = await request({ origin: null, host: '127.0.0.1:13001' })
  assert.equal(response.status, 200)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
})

test('transporte un upgrade WebSocket dans les deux sens et ferme les connexions', { timeout: 3000 }, async () => {
  await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/socket.io/?transport=websocket',
      headers: { host: 'localhost:13001', origin: 'http://localhost:3000', connection: 'Upgrade', upgrade: 'websocket' } })
    req.on('error', reject)
    req.on('upgrade', (_response, socket) => {
      socket.once('data', data => {
        try { assert.equal(data.toString(), 'message-fictif'); socket.destroy(); resolve() }
        catch (error) { socket.destroy(); reject(error) }
      })
      socket.on('error', reject)
      socket.write('message-fictif')
    })
    req.end()
  })
})

test('refuse un upgrade WebSocket avec origine externe', { timeout: 3000 }, async () => {
  await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/socket.io/',
      headers: { host: 'localhost:13001', origin: 'https://evil.invalid', connection: 'Upgrade', upgrade: 'websocket' } })
    req.on('error', reject)
    req.on('response', res => { res.resume(); assert.equal(res.statusCode, 403); resolve() })
    req.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Upgrade externe accepté')) })
    req.end()
  })
})

test('le port frontend personnalisé limite les origines à ce seul port', async () => {
  const alternate = createGateway({ webPort: 3005 })
  alternate.listen(0, '127.0.0.1')
  await once(alternate, 'listening')
  try {
    for (const [origin, expected] of [['http://localhost:3005', 200], ['http://127.0.0.1:3005', 200], ['http://localhost:3000', 403]]) {
      await new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port: alternate.address().port,
          headers: { host: 'localhost:13001', origin } }, res => {
          res.resume()
          try { assert.equal(res.statusCode, expected); resolve() } catch (error) { reject(error) }
        })
        req.on('error', reject)
      })
    }
  } finally {
    alternate.closeAllConnections()
    await new Promise(resolve => alternate.close(resolve))
  }
})

test('refuse un port frontend invalide ou en conflit avec la passerelle', () => {
  for (const webPort of [0, 65536, 13001, 13002, '3005', 3005.5]) {
    assert.throws(() => createGateway({ webPort }), /invalide/)
  }
})
