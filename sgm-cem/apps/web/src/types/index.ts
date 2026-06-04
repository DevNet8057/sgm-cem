export type UserRole = 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'

export interface User {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  role: UserRole
  lastLoginAt?: string
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
export type ModePaiement = 'ESPECES' | 'MTN_MOMO' | 'ORANGE_MONEY' | 'CARTE_VISA' | 'VIREMENT'
export type LocalisationFonds = 'CHEZ_COLLECTEUR' | 'CAISSE_PRINCIPALE' | 'BANQUE' | 'EN_TRANSIT'

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
  createdAt: string
  membre?: { user: { fullName: string } }
  rubrique?: { title: string; code: string }
  collecteur?: { fullName: string }
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
  fileName: string
  fileSize: number
  mimeType: string
  statut: DocumentStatut
  version: number
  uploadedById: string
  createdAt: string
  typeDocument?: { libelle: string }
  uploadedBy?: { fullName: string }
}

export type PrestationStatut = 'EN_PREPARATION' | 'EN_COURS' | 'ENTREES_COMPLETES' | 'COMMISSION_VERSEE' | 'CLOTURE'

export interface Prestation {
  id: string
  reference: string
  titre: string
  commanditaire: string
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
  createdAt: string
}

export interface Notification {
  id: string
  title: string
  body: string
  type: string
  isRead: boolean
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

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'
export interface ToastOptions {
  title: string
  message?: string
  variant?: ToastVariant
  duration?: number
}
