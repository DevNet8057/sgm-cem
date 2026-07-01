type S =
  | 'EN_OBSERVATION' | 'EN_SUIVI' | 'FIN_DE_SUIVI' | 'DIASPORA'
  | 'CONFIRME' | 'EN_ATTENTE_CONFIRMATION' | 'LITIGE' | 'ANNULE'
  | 'OUVERTE' | 'FERMEE' | 'ARCHIVEE' | 'URGENT' | 'PRIORITAIRE'
  | 'BROUILLON' | 'EN_ATTENTE' | 'APPROUVE' | 'REJETE' | 'ARCHIVE'
  | 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'

// Colors aligned with the semantic palette from design system A1
const STYLE: Record<S, string> = {
  // Statuts de contribution
  CONFIRME:                'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]',
  EN_ATTENTE_CONFIRMATION: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]',
  LITIGE:                  'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]',
  ANNULE:                  'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]',
  // Statuts de rubrique
  OUVERTE:                 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]',
  FERMEE:                  'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]',
  ARCHIVEE:                'bg-[#F8FAFC] text-[#94A3B8] border-[#E2E8F0]',
  ARCHIVE:                 'bg-[#F8FAFC] text-[#94A3B8] border-[#E2E8F0]',
  // Priorités
  URGENT:                  'bg-[#FEF2F2] text-[#7F1D1D] border-[#FCA5A5] animate-[urgence-pulse_2s_ease-in-out_infinite]',
  PRIORITAIRE:             'bg-[#FFFBEB] text-[#78350F] border-[#FCD34D]',
  // Statuts de membre
  EN_OBSERVATION:          'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]',
  EN_SUIVI:                'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]',
  FIN_DE_SUIVI:            'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]',
  DIASPORA:                'bg-[#FAF5FF] text-[#5B21B6] border-[#DDD6FE]',
  // Statuts de documents GED
  BROUILLON:               'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]',
  EN_ATTENTE:              'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]',
  APPROUVE:                'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]',
  REJETE:                  'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]',
  // Rôles utilisateurs
  ADMIN:               'bg-[#F3F0FF] text-[#4C1D95] border-[#DDD6FE]',
  TRESORIER:           'bg-[#0F4A0F]  text-[#F5C400] border-[#1A6B1A]',
  RESPONSABLE:         'bg-[#EFF6FF]  text-[#1E40AF] border-[#BFDBFE]',
  ADJOINT_RESPONSABLE: 'bg-[#E0F2FE]  text-[#075985] border-[#BAE6FD]',
  COLLECTEUR:          'bg-[#FEF9C3]  text-[#713F12] border-[#FDE68A]',
  MEMBRE:              'bg-[#F8FAFC]  text-[#334155] border-[#CBD5E1]',
}

const LABEL: Record<S, string> = {
  EN_OBSERVATION: 'En Observation', EN_SUIVI: 'En Suivi', FIN_DE_SUIVI: 'Fin de Suivi',
  DIASPORA: 'Diaspora', CONFIRME: 'Confirmé', EN_ATTENTE_CONFIRMATION: 'En attente',
  LITIGE: 'Litige', ANNULE: 'Annulé', OUVERTE: 'Ouverte', FERMEE: 'Fermée',
  ARCHIVEE: 'Archivée', ARCHIVE: 'Archivé',
  URGENT: 'URGENT', PRIORITAIRE: 'PRIORITAIRE',
  BROUILLON: 'Brouillon', EN_ATTENTE: 'En attente', APPROUVE: 'Approuvé', REJETE: 'Rejeté',
  ADMIN: 'Administrateur', TRESORIER: 'Trésorier', RESPONSABLE: 'Responsable',
  ADJOINT_RESPONSABLE: 'Adjoint Resp.', COLLECTEUR: 'Collecteur', MEMBRE: 'Membre',
}

export function StatusBadge({ status, dot = true }: { status: S; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${STYLE[status]}`}>
      {dot && !['URGENT', 'PRIORITAIRE'].includes(status) && (
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 flex-shrink-0" />
      )}
      {LABEL[status]}
    </span>
  )
}
