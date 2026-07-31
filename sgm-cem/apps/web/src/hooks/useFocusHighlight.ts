'use client'
import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'

const HIGHLIGHT_DURATION_MS = 2500

/**
 * Surligne et scroll vers l'élément visé par un focusTarget de notification
 * (voir appStore.navigateToNotification), si son id fait partie de `ids`.
 * Le consommateur pose `data-focus-id={id}` sur chaque élément listé.
 */
export function useFocusHighlight(ids: string[]): string | undefined {
  const activeView = useAppStore(s => s.activeView)
  const focusTarget = useAppStore(s => s.focusTarget)
  const clearFocusTarget = useAppStore(s => s.clearFocusTarget)
  const [highlightedId, setHighlightedId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!focusTarget?.id) return
    if (focusTarget.view !== activeView) return
    if (!ids.includes(focusTarget.id)) return

    const id = focusTarget.id
    setHighlightedId(id)
    clearFocusTarget()

    const el = document.querySelector(`[data-focus-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })

    const timer = setTimeout(() => setHighlightedId(undefined), HIGHLIGHT_DURATION_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, activeView, ids.join(',')])

  return highlightedId
}
