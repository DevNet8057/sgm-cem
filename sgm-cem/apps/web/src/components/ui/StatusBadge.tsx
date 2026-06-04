type S =
  | 'EN_OBSERVATION' | 'EN_SUIVI' | 'FIN_DE_SUIVI' | 'DIASPORA'
  | 'CONFIRME' | 'EN_ATTENTE_CONFIRMATION' | 'LITIGE' | 'ANNULE'
  | 'OUVERTE' | 'FERMEE' | 'ARCHIVEE' | 'URGENT' | 'PRIORITAIRE'
  | 'BROUILLON' | 'EN_ATTENTE' | 'APPROUVE' | 'REJETE' | 'ARCHIVE'
  | 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'

const STYLE: Record<S, string> = {
  EN_OBSERVATION:          'bg-amber-100   text-amber-800   border-amber-200',
  EN_SUIVI:                'bg-blue-100    text-blue-800    border-blue-200',
  FIN_DE_SUIVI:            'bg-green-100   text-green-800   border-green-200',
  DIASPORA:                'bg-purple-100  text-purple-800  border-purple-200',
  CONFIRME:                'bg-emerald-100 text-emerald-800 border-emerald-200',
  EN_ATTENTE_CONFIRMATION: 'bg-yellow-100  text-yellow-800  border-yellow-200',
  LITIGE:                  'bg-red-100     text-red-700     border-red-200',
  ANNULE:                  'bg-gray-100    text-gray-600    border-gray-200',
  OUVERTE:                 'bg-green-100   text-green-800   border-green-200',
  FERMEE:                  'bg-gray-100    text-gray-600    border-gray-200',
  ARCHIVEE:                'bg-gray-100    text-gray-500    border-gray-200',
  ARCHIVE:                 'bg-gray-100    text-gray-500    border-gray-200',
  URGENT:                  'bg-red-500     text-white       border-red-500',
  PRIORITAIRE:             'bg-orange-500  text-white       border-orange-500',
  BROUILLON:               'bg-gray-100    text-gray-600    border-gray-200',
  EN_ATTENTE:              'bg-yellow-100  text-yellow-800  border-yellow-200',
  APPROUVE:                'bg-emerald-100 text-emerald-800 border-emerald-200',
  REJETE:                  'bg-red-100     text-red-700     border-red-200',
  ADMIN:               'bg-violet-600 text-white border-violet-600',
  TRESORIER:           'bg-[#0F4A0F]  text-[#F5C400] border-[#0F4A0F]',
  RESPONSABLE:         'bg-blue-600   text-white border-blue-600',
  ADJOINT_RESPONSABLE: 'bg-sky-500    text-white border-sky-500',
  COLLECTEUR:          'bg-[#F5C400]  text-[#0F4A0F] border-[#D4A800]',
  MEMBRE:              'bg-gray-200   text-gray-700 border-gray-300',
}

const LABEL: Record<S, string> = {
  EN_OBSERVATION: 'En Observation', EN_SUIVI: 'En Suivi', FIN_DE_SUIVI: 'Fin de Suivi',
  DIASPORA: 'Diaspora', CONFIRME: 'Confirmé', EN_ATTENTE_CONFIRMATION: 'En attente',
  LITIGE: 'Litige', ANNULE: 'Annulé', OUVERTE: 'Ouverte', FERMEE: 'Fermée',
  ARCHIVEE: 'Archivée', ARCHIVE: 'Archivé',
  URGENT: '🚨 URGENT', PRIORITAIRE: '⚡ PRIORITAIRE',
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
