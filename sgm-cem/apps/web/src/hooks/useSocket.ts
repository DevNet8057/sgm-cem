'use client'
import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'

// Strip the /api path suffix — Socket.IO attaches to the root HTTP server
const SOCKET_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/api\/?$/, '')

export function useSocket(): void {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const queryClient = useQueryClient()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.disconnect()
      socketRef.current = null
      return
    }

    if (socketRef.current?.connected) return

    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
      reconnectionAttempts: 5,
    })

    socketRef.current = socket

    const invalidateContributions = () => {
      void queryClient.invalidateQueries({ queryKey: ['contributions'] })
      void queryClient.invalidateQueries({ queryKey: ['validations'] })
      void queryClient.invalidateQueries({ queryKey: ['litiges'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
    }

    socket.on('contribution:confirmed', invalidateContributions)
    socket.on('contribution:litige', invalidateContributions)
    socket.on('contribution:resolved', invalidateContributions)
    socket.on('notification:new', () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [isAuthenticated, queryClient])
}
