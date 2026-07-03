export type UserRole = 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'

export interface User {
  id: string
  memberId?: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone?: string
  whatsappPhone?: string
  photoUrl?: string
  role: UserRole
  isActive?: boolean
  mustChangePassword?: boolean
  notificationToken?: string
  lastLoginAt?: string
  createdAt?: string
}

export type MembreCategorie = 'MCE_EN_SERVICE' | 'ENFANTS' | 'DIASPORA'
export type MembreGroupe = 'TEMPLE' | 'MVOG_BETSI' | 'BISCUITERIE' | 'OBILI' | 'SCIENCES' | 'POLYTECHNIQUE'
export type MembreStatut = 'EN_OBSERVATION' | 'EN_SUIVI' | 'FIN_DE_SUIVI' | 'DIASPORA'
export type ProfilFinancier = 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE'

export interface Membre {
  id: string
  userId: string
  memberId: string
  categorie: MembreCategorie
  groupe: MembreGroupe
  statut: MembreStatut
  profilFinancier: ProfilFinancier
  phone?: string
  phoneWhatsapp?: string
  email?: string
  adresse?: string
  profession?: string
  dateAdhesion: string
  dateNaissance?: string
  isActive: boolean
  notes?: string
  user: { fullName: string; email: string; role: UserRole }
}

export type RubriqueType = 'REGULIERE_MENSUELLE' | 'PONCTUELLE' | 'URGENTE'
export type RubriquePriority = 'NORMAL' | 'PRIORITAIRE' | 'URGENT'
export type RubriqueStatut = 'OUVERTE' | 'FERMEE' | 'ARCHIVEE'

export interface Rubrique {
  id: string
  code: string
  title: string
  description?: string
  type: RubriqueType
  priority: RubriquePriority
  status: RubriqueStatut
  fiscalYear: number
  openDate: string
  closeDate?: string
  amountTravailleur?: number
  amountEtudiant?: number
  amountCouple?: number
  targetAmount?: number
  targetAll: boolean
  totalCollecte?: number
  nbContributions?: number
  createdAt: string
}

export type ContributionStatut = 'EN_ATTENTE_CONFIRMATION' | 'CONFIRME' | 'LITIGE' | 'ANNULE'
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'
export type ModePaiement = 'ESPECES' | 'MTN_MOMO' | 'ORANGE_MONEY' | 'YELII' | 'CARTE_VISA' | 'VIREMENT'
export type LocalisationFonds = 'CHEZ_COLLECTEUR' | 'EN_TRANSIT' | 'CHEZ_RESPONSABLE' | 'REMIS_TRESORIER' | 'EN_CAISSE' | 'EN_BANQUE'
export type TransferType = 'ESPECES_EN_MAIN' | 'DEPOT_MTN' | 'DEPOT_ORANGE' | 'AUTRE'
export type FundsTransferStatus = 'PENDING_APPROVAL' | 'CONFIRMED' | 'REFUSED' | 'CANCELLED'

export interface Contribution {
  id: string
  membreId: string
  rubriqueId: string
  collecteurId?: string
  montant: number
  montantAttendu?: number
  modePaiement: ModePaiement
  statut: ContributionStatut
  localisationFonds?: LocalisationFonds
  periodeLabel?: string
  referencePaiement?: string
  litigeMotif?: string
  confirmedAt?: string
  receiptUrl?: string
  proofUrl?: string
  proofUploadedAt?: string
  transferId?: string
  paymentStatus?: PaymentStatus
  externalTransactionId?: string
  netAmount?: number
  paymentUrl?: string
  createdAt: string
  membre?: { user: { fullName: string } }
  rubrique?: { title: string; code: string }
  collecteur?: { fullName: string }
  fundsTransfer?: FundsTransfer
}

export interface FundsTransfer {
  id: string
  createdAt: string
  confirmedAt?: string
  refusedAt?: string
  cancelledAt?: string
  senderId: string
  senderName: string
  receiverId: string
  receiverName: string
  totalAmount: number
  transferType: TransferType
  status: FundsTransferStatus
  senderNote?: string
  refusalReason?: string
  borderauUrl?: string
  remindersSentCount: number
  lastReminderSentAt?: string
  contributions: Contribution[]
  sender?: { role: UserRole }
  receiver?: { role: UserRole }
}

export interface CollecteurSummary {
  collecteurId: string
  collecteurName: string
  collecteurEmail?: string
  totalChezCollecteur: number
  totalEnTransit: number
  totalARemettre: number
  nbContributions: number
  nbEnRetard: number
  oldestContributionAt?: string
}

export interface CollecteursResponse {
  summary: CollecteurSummary[]
  contributions: Contribution[]
  totals: {
    totalARemettre: number
    totalContributions: number
    totalEnRetard: number
    maxRetentionDays: number
  }
  flow: {
    chezCollecteur: number
    enTransit: number
    chezResponsable: number
    remisTresorier: number
    enCaisse: number
    enBanque: number
    totalConfirme: number
    especesTotal: number
    electroniqueTotal: number
  }
  eligibleRecipients: Array<{ id: string; fullName: string; email: string; role: string }>
  myRole?: UserRole
  pendingValidations?: number
}

export interface Commission {
  id: string
  nom: string
  description?: string
  responsableId: string
  isActive: boolean
  _count?: { documents: number }
}

export type DocumentStatut = 'BROUILLON' | 'EN_ATTENTE' | 'APPROUVE' | 'REJETE' | 'ARCHIVE'

export interface Document {
  id: string
  commissionId: string
  typeCode: string
  titre: string
  description?: string
  fileName: string
  fileSize: number
  mimeType: string
  s3Key?: string
  s3Bucket?: string
  statut: DocumentStatut
  version: number
  uploadedById: string
  approvedById?: string
  approvedAt?: string
  rejectedById?: string
  rejectedAt?: string
  rejetMotif?: string
  expiresAt?: string
  tags: string[]
  createdAt: string
  commission?: { nom: string }
  typeDocument?: { libelle: string }
  uploadedBy?: { fullName: string }
}

export interface TypeDocument {
  code: string
  libelle: string
  retentionAnnees: number
}

export type PrestationStatut = 'EN_PREPARATION' | 'EN_COURS' | 'ENTREES_COMPLETES' | 'COMMISSION_VERSEE' | 'CLOTURE'

export interface Prestation {
  id: string
  reference: string
  titre: string
  description?: string
  commanditaire: string
  commanditairePhone?: string
  statut: PrestationStatut
  tarifBase: number
  rabaisCommanditaire: number
  rabaisPercent: number
  tarifFinal: number
  acompte: number
  solde: number
  totalEntrees: number
  totalCours: number
  commission?: number
  commissionPercent: number
  dateEvenement?: string
  lieu?: string
  notes?: string
  createdAt: string
  cours?: CoursPrestation[]
  entrees?: EntreePrestation[]
}

export interface CoursPrestation {
  id: string
  prestationId: string
  libelle: string
  montant: number
  justificatif?: string
  createdAt: string
}

export interface EntreePrestation {
  id: string
  prestationId: string
  libelle: string
  montant: number
  modePaiement: ModePaiement
  reference?: string
  createdAt: string
}

export interface Notification {
  id: string
  title: string
  body: string
  type: string
  data?: Record<string, unknown>
  isRead: boolean
  statut?: 'PENDING' | 'SENT' | 'FAILED'
  sentAt?: string
  createdAt: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; field?: string }
  pagination?: { page: number; limit: number; total: number; totalPages: number }
}

export interface DashboardStats {
  year: number
  totalMembres: number
  membresEnRetard: number
  pendingConfirmations: number
  litiges: number
  totalCollectedMonth: number
  totalCollectedYear: number
  totalConfirmedContributions: number
  globalConfirmationRate: number
  contributionStatus: {
    confirmed: number
    pending: number
    litiges: number
    total: number
  }
  mostUsedPaymentMode: null | {
    modePaiement: ModePaiement
    total: number
    count: number
    share: number
  }
  topContributor: null | {
    membreId: string
    fullName: string
    total: number
    count: number
  }
  topContributors: Array<{
    membreId: string
    fullName: string
    total: number
    count: number
  }>
  modePaiementStats: Array<{
    modePaiement: ModePaiement
    total: number
    count: number
    share: number
  }>
  contributionRates: Array<{
    rubriqueId: string
    code: string
    title: string
    targetAmount?: number
    total: number
    count: number
    rate: number | null
  }>
  recentContributions: Contribution[]
  rubriquesActives: Rubrique[]
}

export interface SystemSettings {
  id: string
  defaultIncreaseRate: number
  etudiantRatio: number
  coupleRatio: number
  inactivityMonthsThreshold: number
  reminderDelayDays: number
  maxFundsRetentionDays: number
  transferPendingReminderHours: number
  transferAlertTresorierHours: number
  communityName: string
  communityVerse: string
  updatedAt: string
}

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'
export interface ToastOptions {
  title: string
  message?: string
  variant?: ToastVariant
  duration?: number
}
