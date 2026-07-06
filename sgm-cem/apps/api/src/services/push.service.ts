// ──────────────────────────────────────────────────────────────────────
// WEB PUSH — notifications dans la barre système du navigateur
//
// Chaque notification in-app (notifyInApp) est doublée d'un push envoyé à
// TOUS les abonnements du destinataire (PC + téléphone). Les abonnements
// expirés (410/404) sont purgés automatiquement.
//
// Clés VAPID lues via getConfig AU MOMENT de l'envoi (panneau développeur,
// section Notifications) — jamais de constante figée au chargement.
// ──────────────────────────────────────────────────────────────────────
import webpush from 'web-push'
import { getPrisma } from '../lib/prisma'
import { getConfig, getConfigBool } from './config.service'

const prisma = getPrisma()

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

function getVapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = getConfig('VAPID_PUBLIC_KEY')
  const privateKey = getConfig('VAPID_PRIVATE_KEY')
  const subject = getConfig('VAPID_SUBJECT') ?? 'mailto:contact@cem-melen.cm'
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

/** Clé publique exposée au frontend pour pushManager.subscribe(). */
export function getVapidPublicKey(): string | null {
  return getConfig('VAPID_PUBLIC_KEY') ?? null
}

/**
 * Envoie un push à tous les abonnements d'un utilisateur.
 * Silencieux en cas d'échec (le push est un canal best-effort : la
 * notification in-app reste la source de vérité).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    if (!getConfigBool('PUSH_ENABLED', true)) return
    const vapid = getVapid()
    if (!vapid) return // VAPID non configuré — push désactivé de fait

    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
    if (subscriptions.length === 0) return

    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
    const body = JSON.stringify(payload)

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404/410 = abonnement expiré ou révoqué → purge
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        } else {
          console.error('[Push]', status ?? '', (err as Error).message)
        }
      }
    }))
  } catch (e) {
    console.error('[Push] envoi impossible', e)
  }
}
