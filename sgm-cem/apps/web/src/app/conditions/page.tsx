import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Conditions d'utilisation | SGM-CEM",
  description: "Conditions d'utilisation de SGM-CEM.",
}

export default function ConditionsPage() {
  return (
    <main className="min-h-[100dvh] bg-[#f3f7f3] px-4 py-8 sm:px-8 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="text-sm font-medium text-[#1A6B1A] hover:underline">← Retour à la connexion</Link>
        <h1 className="mt-6 text-3xl font-bold text-[#0F4A0F]">Conditions d&apos;utilisation</h1>
        <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : 20 septembre 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="text-lg font-semibold text-slate-900">1. Objet</h2>
            <p>SGM-CEM facilite la gestion des membres, collectes, contributions et opérations de trésorerie du Culte d&apos;Enfants de Melen.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">2. Comptes et responsabilités</h2>
            <p>L&apos;accès est réservé aux personnes dont le compte a été créé ou activé par un administrateur. Chaque utilisateur doit garder ses moyens de connexion confidentiels et utiliser l&apos;application conformément à son rôle.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">3. Contributions et paiements</h2>
            <p>Les montants et états affichés sont soumis aux validations prévues par les responsables habilités. L&apos;utilisateur doit vérifier les informations saisies avant de confirmer une opération.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">4. Usage acceptable</h2>
            <p>Il est interdit de tenter d&apos;accéder aux données d&apos;autrui, de contourner les droits attribués ou de perturber le fonctionnement du service. Les activités sensibles peuvent faire l&apos;objet d&apos;un audit.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">5. Contact</h2>
            <p>Pour une demande d&apos;assistance ou le signalement d&apos;un problème, contactez l&apos;administration à <a className="text-[#1A6B1A] underline" href="mailto:devnet8057@gmail.com">devnet8057@gmail.com</a>.</p>
          </section>
        </div>
      </article>
    </main>
  )
}
