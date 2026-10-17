// Une URL par écran (UX-01) : /dashboard pour l'accueil, /dashboard/<vue> sinon.
// La navigation interne passe par history.pushState, que le routeur de Next
// synchronise avec usePathname : bouton retour du téléphone et rafraîchissement
// ramènent au bon écran, sans quitter l'application.
const VIEW_SLUG = /^[a-z][a-z-]{1,40}$/

export function viewFromPath(pathname: string | null): string {
  const segment = pathname?.match(/^\/dashboard\/([^/?#]+)/)?.[1]
  return segment && VIEW_SLUG.test(segment) ? segment : 'dashboard'
}

export function pathForView(view: string): string {
  return view === 'dashboard' || !VIEW_SLUG.test(view) ? '/dashboard' : `/dashboard/${view}`
}

/** Change d'écran en ajoutant une entrée d'historique (sauf si l'URL est déjà la bonne). */
export function pushView(view: string): void {
  if (typeof window === 'undefined') return
  const target = pathForView(view)
  if (window.location.pathname !== target) window.history.pushState(null, '', target)
}
