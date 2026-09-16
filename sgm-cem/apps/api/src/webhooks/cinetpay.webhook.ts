import express, { Router, type Request } from 'express'
import {
  verifyCinetpaySignature,
  verifyCinetpayTransaction,
  type CinetpayVerificationResponse,
} from '../services/cinetpay.service'
import { getPrisma } from '../lib/prisma'
import { audit } from '../services/audit.service'
import { generateReceiptPDF } from '../services/receipt'
import { sendWhatsAppDocument, sendWhatsApp, alertTresoriers, notifyMemberConfirmed } from '../services/notification'
import { broadcastToAll } from '../lib/socket'

const router = Router()
const prisma = getPrisma()

const FAILED_STATUSES = new Set(['REFUSED', 'CANCELLED'])

/** CinetPay utilise cette route GET pour vérifier que l’URL de notification répond. */
router.get('/cinetpay', (_req, res) => {
  res.status(200).send('OK')
})

/**
 * CinetPay envoie ses webhooks en application/x-www-form-urlencoded.
 * Cette route doit être enregistrée AVANT express.json() dans index.ts.
 */
router.post('/cinetpay', express.urlencoded({ extended: false }), async (req, res) => {
  const body = req.body as Record<string, string | undefined>
  const receivedToken = req.get('x-token')

  if (!verifyCinetpaySignature(body, receivedToken)) {
    console.error('[CinetPay Webhook] Signature invalide — requête rejetée')
    return res.status(401).send('Signature invalide')
  }

  const transactionId = body.cpm_trans_id?.trim()
  if (!transactionId) {
    console.warn('[CinetPay Webhook] Identifiant de transaction manquant')
    return res.status(400).send('Identifiant de transaction manquant')
  }

  const contribution = await findCinetpayContribution(transactionId)

  if (!contribution) {
    console.warn(`[CinetPay Webhook] Transaction ${transactionId} inconnue`)
    return res.status(200).send('OK')
  }

  // Évite un nouvel appel distant et toute double notification pour une transaction terminale.
  if (
    contribution.paymentStatus === 'SUCCESS' ||
    contribution.paymentStatus === 'FAILED' ||
    contribution.statut === 'CONFIRME' ||
    contribution.statut === 'ANNULE'
  ) {
    console.info(`[CinetPay Webhook] Transaction ${transactionId} déjà traitée`)
    return res.status(200).send('OK')
  }

  let verification: CinetpayVerificationResponse
  try {
    verification = await verifyCinetpayTransaction(transactionId)
  } catch (error) {
    console.error(`[CinetPay Webhook] Vérification distante impossible pour ${transactionId}`, error)
    return res.status(503).send('Vérification CinetPay temporairement indisponible')
  }

  try {
    await processCinetpayWebhook(req, contribution, transactionId, verification)
    return res.status(200).send('OK')
  } catch (error) {
    console.error(`[CinetPay Webhook] Échec du traitement de ${transactionId}`, error)
    return res.status(500).send('Erreur de traitement CinetPay')
  }
})

async function getAuditIdentity(memberUser?: { id: string; fullName: string } | null): Promise<{
  userId: string
  userName: string
}> {
  if (memberUser) {
    return { userId: memberUser.id, userName: memberUser.fullName }
  }

  const publicSystemUser = await prisma.user.findUnique({
    where: { email: 'systeme.public@sgm-cem.local' },
    select: { id: true },
  })
  if (publicSystemUser) {
    return { userId: publicSystemUser.id, userName: 'Système CinetPay — contribution publique' }
  }

  const fallbackUser = await prisma.user.findFirst({
    where: { role: { in: ['DEVELOPER', 'ADMIN'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!fallbackUser) {
    throw new Error('Aucun utilisateur système disponible pour l’audit CinetPay')
  }

  return { userId: fallbackUser.id, userName: 'Système CinetPay' }
}

async function processCinetpayWebhook(
  req: Request,
  contribution: Awaited<ReturnType<typeof findCinetpayContribution>>,
  transactionId: string,
  verification: CinetpayVerificationResponse
): Promise<void> {
  if (!contribution) return

  const remoteStatus = verification.data?.status?.trim().toUpperCase() ?? ''
  const remoteCode = verification.code.trim().toUpperCase()

  if (remoteStatus === 'ACCEPTED' && remoteCode === '00') {
    const receivedAmount = Number(verification.data?.amount)
    const receivedCurrency = verification.data?.currency?.trim().toUpperCase() ?? ''
    const amountMatches = Number.isFinite(receivedAmount) && receivedAmount === contribution.montant
    const currencyMatches = receivedCurrency === 'XAF'

    if (!amountMatches || !currencyMatches) {
      const memberName = contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'
      const receivedAmountLabel = Number.isFinite(receivedAmount)
        ? receivedAmount.toLocaleString('fr-FR')
        : verification.data?.amount ?? 'absent'

      console.warn(
        `[CinetPay Webhook] Données incohérentes pour ${transactionId} : ` +
        `${receivedAmountLabel} ${receivedCurrency || 'devise absente'} reçus, ` +
        `${contribution.montant} XAF attendus`
      )
      await alertTresoriers(
        'Paiement CinetPay incohérent',
        `${memberName} · attendu ${contribution.montant.toLocaleString('fr-FR')} XAF, ` +
        `reçu ${receivedAmountLabel} ${receivedCurrency || 'devise absente'} (transaction ${transactionId})`,
        {
          contributionId: contribution.id,
          transactionId,
          expectedAmount: contribution.montant,
          expectedCurrency: 'XAF',
          receivedAmount: verification.data?.amount ?? null,
          receivedCurrency: receivedCurrency || null,
          source: 'cinetpay_webhook',
        },
        { view: 'contributions', id: contribution.id }
      )
      return
    }

    const auditIdentity = await getAuditIdentity(contribution.membre?.user)
    const { count } = await prisma.contribution.updateMany({
      where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
      data: {
        statut: 'CONFIRME',
        confirmedAt: new Date(),
        paymentStatus: 'SUCCESS',
        netAmount: null,
        localisationFonds: 'REMIS_TRESORIER',
      },
    })

    if (count === 0) {
      console.info(`[CinetPay Webhook] Transaction ${transactionId} déjà traitée par un autre chemin`)
      return
    }

    await audit({
      req,
      ...auditIdentity,
      action: 'CONFIRM',
      entityType: 'Contribution',
      entityId: contribution.id,
      details: {
        source: 'cinetpay_webhook',
        transactionId,
        remoteCode,
        remoteStatus,
        amount: receivedAmount,
        currency: receivedCurrency,
      },
    })

    const receiptUrl = await generateReceiptPDF(contribution.id)
    const memberPhone = contribution.membre?.user.whatsappPhone
      ?? contribution.membre?.user.phone
      ?? contribution.contributeurExterne?.phone
    const memberName = contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'
    const montantStr = contribution.montant.toLocaleString('fr-FR')
    const message = `CEM Melen - Paiement par carte confirmé\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nMerci pour votre contribution !`

    if (contribution.membre) {
      try {
        await notifyMemberConfirmed({
          userId: contribution.membre.user.id,
          memberPhone,
          memberEmail: contribution.membre.user.email,
          memberName,
          montant: contribution.montant,
          rubriqueCode: contribution.rubrique.code,
          receiptUrl,
          contributionId: contribution.id,
        })
      } catch (error) {
        console.error('[CinetPay Webhook] Échec de la notification du membre', error)
      }
    } else if (memberPhone) {
      let sent = false
      if (receiptUrl) sent = await sendWhatsAppDocument(memberPhone, receiptUrl, message)
      if (!sent) await sendWhatsApp(memberPhone, message)
    }

    broadcastToAll('contribution:confirmed', {
      contributionId: contribution.id,
      rubriqueId: contribution.rubriqueId,
    })
    console.info(`[CinetPay Webhook] Transaction ${transactionId} confirmée`)
    return
  }

  if (FAILED_STATUSES.has(remoteStatus)) {
    const auditIdentity = await getAuditIdentity(contribution.membre?.user)
    const { count } = await prisma.contribution.updateMany({
      where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
      data: { statut: 'ANNULE', paymentStatus: 'FAILED' },
    })

    if (count === 0) {
      console.info(`[CinetPay Webhook] Transaction ${transactionId} déjà traitée par un autre chemin`)
      return
    }

    await audit({
      req,
      ...auditIdentity,
      action: 'REJECT',
      entityType: 'Contribution',
      entityId: contribution.id,
      details: { source: 'cinetpay_webhook', transactionId, remoteCode, remoteStatus },
    })

    const memberPhone = contribution.membre?.user.whatsappPhone
      ?? contribution.membre?.user.phone
      ?? contribution.contributeurExterne?.phone
    const memberName = contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'
    if (memberPhone) {
      const message = `CEM Melen - Paiement par carte échoué\nMembre: ${memberName}\nMontant: ${contribution.montant.toLocaleString('fr-FR')} FCFA\nRubrique: ${contribution.rubrique.title}\nRéessayez ou contactez un collecteur.`
      await sendWhatsApp(memberPhone, message)
    }

    console.info(`[CinetPay Webhook] Transaction ${transactionId} refusée ou annulée`)
    return
  }

  console.info(
    `[CinetPay Webhook] Transaction ${transactionId} sans transition ` +
    `(code ${remoteCode || 'absent'}, statut ${remoteStatus || 'absent'})`
  )
}

async function findCinetpayContribution(transactionId: string) {
  return prisma.contribution.findFirst({
    where: { externalTransactionId: transactionId },
    include: {
      membre: {
        include: {
          user: { select: { id: true, phone: true, whatsappPhone: true, fullName: true, email: true } },
        },
      },
      contributeurExterne: { select: { phone: true, nom: true } },
      rubrique: { select: { title: true, code: true } },
    },
  })
}

export default router
