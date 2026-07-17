// ──────────────────────────────────────────────────────────────────────
// SERVICE COLLECTES PUBLIQUES — champs dynamiques, tokens de brouillon, slugs
//
// Une CollectePublique expose une Rubrique au public via un lien ; les champs
// personnalisés définis par l'admin (Json) sont validés par un schéma Zod
// construit À LA VOLÉE au moment de la soumission (jamais figé au chargement).
//
// Sécurité brouillons (symptôme 4 du besoin) : le token de reprise fait
// 32 octets aléatoires, remis UNE seule fois au navigateur ; la base ne
// stocke que son sha256 — une fuite de base ne permet pas de reprendre
// les brouillons d'autrui.
// ──────────────────────────────────────────────────────────────────────
import crypto from 'crypto'
import { z } from 'zod'

export interface ChampPersonnalise {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'date' | 'checkbox'
  required: boolean
  options?: string[]
}

/**
 * Construit le schéma Zod des valeurs de champs personnalisés d'une collecte.
 * `.strict()` : toute clé inconnue est rejetée (pas d'injection de données).
 */
export function buildDynamicSchema(champs: ChampPersonnalise[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const champ of champs) {
    let schema: z.ZodTypeAny
    switch (champ.type) {
      case 'number':
        schema = z.coerce.number().int()
        break
      case 'select':
        schema = champ.options && champ.options.length > 0
          ? z.enum(champ.options as [string, ...string[]])
          : z.string().max(500)
        break
      case 'date':
        // Format AAAA-MM-JJ (input type="date" côté web)
        schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
        break
      case 'checkbox':
        schema = z.coerce.boolean()
        break
      case 'text':
      default:
        schema = z.string().min(1).max(500)
        break
    }
    shape[champ.key] = champ.required ? schema : schema.optional()
  }
  return z.object(shape).strict()
}

/** Token de reprise de brouillon — 32 octets aléatoires, hex (64 caractères). */
export function generateDraftToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** Seul le hash du token est persisté (colonne CollecteDraft.tokenHash). */
export function hashDraftToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Normalise un téléphone camerounais vers E.164 (+237XXXXXXXXX).
 * Même logique que le flux OTP (routes/auth.ts) : chiffres seuls, préfixe 237.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('237') ? `+${digits}` : `+237${digits}`
}

/**
 * Slug public d'une collecte : titre slugifié (accents retirés, minuscules,
 * tronqué à 40 caractères) + suffixe aléatoire de 4 caractères pour rendre
 * l'URL non devinable même à titre identique.
 * Ex. « Obsèques Mama Marie » → "obseques-mama-marie-x7k2"
 */
export function generatePublicSlug(titre: string): string {
  const base = titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // accents (diacritiques combinants après NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  const suffix = crypto.randomBytes(3).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, '0')
  return `${base || 'collecte'}-${suffix}`
}
