// Avis au membre après une décision manuelle sur son paiement (espèces, virement) :
// confirmation (avec reçu, EF-M05-10/21, EF-M06-02), refus, mise en litige et
// résolution. Jamais bloquant pour la personne qui a décidé : appelé sans attendre.
import { getPrisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { notifyInApp, notifyMemberConfirmed } from './notification'
import { isAnonymized } from './privacy.service'

const prisma = getPrisma()
const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`

async function load(contributionId: string) {
  return prisma.contribution.findUnique({
    where: { id: contributionId },
    select: {
      id: true, montant: true,
      rubrique: { select: { code: true, title: true } },
      membre: { select: { phone: true, user: { select: { id: true, fullName: true, email: true, phone: true, whatsappPhone: true, isActive: true } } } },
    },
  })
}

export type PayerDecision = 'CONFIRME' | 'REFUSE' | 'LITIGE' | 'LITIGE_ANNULE'

/** Prévient le membre payeur (contribution sans membre : rien). */
export async function notifyPayerDecision(contributionId: string, decision: PayerDecision, motif?: string): Promise<void> {
  try {
    const c = await load(contributionId)
    const user = c?.membre?.user
    if (!c || !user || !user.isActive) return
    const target = { view: 'mes-contributions', id: c.id }
    const label = `${fcfa(c.montant)} (${c.rubrique.code})`

    if (decision === 'CONFIRME') {
      // In-app, WhatsApp (modèle « paiement confirmé ») ou SMS, e-mail avec le reçu PDF
      await notifyMemberConfirmed({
        userId: user.id,
        memberPhone: user.whatsappPhone ?? user.phone ?? c.membre?.phone,
        memberEmail: isAnonymized(user.email) ? null : user.email,
        memberName: user.fullName, montant: c.montant, rubriqueCode: c.rubrique.code, contributionId: c.id,
      })
      return
    }
    const messages = {
      REFUSE: ['Paiement non reçu', `Votre paiement de ${label} n'a pas été reçu et a été annulé.${motif ? ` Motif : ${motif}` : ''} Rapprochez-vous de votre collecteur.`],
      LITIGE: ['Paiement en vérification', `Votre paiement de ${label} est en cours de vérification par un responsable. Vous serez prévenu de la décision.`],
      LITIGE_ANNULE: ['Paiement annulé après vérification', `Après vérification, votre paiement de ${label} a été annulé.${motif ? ` Motif : ${motif}` : ''}`],
    } as const
    const [title, body] = messages[decision]
    await notifyInApp(user.id, title, body, 'ALERTE', { kind: 'decision-paiement', decision, contributionId: c.id }, target)
  } catch (err) {
    logger.error({ err: (err as Error).message, contributionId, decision }, '[Avis payeur] Envoi impossible')
  }
}
