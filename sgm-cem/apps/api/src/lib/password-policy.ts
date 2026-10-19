// Règles des mots de passe choisis (ENF sécurité) : 10 caractères au moins,
// lettres et chiffres, pas un mot de passe courant ni l'adresse e-mail du compte.
import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 10

// Mots de passe parmi les plus essayés, et ceux propres à la communauté
const COMMON = new Set([
  'password', 'password1', 'password123', 'motdepasse', 'motdepasse1', 'azerty', 'azerty123', 'azertyuiop',
  'qwerty', 'qwerty123', 'qwertyuiop', '123456789', '1234567890', '12345678910', '0123456789', '1111111111',
  'abcdefghij', 'abc1234567', 'iloveyou', 'bonjour123', 'soleil123', 'jesus123', 'jesuschrist', 'dieuestbon',
  'dieuestamour', 'gloireadieu', 'amen123456', 'eglise123', 'cameroun', 'cameroun123', 'yaounde', 'yaounde123',
  'douala123', 'melen123', 'cemmelen', 'cemmelen123', 'sgmcem', 'sgmcem123', 'sgm-cem123', 'admin123', 'admin12345',
  'administrateur', 'tresorier', 'collecteur', 'welcome123', 'bienvenue', 'bienvenue1',
])

function normalize(p: string): string {
  return p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Raison du refus, ou null si le mot de passe est acceptable. */
export function passwordProblem(password: string, context: { email?: string | null } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`
  if (password.length > 128) return 'Le mot de passe ne doit pas dépasser 128 caractères'
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/[0-9]/.test(password)) return 'Le mot de passe doit contenir des lettres et des chiffres'
  if (/^(.)\1+$/.test(password)) return 'Le mot de passe ne doit pas répéter un seul caractère'
  const n = normalize(password)
  if (COMMON.has(n) || COMMON.has(n.replace(/[^a-z0-9]/g, ''))) return 'Ce mot de passe est trop courant : choisissez-en un autre'
  const local = context.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && n.includes(normalize(local))) return 'Le mot de passe ne doit pas contenir votre adresse e-mail'
  return null
}

/** Schéma Zod d'un mot de passe choisi (sans contexte de compte). */
export const passwordSchema = z.string().superRefine((p, ctx) => {
  const problem = passwordProblem(p)
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
})
