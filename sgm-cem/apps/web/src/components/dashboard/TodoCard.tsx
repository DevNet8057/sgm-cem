'use client'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Inbox, UserCheck } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

type Todo = { toConfirmCount: number; toConfirmAmount: number; transfersToReceive: number; openDisputes: number }
type TodoItem = { view: string; icon: typeof Inbox; label: string; detail: string; tone: string }

/**
 * « À traiter » en tête d'accueil (UX-16) : les tâches qui attendent
 * l'utilisateur, dans son périmètre. Rien à faire → une seule ligne rassurante.
 */
export function TodoCard() {
  const setActiveView = useAppStore(state => state.setActiveView)
  const { data, isLoading } = useQuery<Todo>({
    queryKey: ['todo'],
    queryFn: async () => (await api.get('/contributions/todo')).data.data,
    refetchInterval: 60_000,
  })
  if (isLoading || !data) return null

  const items: TodoItem[] = []
  if (data.toConfirmCount > 0) items.push({ view: 'validations', icon: UserCheck, label: `${data.toConfirmCount} encaissement(s) à confirmer`, detail: formatAmount(data.toConfirmAmount), tone: 'text-[#1A6B1A] bg-[#E8F5E8]' })
  if (data.transfersToReceive > 0) items.push({ view: 'transfer-validations', icon: Inbox, label: `${data.transfersToReceive} remise(s) de fonds à réceptionner`, detail: 'Confirmer ou refuser', tone: 'text-[#92400E] bg-[#FFFBEB]' })
  if (data.openDisputes > 0) items.push({ view: 'litiges', icon: AlertTriangle, label: `${data.openDisputes} litige(s) ouvert(s)`, detail: 'À examiner', tone: 'text-[#991B1B] bg-[#FEF2F2]' })

  return (
    <section aria-label="À traiter" className="rounded-[18px] border border-gray-100 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-[#0F4A0F]">À traiter</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">Rien en attente — tout est à jour.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(item => (
            <li key={item.view}>
              <button
                type="button"
                onClick={() => setActiveView(item.view)}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A6B1A]"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.tone}`}><item.icon size={17} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-800">{item.label}</span>
                  <span className="block text-xs text-gray-500">{item.detail}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-gray-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
