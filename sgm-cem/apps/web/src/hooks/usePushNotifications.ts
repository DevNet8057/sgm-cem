'use client'
// ──────────────────────────────────────────────────────────────────────
// WEB PUSH — abonnement du navigateur aux notifications système
//
// Règle produit : tant que l'utilisateur n'a pas cliqué « Activer »
// (permission 'granted'), l'invite est reproposée À CHAQUE CONNEXION.
// Une fois accordée, l'abonnement est resynchronisé silencieusement à
// chaque chargement (changement de compte, expiration, etc.).
// ──────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied'

// La clé VAPID publique arrive en base64url — PushManager attend un BufferSource
// (ArrayBuffer explicite requis par le typage strict de TS 5.7+)
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

function isSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

async function subscribeAndRegister(): Promise<boolean> {
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    const { data } = await api.get('/notifications/push/public-key')
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.data.publicKey as string),
    })
  }

  // Upsert côté serveur : relie l'abonnement à l'utilisateur COURANT
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await api.post('/notifications/push/subscribe', { endpoint: json.endpoint, keys: json.keys })
  return true
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermission>('unsupported')

  useEffect(() => {
    if (!isSupported()) { setPermission('unsupported'); return }
    setPermission(Notification.permission as PushPermission)

    // Permission déjà accordée → resynchroniser l'abonnement en silence
    if (Notification.permission === 'granted') {
      subscribeAndRegister().catch(() => {})
    }
  }, [])

  // Déclenché par le clic « Activer » de l'utilisateur (obligatoirement un
  // geste utilisateur, sinon le navigateur refuse la demande de permission)
  const enable = useCallback(async (): Promise<PushPermission> => {
    if (!isSupported()) return 'unsupported'
    const result = await Notification.requestPermission()
    setPermission(result as PushPermission)
    if (result === 'granted') {
      try { await subscribeAndRegister() } catch { /* réessaiera au prochain chargement */ }
    }
    return result as PushPermission
  }, [])

  return { permission, enable }
}
