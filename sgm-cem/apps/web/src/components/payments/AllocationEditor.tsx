'use client'

import { Plus, Trash2, AlertTriangle } from 'lucide-react'
const MAX_PAYMENT_BATCH_LINES = 50

export interface PaymentAllocation {
  rubriqueId: string
  montant: number
}

function validateAllocations(allocations: readonly PaymentAllocation[]): boolean {
  if (allocations.length === 0 || allocations.length > MAX_PAYMENT_BATCH_LINES) return false
  const rubriqueIds = new Set<string>()
  return allocations.every(allocation => {
    if (!allocation || allocation.rubriqueId.trim() === '' || rubriqueIds.has(allocation.rubriqueId) || !isPositiveSafeInteger(allocation.montant)) return false
    rubriqueIds.add(allocation.rubriqueId)
    return true
  })
}

function sumAllocations(allocations: readonly PaymentAllocation[]): number {
  return allocations.reduce((sum, allocation) => {
    const next = sum + allocation.montant
    if (!Number.isSafeInteger(next)) throw new RangeError('Somme trop élevée')
    return next
  }, 0)
}

export interface AllocationRubriqueOption {
  id: string
  title: string
  code?: string
}

export interface AllocationEditorProps {
  /** Budget total saisi en FCFA. Une chaîne vide permet de vider le champ. */
  budget: number | ''
  allocations: readonly PaymentAllocation[]
  rubriques: readonly AllocationRubriqueOption[]
  onBudgetChange: (budget: number | '') => void
  onAllocationsChange: (allocations: PaymentAllocation[]) => void
  /** Appelé uniquement lorsque le formulaire respecte le contrat partagé. */
  onNext: () => void
  nextLabel?: string
  disabled?: boolean
}

const amountFormatter = new Intl.NumberFormat('fr-FR')

function formatAmount(amount: number): string {
  return `${amountFormatter.format(amount)} FCFA`
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function parseAmount(value: string): number {
  if (value.trim() === '') return 0
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function AllocationEditor({
  budget,
  allocations,
  rubriques,
  onBudgetChange,
  onAllocationsChange,
  onNext,
  nextLabel = 'Continuer',
  disabled = false,
}: AllocationEditorProps) {
  const rows = [...allocations]
  const positiveRows = rows.filter(allocation => allocation && isPositiveSafeInteger(allocation.montant))

  let allocatedTotal = 0
  try {
    allocatedTotal = positiveRows.length > 0 && validateAllocations(positiveRows)
      ? sumAllocations(positiveRows)
      : positiveRows.reduce((total, allocation) => {
          const next = total + allocation.montant
          return Number.isSafeInteger(next) ? next : Number.MAX_SAFE_INTEGER
        }, 0)
  } catch {
    allocatedTotal = Number.MAX_SAFE_INTEGER
  }

  const validAllocations = validateAllocations(rows)
  const validBudget = typeof budget === 'number' && isPositiveSafeInteger(budget)
  const remaining = validBudget ? budget - allocatedTotal : null
  const canContinue = !disabled && validBudget && validAllocations && remaining !== null && remaining >= 0

  const updateRow = (index: number, patch: Partial<PaymentAllocation>) => {
    onAllocationsChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const addRow = () => {
    if (rows.length < MAX_PAYMENT_BATCH_LINES) {
      onAllocationsChange([...rows, { rubriqueId: '', montant: 0 }])
    }
  }

  const removeRow = (index: number) => {
    onAllocationsChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <section aria-labelledby="allocation-editor-title" className="space-y-4">
      <div>
        <h2 id="allocation-editor-title" className="text-base font-semibold text-[#0F4A0F]">Répartir votre paiement</h2>
        <p className="mt-1 text-sm text-gray-500">Indiquez le budget total puis le montant à affecter à chaque rubrique.</p>
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Budget total (FCFA)
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={budget}
          onChange={event => onBudgetChange(event.target.value === '' ? '' : parseAmount(event.target.value))}
          disabled={disabled}
          className="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-3 text-base outline-none transition focus:border-[#1A6B1A] focus:ring-2 focus:ring-[#1A6B1A]/15 disabled:bg-gray-100"
          aria-describedby="allocation-budget-help"
        />
        <span id="allocation-budget-help" className="mt-1 block text-xs font-normal text-gray-500">Montant entier positif en FCFA.</span>
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-800">Lignes de répartition</h3>
          <span className="text-xs text-gray-400">{rows.length}/{MAX_PAYMENT_BATCH_LINES}</span>
        </div>

        {rows.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">Ajoutez au moins une rubrique.</p>}

        {rows.map((allocation, index) => {
          const duplicate = allocation.rubriqueId !== '' && rows.some((row, rowIndex) => rowIndex !== index && row.rubriqueId === allocation.rubriqueId)
          const availableRubriques = rubriques.filter(rubrique => rubrique.id === allocation.rubriqueId || !rows.some((row, rowIndex) => rowIndex !== index && row.rubriqueId === rubrique.id))
          return (
            <div key={`${index}-${allocation.rubriqueId}`} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                <label className="block text-sm font-medium text-gray-700">
                  Rubrique
                  <select
                    value={allocation.rubriqueId}
                    onChange={event => updateRow(index, { rubriqueId: event.target.value })}
                    disabled={disabled}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1A6B1A] focus:ring-2 focus:ring-[#1A6B1A]/15 disabled:bg-gray-100"
                  >
                    <option value="">Choisir une rubrique</option>
                    {availableRubriques.map(rubrique => <option key={rubrique.id} value={rubrique.id}>{rubrique.code ? `${rubrique.code} · ` : ''}{rubrique.title}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Montant (FCFA)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={allocation.montant || ''}
                    onChange={event => updateRow(index, { montant: parseAmount(event.target.value) })}
                    disabled={disabled}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#1A6B1A] focus:ring-2 focus:ring-[#1A6B1A]/15 disabled:bg-gray-100"
                  />
                </label>
                <button type="button" onClick={() => removeRow(index)} disabled={disabled} aria-label={`Supprimer la ligne ${index + 1}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 px-3 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <Trash2 size={17} />
                </button>
              </div>
              {duplicate && <p className="mt-2 text-xs font-medium text-red-600">Cette rubrique est déjà utilisée. Choisissez une rubrique différente.</p>}
              {!duplicate && allocation.rubriqueId !== '' && !isPositiveSafeInteger(allocation.montant) && <p className="mt-2 text-xs text-red-600">Saisissez un montant entier positif.</p>}
            </div>
          )
        })}

        <button type="button" onClick={addRow} disabled={disabled || rows.length >= MAX_PAYMENT_BATCH_LINES || rubriques.length <= rows.length} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#1A6B1A] px-4 py-2.5 text-sm font-semibold text-[#1A6B1A] transition hover:bg-green-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400">
          <Plus size={17} /> Ajouter une rubrique
        </button>
      </div>

      <div className="rounded-xl bg-gray-50 p-4 text-sm">
        <div className="flex justify-between gap-3 text-gray-600"><span>Somme répartie</span><strong className="text-gray-900">{formatAmount(allocatedTotal)}</strong></div>
        <div className="mt-2 flex justify-between gap-3 text-gray-600"><span>Reste</span><strong className={remaining !== null && remaining < 0 ? 'text-red-600' : 'text-[#1A6B1A]'}>{remaining === null ? '—' : formatAmount(remaining)}</strong></div>
        {remaining !== null && remaining > 0 && <p className="mt-3 flex gap-2 text-xs text-amber-800"><AlertTriangle size={15} className="shrink-0" />Le reste ne sera pas débité.</p>}
        {remaining !== null && remaining < 0 && <p className="mt-3 text-xs font-medium text-red-600">La somme répartie dépasse le budget total.</p>}
      </div>

      <button type="button" onClick={onNext} disabled={!canContinue} className="min-h-12 w-full rounded-xl bg-[#1A6B1A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#145514] disabled:cursor-not-allowed disabled:bg-gray-300">
        {nextLabel}
      </button>
    </section>
  )
}
