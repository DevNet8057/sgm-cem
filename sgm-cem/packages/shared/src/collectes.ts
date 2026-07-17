// ──────────────────────────────────────────────────────────────────────
// COLLECTES PUBLIQUES — types partagés api/web
// Types purs (aucune dépendance) : la validation Zod dynamique construite
// depuis champsPersonnalises vit côté API (services/collecte.service.ts).
// ──────────────────────────────────────────────────────────────────────

export type ChampPersonnaliseType = 'text' | 'number' | 'select' | 'date' | 'checkbox'

/** Champ défini par l'admin lors de la création d'une collecte (symptôme 2). */
export interface ChampPersonnalise {
  key: string
  label: string
  type: ChampPersonnaliseType
  required: boolean
  /** Pour type 'select' : valeurs proposées. */
  options?: string[]
}

/** Définition PUBLIQUE d'une collecte — ce que voit un visiteur non authentifié. */
export interface CollectePubliqueDef {
  publicSlug: string
  titre: string
  description: string | null
  champsPersonnalises: ChampPersonnalise[]
  montantMin: number | null
  montantsSuggeres: number[]
}

/** Identité minimale d'un contributeur non-membre (collecte publique). */
export interface ContributeurExterneInfo {
  nom: string
  phone: string
  email?: string | null
}
