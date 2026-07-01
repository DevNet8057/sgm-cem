import { Server as SocketIOServer } from 'socket.io'
import type { Server as HttpServer } from 'http'
import jwt from 'jsonwebtoken'
import { getJwtSecret } from './security'

interface JwtPayload {
  userId: string
  role: string
  email: string
}

let io: SocketIOServer | null = null

export function initSocketIO(server: HttpServer): SocketIOServer {
  const allowedOrigins = (process.env.APP_URL ?? 'http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

  io = new SocketIOServer(server, {
    cors: { origin: allowedOrigins, credentials: true },
    path: '/socket.io',
  })

  // Verify JWT from access_token HttpOnly cookie in the upgrade request
  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? ''
      const tokenEntry = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('access_token='))
      const token = tokenEntry ? decodeURIComponent(tokenEntry.slice('access_token='.length)) : undefined

      if (!token) { next(new Error('Authentication required')); return }

      const payload = jwt.verify(token, getJwtSecret()) as JwtPayload
      socket.data.user = payload
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as JwtPayload
    socket.join(`user:${user.userId}`)
    socket.join(`role:${user.role}`)
  })

  return io
}

export function broadcastToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data)
}

export function broadcastToRole(role: string, event: string, data: unknown): void {
  io?.to(`role:${role}`).emit(event, data)
}

export function broadcastToAll(event: string, data: unknown): void {
  io?.emit(event, data)
}
