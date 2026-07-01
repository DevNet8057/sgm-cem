# PROMPT CLAUDE CODE — Mise à jour : Module Fonds Collecteurs
## SGM-CEM · Feature : Transfert de Fonds avec Validation Récepteur
## Version 4.2 · Juin 2026

---

## CONTEXTE ET MISSION

Tu travailles sur le projet **SGM-CEM** (Système de Gestion du Ministère — Culte d'Enfants de Melen).

**Lis en priorité** :
1. `CLAUDE.md` — architecture, design system EEC, règles métier
2. La page `funds/page.tsx` — code actuel du module Fonds Collecteurs

Tu dois mettre à jour le module **"Fonds Collecteurs"** pour implémenter un système de transfert de fonds sécurisé avec validation obligatoire par le récepteur.

**Après avoir terminé toutes les modifications de code**, tu dois **mettre à jour le fichier `CLAUDE.md`** pour refléter les changements : nouveau modèle Prisma, nouvelles règles métier, nouveaux endpoints, nouvelle vue.

---

## ANALYSE DE L'INTERFACE ACTUELLE

L'interface existante (`funds/page.tsx`) possède déjà :
- ✅ Pipeline visuel : Chez collecteurs → En transit → Trésorier/Caisse → Banque
- ✅ Barre de progression jaune/verte
- ✅ Carte par collecteur (Chez collecteur / En transit / Total)
- ✅ Tableau des contributions avec checkboxes
- ✅ Dropdown "Vers caisse" + bouton "Transférer"

Ce qu'il faut **ajouter / modifier** :
- ❌ Clic sur une ligne du tableau → drawer latéral avec détail complet
- ❌ Dropdown destinataire : doit lister collecteurs + rôles supérieurs (pas uniquement "Vers caisse")
- ❌ Flow "PENDING_APPROVAL" — transfert bloqué jusqu'à validation récepteur
- ❌ Vue "Validations" (page dédiée) — le récepteur confirme ou refuse la réception
- ❌ Notification push/WhatsApp au récepteur dès le transfert initié
- ❌ Vue adaptée selon le rôle : Admin voit tout, Collecteur voit seulement ses propres fonds
- ❌ Badge "En attente" clignotant sur les transferts non confirmés

---

## LE FLOW COMPLET À IMPLÉMENTER

```
ÉTAPE 1 — Collecteur sélectionne des contributions
  ┌─────────────────────────────────────────────────────┐
  │  [☑] Brigitte FOUDA · CA-DEUIL · 5 000 FCFA · Espèces │
  │  [☑] Jean KAMGA    · CM-2025  · 3 000 FCFA · MoMo    │
  └─────────────────────────────────────────────────────┘
  → Barre du bas se met à jour : "2 sélectionnées · 8 000 FCFA"

ÉTAPE 2 — Clic sur une ligne → Drawer de détail (optionnel, non bloquant)
  ┌── DÉTAIL CONTRIBUTION ──────────────────────────────┐
  │  Membre     : Brigitte FOUDA                        │
  │  Rubrique   : CA-DEUIL — Assistance Deuil           │
  │  Montant    : 5 000 FCFA                            │
  │  Mode       : Espèces                               │
  │  Collecté   : 09 juin 2026 à 14h32                  │
  │  Collecteur : DevNet Admin                          │
  │  Localisation actuelle : Chez collecteur            │
  │  Statut     : CONFIRMÉ                              │
  │  N° reçu    : CEM-2026-000003                       │
  └─────────────────────────────────────────────────────┘

ÉTAPE 3 — Collecteur choisit le destinataire
  Dropdown remplacé par un select structuré en sections :
  ┌── CHOISIR LE DESTINATAIRE ──────────────────────────┐
  │  ── Collecteurs ──                                  │
  │  👤 Marie ESSOMBA (Collecteur · Mvog Betsi)         │
  │  👤 Paul NGONO (Collecteur · Temple)                │
  │  ── Niveau supérieur ──                             │
  │  🛡 Jean TAGNE (Responsable)                       │
  │  💼 Alice FOUDA (Trésorier)                        │
  │  ── Administration ──                               │
  │  ⚡ DevNet Admin (Admin)                            │
  └─────────────────────────────────────────────────────┘

  Note optionnelle : "Transfert physique en main / Dépôt MTN / Dépôt Orange"

ÉTAPE 4 — Confirmation de l'envoi
  Modal récapitulatif :
  ┌─────────────────────────────────────────────────────┐
  │  Transférer 8 000 FCFA                              │
  │  De : DevNet Admin (vous)                           │
  │  Vers : Alice FOUDA (Trésorier)                     │
  │  2 contributions · Mode : Espèces (en main)         │
  │  ⚠ Alice FOUDA devra confirmer la réception         │
  │  [Annuler]          [Confirmer le transfert →]      │
  └─────────────────────────────────────────────────────┘

ÉTAPE 5 — Transfert créé → statut PENDING_APPROVAL
  Les contributions passent en "En transit" (jaune)
  Le récepteur reçoit une notification :
    WhatsApp : "DevNet Admin vous a transféré 8 000 FCFA (2 contributions).
               Ouvrez l'application et confirmez la réception."
    In-app   : Badge sur "Validations" dans la sidebar

ÉTAPE 6 — Le récepteur ouvre la page "Validations"
  ┌── TRANSFERTS EN ATTENTE DE MA VALIDATION ───────────┐
  │  De : DevNet Admin · 8 000 FCFA · 2 contributions   │
  │  Initié : il y a 3 min                              │
  │  [Voir le détail ▾]                                 │
  │     • Brigitte FOUDA · CA-DEUIL · 5 000 FCFA        │
  │     • Jean KAMGA · CM-2025 · 3 000 FCFA             │
  │  Note expéditeur : "Transfert physique en main"     │
  │                                                     │
  │  [❌ Refuser]              [✅ Confirmer la réception] │
  └─────────────────────────────────────────────────────┘

ÉTAPE 7A — Récepteur CONFIRME
  → FundsTransfer.status = CONFIRMED
  → FundsTransfer.confirmedAt = now() (SERVEUR)
  → Contributions.fundsLocation = selon le rôle du récepteur :
      Collecteur      → CHEZ_COLLECTEUR (chez le nouveau collecteur)
      Responsable/ADJ → CHEZ_RESPONSABLE (nouveau statut)
      Trésorier/Admin → REMIS_TRESORIER
  → Expéditeur reçoit notification : "Alice FOUDA a confirmé la réception de 8 000 FCFA"
  → Bordereau PDF généré et envoyé aux deux parties

ÉTAPE 7B — Récepteur REFUSE (avec motif obligatoire)
  → FundsTransfer.status = REFUSED
  → Contributions.fundsLocation revient à CHEZ_COLLECTEUR (expéditeur)
  → Expéditeur notifié : "Alice FOUDA a refusé le transfert. Motif : [...]"
  → Trésorier alerté du refus

ÉTAPE 7C — TIMEOUT sans réponse
  → Après N heures (configurable dans SystemSettings, défaut 24h)
  → Rappel automatique envoyé au récepteur
  → Après 48h sans réponse → alerte au Trésorier
  → Transfert reste en PENDING indéfiniment (pas d'annulation auto)
```

---

## 1. MISE À JOUR DU MODÈLE DE DONNÉES PRISMA

### Remplacer le modèle `FundsHandover` existant

```prisma
// SUPPRIMER l'ancien modèle FundsHandover (trop limité)
// Le REMPLACER par FundsTransfer ci-dessous

// Nouveau statut pour la localisation des fonds
enum FundsLocation {
  CHEZ_COLLECTEUR     // Espèces chez le collecteur
  EN_TRANSIT          // Transfert initié, en attente de validation récepteur
  CHEZ_RESPONSABLE    // Remis au Responsable / Adjoint
  REMIS_TRESORIER     // Confirmé par le Trésorier
  EN_CAISSE           // Dans la caisse officielle
  EN_BANQUE           // Déposé en banque
}

// Nouveau type de transfert
enum TransferType {
  ESPECES_EN_MAIN     // Remise physique en main propre
  DEPOT_MTN           // Dépôt via MTN MoMo
  DEPOT_ORANGE        // Dépôt via Orange Money
  AUTRE               // Autre mode
}

// Statut du transfert
enum FundsTransferStatus {
  PENDING_APPROVAL    // Initié, en attente de validation par le récepteur
  CONFIRMED           // Récepteur a validé → transfert finalisé
  REFUSED             // Récepteur a refusé (motif obligatoire)
  CANCELLED           // Annulé par l'expéditeur avant confirmation
}

model FundsTransfer {
  id               String              @id @default(cuid())
  createdAt        DateTime            @default(now())    // Horodatage serveur — JAMAIS client
  confirmedAt      DateTime?                              // Positionné par le serveur lors de la confirmation récepteur
  refusedAt        DateTime?
  cancelledAt      DateTime?

  // Expéditeur (doit être un collecteur ou niveau supérieur)
  senderId         String
  sender           User                @relation("FundsTransferSender",   fields:[senderId],   references:[id])
  senderName       String                                 // Snapshot du nom au moment du transfert

  // Récepteur (doit être collecteur ou niveau supérieur)
  receiverId       String
  receiver         User                @relation("FundsTransferReceiver", fields:[receiverId], references:[id])
  receiverName     String                                 // Snapshot du nom

  // Montant total (somme des contributions incluses)
  totalAmount      Int

  // Type de remise physique
  transferType     TransferType        @default(ESPECES_EN_MAIN)

  // Statut du transfert
  status           FundsTransferStatus @default(PENDING_APPROVAL)

  // Note de l'expéditeur (optionnel)
  senderNote       String?

  // Motif de refus (obligatoire si status = REFUSED)
  refusalReason    String?

  // Contributions incluses dans ce transfert
  contributions    Contribution[]      @relation("ContributionTransfer")

  // Documents générés
  borderauUrl      String?             // PDF généré après CONFIRMED

  // Rappels envoyés
  remindersSentCount Int               @default(0)
  lastReminderSentAt DateTime?

  @@index([senderId])
  @@index([receiverId])
  @@index([status])
  @@index([createdAt])
}

// Mettre à jour le modèle Contribution pour référencer FundsTransfer
model Contribution {
  // ... tous les champs existants ...

  // REMPLACER handoverId par transferId
  transferId       String?
  fundsTransfer    FundsTransfer?      @relation("ContributionTransfer", fields:[transferId], references:[id])

  // Ajouter le nouveau statut de localisation
  fundsLocation    FundsLocation?      @default(CHEZ_COLLECTEUR)

  // ... reste inchangé
}

// Ajouter dans SystemSettings
model SystemSettings {
  // ... tous les champs existants ...
  transferPendingReminderHours  Int    @default(24)  // Délai rappel si pas de réponse
  transferAlertTresorierHours   Int    @default(48)  // Délai alerte trésorier si toujours pas de réponse
}
```

### Migration Prisma à créer

```bash
npx prisma migrate dev --name "add_funds_transfer_with_receiver_validation"
```

---

## 2. MISE À JOUR DU BACKEND API

### Nouveaux endpoints à créer/modifier

```typescript
// ── FONDS COLLECTEURS ──────────────────────────────────────────────────────

// GET /api/funds/overview
// Retourne le pipeline complet pour l'admin/trésorier
// Response : { chezCollecteurs, enTransit, chezResponsable, remiseTresorier, enCaisse, enBanque, total }
// Filtre automatique par rôle : Admin/Trésorier → tous les collecteurs
//                                Collecteur       → uniquement ses propres fonds
router.get('/overview', authenticate, requireLevel(2), getFundsOverview)

// GET /api/funds/contributions
// Retourne les contributions avec leurs localisations actuelles
// Filtre : collectorId?, status?, rubriqueId?, dateFrom?, dateTo?
// Filtre automatique : Collecteur → uniquement ses propres contributions confirmées
router.get('/contributions', authenticate, requireLevel(2), getFundsContributions)

// GET /api/funds/eligible-receivers
// Retourne les utilisateurs autorisés comme récepteur pour un transfert
// Règle : role >= COLLECTEUR (exclu : MEMBRE)
// Exclut l'expéditeur lui-même
// Groupes par rôle : Collecteurs | Responsables | Trésorier/Admin
router.get('/eligible-receivers', authenticate, requireLevel(2), getEligibleReceivers)

// POST /api/funds/transfer
// Initie un transfert — crée FundsTransfer avec status PENDING_APPROVAL
// Body : { receiverId, contributionIds[], transferType, senderNote? }
// Validations :
//   - contributionIds : doivent tous appartenir à l'expéditeur (senderId = userId JWT)
//   - contributionIds : doivent tous être en status CONFIRME ET fundsLocation CHEZ_COLLECTEUR
//   - receiverId      : doit être dans la liste des récepteurs éligibles
//   - Après création  : contributions.fundsLocation → EN_TRANSIT
//   - Notification    : WhatsApp + In-app au récepteur
router.post('/transfer', authenticate, requireLevel(2), initiateTransfer)

// GET /api/funds/transfers
// Liste des transferts — filtrée par rôle :
//   Admin/Trésorier → tous les transferts
//   Collecteur      → transferts où il est sender OU receiver
router.get('/transfers', authenticate, requireLevel(2), getTransfers)

// GET /api/funds/transfers/pending-my-approval
// Transferts en attente de validation PAR MOI (userId = receiverId)
// Utilisé pour la page "Validations" et le badge dans la sidebar
router.get('/transfers/pending-my-approval', authenticate, requireLevel(2), getPendingApprovalTransfers)

// PATCH /api/funds/transfers/:id/confirm
// Le récepteur confirme la réception
// Règle CRITIQUE : seul le récepteur (receiverId = userId JWT) peut confirmer
// Après confirmation :
//   - FundsTransfer.status = CONFIRMED
//   - FundsTransfer.confirmedAt = now() (SERVEUR)
//   - Contributions.fundsLocation = selon rôle récepteur (CHEZ_COLLECTEUR | CHEZ_RESPONSABLE | REMIS_TRESORIER)
//   - Notification à l'expéditeur
//   - Génération bordereau PDF → S3
router.patch('/transfers/:id/confirm', authenticate, requireLevel(2), confirmTransfer)

// PATCH /api/funds/transfers/:id/refuse
// Le récepteur refuse
// Body : { reason } (obligatoire)
// Règle : seul le récepteur peut refuser
// Après refus :
//   - FundsTransfer.status = REFUSED
//   - Contributions.fundsLocation revient à CHEZ_COLLECTEUR
//   - Notification à l'expéditeur + alerte Trésorier
router.patch('/transfers/:id/refuse', authenticate, requireLevel(2), refuseTransfer)

// PATCH /api/funds/transfers/:id/cancel
// L'expéditeur annule un transfert PENDING (avant confirmation récepteur)
// Règle : seul l'expéditeur peut annuler, uniquement si status = PENDING_APPROVAL
// Après annulation :
//   - FundsTransfer.status = CANCELLED
//   - Contributions.fundsLocation revient à CHEZ_COLLECTEUR
//   - Notification au récepteur
router.patch('/transfers/:id/cancel', authenticate, requireLevel(2), cancelTransfer)
```

### Logique de confirmation — règles critiques

```typescript
// apps/api/src/controllers/funds.controller.ts

async function confirmTransfer(req: AuthRequest, res: Response) {
  const { id } = req.params
  const userId = req.user.id

  // 1. Récupérer le transfert
  const transfer = await prisma.fundsTransfer.findUnique({
    where: { id },
    include: { contributions: true, sender: true }
  })

  // 2. Vérifications critiques
  if (!transfer) return res.status(404).json({ error: 'NOT_FOUND' })
  if (transfer.status !== 'PENDING_APPROVAL') {
    return res.status(400).json({ error: 'ALREADY_PROCESSED', message: 'Ce transfert a déjà été traité' })
  }
  // RÈGLE CRITIQUE : seul le récepteur peut confirmer
  if (transfer.receiverId !== userId) {
    return res.status(403).json({ error: 'NOT_YOUR_TRANSFER', message: 'Vous n\'êtes pas le récepteur de ce transfert' })
  }

  // 3. Déterminer la nouvelle localisation selon le rôle du récepteur
  const receiverRole = req.user.role
  const newLocation: FundsLocation =
    ['ADMIN', 'TRESORIER'].includes(receiverRole)   ? 'REMIS_TRESORIER'   :
    ['RESPONSABLE', 'ADJOINT_RESPONSABLE'].includes(receiverRole) ? 'CHEZ_RESPONSABLE' :
    'CHEZ_COLLECTEUR' // Collecteur

  // 4. Transaction atomique — TOUT ou RIEN
  const result = await prisma.$transaction([
    // Mettre à jour le transfert
    prisma.fundsTransfer.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(), // SERVEUR — jamais client
      }
    }),
    // Mettre à jour toutes les contributions associées
    prisma.contribution.updateMany({
      where: { transferId: id },
      data: {
        fundsLocation: newLocation,
        collectorId: receiverRole === 'COLLECTEUR' ? userId : undefined, // Reassigner si nouveau collecteur
      }
    }),
  ])

  // 5. Générer le bordereau PDF et l'uploader sur S3
  const borderauUrl = await generateTransferBorderau(transfer, req.user)
  await prisma.fundsTransfer.update({
    where: { id }, data: { borderauUrl }
  })

  // 6. Notifications
  await notificationService.send({
    userId: transfer.senderId,
    channel: 'WHATSAPP',
    template: 'cem_transfer_confirmed',
    data: {
      receiverName: req.user.fullName,
      totalAmount: formatAmount(transfer.totalAmount),
      count: transfer.contributions.length,
    }
  })

  // 7. Audit log
  await auditService.log({
    userId, action: 'TRANSFER_CONFIRMED', entity: 'FundsTransfer', entityId: id,
    before: { status: 'PENDING_APPROVAL' }, after: { status: 'CONFIRMED', confirmedAt: new Date() }
  })

  return res.json({ success: true, data: { borderauUrl } })
}
```

---

## 3. MISE À JOUR DE L'INTERFACE — funds/page.tsx

### 3.1 Vue Admin/Trésorier — améliorations

```tsx
// GARDER la structure actuelle (pipeline + tableau) et AMÉLIORER :

// ── 1. Pipeline "Trajet de l'argent" ─────────────────────────────────────
// Ajouter "Chez Responsable" entre "En transit" et "Trésorier/Caisse"
// Design final :
// [Chez collecteurs] → [En transit] → [Chez Responsable] → [Trésorier/Caisse] → [Banque]
// Chaque étape : icône + montant + couleur distinctive
// Étape "En transit" : couleur jaune #F5C400 + icône animate-spin lent si > 0

// ── 2. Tableau des contributions ─────────────────────────────────────────
// AJOUTER une colonne "Statut transfert" :
//   - Badge "En transit" jaune si EN_TRANSIT (avec petit spinner)
//   - Badge "Chez moi" vert si CHEZ_COLLECTEUR
//   - Rien si déjà remis
// AJOUTER une ligne cliquable → drawer latéral (voir section 3.2)

// ── 3. Dropdown destinataire ─────────────────────────────────────────────
// REMPLACER le simple dropdown "Vers caisse" par un Select structuré
// Utiliser Radix UI Select avec groupes
// Données depuis GET /api/funds/eligible-receivers
```

### 3.2 Drawer de détail d'une contribution (nouveau)

```tsx
// Drawer latéral (right side, 400px) qui s'ouvre au clic sur une ligne
// Sur mobile : bottom sheet slide-up

function ContributionDetailDrawer({ contribution, open, onClose }: Props) {
  return (
    <div className={`
      fixed inset-y-0 right-0 z-[350] w-full sm:w-[420px]
      bg-white shadow-[-8px_0_40px_rgba(0,0,0,0.12)]
      transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
      ${open ? 'translate-x-0' : 'translate-x-full'}
    `}>
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <div>
          <h3 className="font-display font-semibold text-gray-900">Détail de la contribution</h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{contribution.receiptNumber}</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">
          <X size={16} />
        </button>
      </div>

      {/* Contenu */}
      <div className="p-5 space-y-4 overflow-y-auto h-full pb-24">

        {/* Montant en gros */}
        <div className="bg-[#E8F5E8] rounded-[16px] p-5 text-center">
          <p className="text-xs font-semibold text-[#1A6B1A] uppercase tracking-wide mb-1">Montant</p>
          <p className="font-display font-bold text-3xl text-[#0F4A0F]">{formatAmount(contribution.amount)}</p>
          <StatusBadge status={contribution.status} className="mt-2" />
        </div>

        {/* Détails en grille */}
        {[
          { label: 'Membre', value: contribution.payerName, icon: User },
          { label: 'Rubrique', value: `${contribution.rubriqueCode} — ${contribution.rubriqueTitle}`, icon: FolderOpen },
          { label: 'Mode de paiement', value: paymentMethodLabel[contribution.paymentMethod], icon: CreditCard },
          { label: 'Collecteur', value: contribution.collectorName, icon: UserCheck },
          { label: 'Date de collecte', value: formatDateTime(contribution.createdAt), icon: Calendar },
          { label: 'Localisation actuelle', value: fundsLocationLabel[contribution.fundsLocation], icon: MapPin },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-[12px]">
            <div className="w-8 h-8 bg-white rounded-[8px] flex items-center justify-center flex-shrink-0 shadow-sm">
              <Icon size={15} className="text-[#1A6B1A]" />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-gray-800">{value}</p>
            </div>
          </div>
        ))}

        {/* Historique de localisation (timeline) */}
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
            Historique du trajet
          </h4>
          <div className="relative pl-6 space-y-3">
            {/* Ligne verticale de la timeline */}
            <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200" />
            {contribution.transferHistory?.map((event, i) => (
              <div key={i} className="relative flex items-start gap-3">
                <div className={`
                  absolute -left-4 w-4 h-4 rounded-full border-2 bg-white flex-shrink-0
                  ${i === 0 ? 'border-[#1A6B1A]' : 'border-gray-300'}
                `} />
                <div className="bg-white border border-gray-100 rounded-[10px] px-3 py-2 flex-1 ml-2">
                  <p className="text-xs font-semibold text-gray-700">{event.action}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{event.actor} · {timeAgo(event.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

### 3.3 Sélecteur de destinataire (nouveau composant)

```tsx
// Remplace le simple dropdown "Vers caisse"
// Données chargées depuis GET /api/funds/eligible-receivers

function ReceiverSelector({ value, onChange, excludeUserId }: Props) {
  const { data: receivers } = useQuery({
    queryKey: ['eligible-receivers'],
    queryFn: () => api.get('/funds/eligible-receivers').then(r => r.data)
  })

  // Grouper par rôle
  const groups = [
    { label: 'Collecteurs',          roles: ['COLLECTEUR'],                           icon: UserCheck,  color: '#F5C400' },
    { label: 'Responsables',         roles: ['RESPONSABLE','ADJOINT_RESPONSABLE'],    icon: Shield,     color: '#3B82F6' },
    { label: 'Trésorier & Admin',    roles: ['TRESORIER','ADMIN'],                    icon: Landmark,   color: '#1A6B1A' },
  ]

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-52 border-gray-200 rounded-[10px] text-sm">
        <SelectValue placeholder="Choisir le destinataire..." />
      </SelectTrigger>
      <SelectContent className="rounded-[14px] shadow-xl border-gray-100 p-1">
        {groups.map(group => {
          const groupReceivers = receivers?.filter(
            r => group.roles.includes(r.role) && r.id !== excludeUserId
          ) ?? []
          if (groupReceivers.length === 0) return null
          return (
            <SelectGroup key={group.label}>
              <SelectLabel className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <group.icon size={10} style={{ color: group.color }} />
                {group.label}
              </SelectLabel>
              {groupReceivers.map(receiver => (
                <SelectItem key={receiver.id} value={receiver.id}
                  className="rounded-[8px] text-sm cursor-pointer hover:bg-[#E8F5E8] focus:bg-[#E8F5E8]">
                  <div className="flex items-center gap-2.5">
                    {/* Avatar initiales */}
                    <div className="w-7 h-7 rounded-[6px] bg-[#F5C400] flex items-center justify-center text-[10px] font-bold text-[#0F4A0F] flex-shrink-0">
                      {getInitials(receiver.fullName)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800 leading-tight">{receiver.fullName}</p>
                      <p className="text-[10px] text-gray-400">{roleLabel[receiver.role]}</p>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
}
```

### 3.4 Sélecteur de type de transfert

```tsx
// NOUVEAU : après avoir sélectionné le destinataire, afficher le type de remise
// Permet la traçabilité du mode de transfert physique

function TransferTypeSelector({ value, onChange }: Props) {
  const options = [
    { value: 'ESPECES_EN_MAIN',  label: 'En main propre',    emoji: '🤝', desc: 'Remise physique directe'    },
    { value: 'DEPOT_MTN',        label: 'Dépôt MTN MoMo',    emoji: '🟡', desc: 'Transfert via MTN MoMo'     },
    { value: 'DEPOT_ORANGE',     label: 'Dépôt Orange Money', emoji: '🟠', desc: 'Transfert via Orange Money' },
    { value: 'AUTRE',            label: 'Autre mode',         emoji: '📦', desc: 'Préciser dans la note'      },
  ]
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(opt => (
        <button key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`
            p-3 rounded-[12px] border-2 text-left transition-all duration-200
            ${value === opt.value
              ? 'border-[#1A6B1A] bg-[#E8F5E8]'
              : 'border-gray-200 hover:border-gray-300'}
          `}>
          <span className="text-xl block mb-1">{opt.emoji}</span>
          <p className="text-xs font-semibold text-gray-800">{opt.label}</p>
          <p className="text-[10px] text-gray-400">{opt.desc}</p>
          {value === opt.value && (
            <div className="flex items-center gap-1 text-[#1A6B1A] text-[10px] font-semibold mt-1">
              <Check size={10} /> Sélectionné
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
```

### 3.5 Modal de confirmation du transfert

```tsx
function TransferConfirmModal({ open, onClose, onConfirm, data }: Props) {
  const { selectedContributions, receiver, transferType, senderNote, totalAmount } = data

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md rounded-[24px] p-0 overflow-hidden">

        {/* Header vert */}
        <div className="bg-gradient-to-r from-[#0F4A0F] to-[#1A6B1A] px-6 py-5 cross-bg">
          <h2 className="font-display text-xl font-bold text-white mb-1">Confirmer le transfert</h2>
          <p className="text-white/60 text-sm">Cette action est traçable et auditable</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Montant en gros */}
          <div className="text-center py-2">
            <p className="font-display font-bold text-4xl text-[#0F4A0F]">
              {formatAmount(totalAmount)}
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {selectedContributions.length} contribution{selectedContributions.length > 1 ? 's' : ''}
            </p>
          </div>

          {/* De → Vers */}
          <div className="flex items-center gap-3 bg-gray-50 rounded-[14px] p-4">
            <div className="flex-1 text-center">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">De</p>
              <div className="w-10 h-10 bg-[#F5C400] rounded-[10px] flex items-center justify-center text-sm font-bold text-[#0F4A0F] mx-auto mb-1">
                {getInitials(currentUser.fullName)}
              </div>
              <p className="text-xs font-semibold text-gray-700">{currentUser.firstName}</p>
              <p className="text-[10px] text-gray-400">{roleLabel[currentUser.role]}</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ArrowRight size={20} className="text-[#1A6B1A]" />
              <span className="text-[10px] text-gray-400">{transferTypeLabel[transferType]}</span>
            </div>
            <div className="flex-1 text-center">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Vers</p>
              <div className="w-10 h-10 bg-[#1A6B1A] rounded-[10px] flex items-center justify-center text-sm font-bold text-white mx-auto mb-1">
                {getInitials(receiver.fullName)}
              </div>
              <p className="text-xs font-semibold text-gray-700">{receiver.firstName}</p>
              <p className="text-[10px] text-gray-400">{roleLabel[receiver.role]}</p>
            </div>
          </div>

          {/* Notice importante */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-[12px] p-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">En attente de validation</p>
              <p className="text-[11px] text-amber-600 mt-0.5">
                <strong>{receiver.firstName}</strong> devra confirmer la réception dans l'application.
                Les fonds restent affichés "En transit" jusqu'à sa confirmation.
              </p>
            </div>
          </div>

          {/* Note de l'expéditeur */}
          {senderNote && (
            <div className="bg-gray-50 rounded-[12px] p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Note</p>
              <p className="text-xs text-gray-700">{senderNote}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <Button variant="outline" onClick={onClose} className="flex-1">Annuler</Button>
          <Button variant="primary" onClick={onConfirm} className="flex-1">
            <ArrowRight size={15} /> Confirmer le transfert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

---

## 4. NOUVELLE PAGE — "Validations" (validations/page.tsx)

```tsx
// Page dédiée pour que le récepteur valide les transferts en attente
// Accessible depuis la sidebar (menu "Validations")
// Badge rouge sur l'item sidebar si transferts en attente

export default function ValidationsPage() {
  const { data: pendingTransfers, isLoading, refetch } = useQuery({
    queryKey: ['pending-my-approval'],
    queryFn: () => api.get('/funds/transfers/pending-my-approval').then(r => r.data),
    refetchInterval: 30000, // Poll toutes les 30s
  })

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-page">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-semibold text-gray-900">Validations en attente</h1>
        <p className="text-gray-500 text-sm mt-1">
          Transferts de fonds qui vous sont adressés et nécessitent votre confirmation
        </p>
      </div>

      {/* Badge count */}
      {pendingTransfers?.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-[16px] p-4">
          <div className="w-10 h-10 bg-amber-100 rounded-[10px] flex items-center justify-center">
            <Clock size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="font-semibold text-amber-900 text-sm">
              {pendingTransfers.length} transfert{pendingTransfers.length > 1 ? 's' : ''} en attente de votre validation
            </p>
            <p className="text-amber-600 text-xs">Confirmez la réception pour finaliser la traçabilité</p>
          </div>
        </div>
      )}

      {/* Liste des transferts en attente */}
      {isLoading ? (
        <div className="space-y-4">
          {[1,2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : pendingTransfers?.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Aucune validation en attente"
          description="Tous les transferts qui vous sont adressés ont été traités"
        />
      ) : (
        <div className="space-y-4">
          {pendingTransfers.map(transfer => (
            <TransferValidationCard
              key={transfer.id}
              transfer={transfer}
              onConfirm={() => handleConfirm(transfer.id)}
              onRefuse={(reason) => handleRefuse(transfer.id, reason)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Card de validation ──────────────────────────────────────────────────────

function TransferValidationCard({ transfer, onConfirm, onRefuse }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showRefuseModal, setShowRefuseModal] = useState(false)
  const [refuseReason, setRefuseReason] = useState('')
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="bg-white rounded-[18px] border-2 border-amber-200 overflow-hidden
      shadow-[0_4px_20px_rgba(245,158,11,0.08)]">

      {/* Header jaune */}
      <div className="bg-amber-50 border-b border-amber-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Avatar expéditeur */}
            <div className="w-10 h-10 bg-[#F5C400] rounded-[10px] flex items-center justify-center font-bold text-sm text-[#0F4A0F] flex-shrink-0">
              {getInitials(transfer.senderName)}
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">{transfer.senderName}</p>
              <p className="text-xs text-gray-500">{roleLabel[transfer.senderRole]} · {timeAgo(transfer.createdAt)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-display font-bold text-xl text-[#0F4A0F]">{formatAmount(transfer.totalAmount)}</p>
            <p className="text-xs text-gray-400">{transfer.contributions.length} contribution{transfer.contributions.length > 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Détails */}
      <div className="px-5 py-4 space-y-3">

        {/* Mode de transfert */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="text-base">{transferTypeEmoji[transfer.transferType]}</span>
          <span>{transferTypeLabel[transfer.transferType]}</span>
        </div>

        {/* Note de l'expéditeur */}
        {transfer.senderNote && (
          <div className="bg-gray-50 rounded-[10px] p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Note de {transfer.senderName}</p>
            <p className="text-xs text-gray-700 italic">"{transfer.senderNote}"</p>
          </div>
        )}

        {/* Liste des contributions — accordéon */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs font-medium text-[#1A6B1A] hover:underline">
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Masquer' : 'Voir'} le détail des {transfer.contributions.length} contributions
        </button>

        {expanded && (
          <div className="border border-gray-100 rounded-[12px] overflow-hidden divide-y divide-gray-50 animate-slide-up">
            {transfer.contributions.map((c, i) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-gray-800">{c.payerName}</p>
                  <p className="text-[11px] text-gray-400">{c.rubriqueCode} · {c.paymentMethodLabel}</p>
                </div>
                <span className="font-mono text-sm font-bold text-[#1A6B1A]">{formatAmount(c.amount)}</span>
              </div>
            ))}
            {/* Total */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#E8F5E8]">
              <span className="text-xs font-bold text-[#1A6B1A]">TOTAL</span>
              <span className="font-mono text-sm font-bold text-[#0F4A0F]">{formatAmount(transfer.totalAmount)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
        <button
          onClick={() => setShowRefuseModal(true)}
          className="flex-1 py-2.5 text-sm font-semibold text-red-600 border-2 border-red-200 rounded-[10px]
            hover:bg-red-50 hover:border-red-300 active:scale-[0.97] transition-all flex items-center justify-center gap-2">
          <XCircle size={16} /> Refuser
        </button>
        <button
          onClick={async () => { setConfirming(true); await onConfirm(); setConfirming(false) }}
          disabled={confirming}
          className="flex-1 py-2.5 text-sm font-bold text-white bg-[#1A6B1A] rounded-[10px]
            shadow-cem hover:bg-[#0F4A0F] active:scale-[0.97]
            disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {confirming ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          Confirmer la réception
        </button>
      </div>

      {/* Modal de refus */}
      {showRefuseModal && (
        <RefuseTransferModal
          transfer={transfer}
          onClose={() => setShowRefuseModal(false)}
          onConfirm={async (reason) => {
            await onRefuse(reason)
            setShowRefuseModal(false)
          }}
        />
      )}
    </div>
  )
}

// ── Modal de refus avec motif obligatoire ──────────────────────────────────

function RefuseTransferModal({ transfer, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm rounded-[20px] p-0 overflow-hidden">
        <div className="bg-red-50 border-b border-red-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <XCircle size={18} className="text-red-500" />
            <h3 className="font-semibold text-red-900">Refuser le transfert</h3>
          </div>
          <p className="text-red-600 text-xs mt-1">
            {formatAmount(transfer.totalAmount)} de {transfer.senderName}
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-2">
              Motif du refus <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ex : Je n'ai pas reçu cet argent en main, contacter l'expéditeur..."
              rows={3}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-[10px] resize-none
                focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-all"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Ce motif sera communiqué à {transfer.senderName} et visible par le Trésorier
            </p>
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose} className="flex-1">Annuler</Button>
          <Button
            variant="danger"
            onClick={async () => { setLoading(true); await onConfirm(reason) }}
            loading={loading}
            disabled={reason.trim().length < 10}
            className="flex-1">
            Confirmer le refus
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

---

## 5. VUE COLLECTEUR vs VUE ADMIN

```typescript
// La page funds/page.tsx doit adapter son contenu selon le rôle

// Trésorier / Admin → Vue globale
//   - Voit TOUS les collecteurs et leurs fonds
//   - Voit le pipeline complet avec tous les montants
//   - Peut voir les transferts de tous
//   - Peut initier un transfert au nom de n'importe qui (si Admin)

// Collecteur → Vue personnelle
//   - Voit UNIQUEMENT ses propres contributions et fonds
//   - Le pipeline ne montre que ses propres montants
//   - Peut initier un transfert uniquement avec SES propres contributions
//   - Reçoit les notifications des transferts qui lui sont adressés
//   - Accède à la page "Validations" pour confirmer/refuser

// Responsable / Adjoint → Vue intermédiaire
//   - Voit les contributions de ses membres assignés
//   - Peut recevoir des transferts (et les confirmer)
//   - Peut transférer vers le Trésorier

// Implémentation :
const canSeeAll = ['ADMIN', 'TRESORIER'].includes(user.role)
const canInitiateTransfer = ['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR'].includes(user.role)
const targetCollectorId = canSeeAll ? undefined : user.id  // Filtre API automatique
```

---

## 6. NOUVELLES RÈGLES MÉTIER À RESPECTER

```typescript
// RB-23 : Seul le récepteur peut confirmer un transfert
//   → Vérification : transfer.receiverId === req.user.id
//   → HTTP 403 si violation

// RB-24 : confirmedAt positionné uniquement par le serveur lors de la confirmation
//   → Jamais côté client, jamais dans le body de la requête
//   → Identique à RB-01 pour createdAt

// RB-25 : Un transfert CONFIRMED est immuable
//   → Aucune modification possible après confirmation
//   → Soft-delete uniquement via audit

// RB-26 : Le récepteur doit être de niveau >= COLLECTEUR
//   → Un MEMBRE ordinaire ne peut pas recevoir un transfert
//   → Vérification côté API dans getEligibleReceivers()

// RB-27 : Les contributions EN_TRANSIT ne peuvent pas être retransférées
//   → Tant que fundsLocation = EN_TRANSIT, contributions exclues des futures sélections
//   → Seulement CHEZ_COLLECTEUR est sélectionnable pour un nouveau transfert

// RB-28 : Motif de refus obligatoire (min 10 caractères)
//   → Validation Zod côté API + UI désactivée si < 10 caractères

// RB-29 : Un transfert PENDING peut être annulé uniquement par l'expéditeur
//   → Avant que le récepteur ait confirmé ou refusé
//   → Retour automatique des contributions en CHEZ_COLLECTEUR
```

---

## 7. NOTIFICATIONS À IMPLÉMENTER

```typescript
// Templates WhatsApp à créer dans 360Dialog

// cem_transfer_initiated (au récepteur)
// "Bonjour {{receiverName}},
//  {{senderName}} vous a transféré {{totalAmount}} FCFA ({{count}} contribution(s))
//  via {{transferType}}.
//  Ouvrez l'application SGM-CEM pour confirmer la réception :
//  👉 {{appUrl}}/validations
//  Transfert ID : {{transferId}}"

// cem_transfer_confirmed (à l'expéditeur)
// "Votre transfert de {{totalAmount}} FCFA a été confirmé par {{receiverName}}.
//  Bordereau disponible : {{borderauUrl}}"

// cem_transfer_refused (à l'expéditeur + alerte Trésorier)
// "{{receiverName}} a refusé votre transfert de {{totalAmount}} FCFA.
//  Motif : {{refusalReason}}
//  Les fonds sont de nouveau affichés comme étant chez vous."

// cem_transfer_reminder (au récepteur, après délai configuré)
// "Rappel : vous avez un transfert de {{totalAmount}} FCFA en attente de votre validation.
//  Expéditeur : {{senderName}} · Depuis : {{timeAgo}}
//  👉 {{appUrl}}/validations"
```

---

## 8. MISE À JOUR DU CLAUDE.md

**APRÈS avoir terminé tout le code**, mets à jour le fichier `CLAUDE.md` avec les sections suivantes :

### Sections à ajouter/modifier dans CLAUDE.md

```markdown
## [SECTION MODÈLE DE DONNÉES] — Modifier FundsHandover → FundsTransfer
Remplacer le modèle FundsHandover par le nouveau modèle FundsTransfer
(voir schéma Prisma complet dans le code)

## [SECTION ENUMS] — Ajouter les nouveaux enums
- FundsLocation : ajouter EN_TRANSIT, CHEZ_RESPONSABLE, EN_CAISSE, EN_BANQUE
- FundsTransferStatus : PENDING_APPROVAL | CONFIRMED | REFUSED | CANCELLED
- TransferType : ESPECES_EN_MAIN | DEPOT_MTN | DEPOT_ORANGE | AUTRE

## [SECTION API ENDPOINTS] — Ajouter les nouveaux endpoints
GET  /api/funds/overview
GET  /api/funds/contributions
GET  /api/funds/eligible-receivers
POST /api/funds/transfer
GET  /api/funds/transfers
GET  /api/funds/transfers/pending-my-approval
PATCH /api/funds/transfers/:id/confirm
PATCH /api/funds/transfers/:id/refuse
PATCH /api/funds/transfers/:id/cancel

## [SECTION RÈGLES MÉTIER] — Ajouter RB-23 à RB-29
(voir section 6 de ce prompt)

## [SECTION ROUTES NEXT.JS] — Ajouter
validations/page.tsx → Page de validation des transferts reçus

## [SECTION NOTIFICATIONS] — Ajouter les 4 nouveaux templates
cem_transfer_initiated | cem_transfer_confirmed | cem_transfer_refused | cem_transfer_reminder

## [SECTION FLOW FONDS COLLECTEURS] — Documenter le flow complet
(voir sections 1 à 8 de ce prompt — flow en 7 étapes)
```

---

## CHECKLIST FINALE

Avant de marquer la tâche terminée :

- [ ] Migration Prisma créée et appliquée (`FundsTransfer` remplace `FundsHandover`)
- [ ] Endpoints API implémentés avec RBAC vérifié côté serveur
- [ ] Drawer détail contribution fonctionnel
- [ ] ReceiverSelector avec groupes par rôle (Collecteurs / Responsables / Trésorier+Admin)
- [ ] TransferTypeSelector (4 modes : main / MTN / Orange / Autre)
- [ ] Modal de confirmation avec notice "en attente de validation"
- [ ] Page `validations/page.tsx` avec TransferValidationCard
- [ ] Modal de refus avec motif obligatoire (min 10 caractères)
- [ ] Flow côté récepteur testé (confirmer + refuser + annuler)
- [ ] Adaptations vue Collecteur vs Admin (filtre automatique par rôle)
- [ ] Notifications WhatsApp + In-app implémentées
- [ ] Badge "Validations" dans la sidebar si pendingCount > 0
- [ ] Règles RB-23 à RB-29 respectées côté serveur
- [ ] Pipeline "Trajet de l'argent" mis à jour avec le statut EN_TRANSIT
- [ ] **CLAUDE.md mis à jour** avec toutes les nouvelles specs

---

*Prompt Feature — SGM-CEM v4.2*
*Module : Fonds Collecteurs — Transfert avec Validation Récepteur*
*Culte d'Enfants de Melen · EEC Melen · Yaoundé, Cameroun*
