import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Politique de confidentialité | SGM-CEM',
  description: 'Politique de confidentialité de SGM-CEM.',
}

export default function PolitiqueConfidentialitePage() {
  return (
    <main className="min-h-[100dvh] bg-[#f3f7f3] px-4 py-8 sm:px-8 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="text-sm font-medium text-[#1A6B1A] hover:underline">← Retour à la connexion</Link>
        <h1 className="mt-6 text-3xl font-bold text-[#0F4A0F]">Politique de confidentialité</h1>
        <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : 20 septembre 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="text-lg font-semibold text-slate-900">1. Responsable du traitement</h2>
            <p>SGM-CEM est le système de gestion du Culte d&apos;Enfants de Melen, Église Évangélique du Cameroun à Yaoundé. Pour toute question, écrivez à <a className="text-[#1A6B1A] underline" href="mailto:devnet8057@gmail.com">devnet8057@gmail.com</a>.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">2. Données traitées</h2>
            <p>Nous traitons les informations nécessaires à la gestion des membres, des contributions et des accès : identité, coordonnées, rôle dans l&apos;application, historiques de connexion et opérations financières enregistrées.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">3. Connexion avec Google</h2>
            <p>Lorsque vous choisissez « Continuer avec Google », Google nous transmet uniquement les informations nécessaires à l&apos;authentification, notamment votre adresse e-mail et votre identité de base. Elles servent exclusivement à vérifier qu&apos;un compte SGM-CEM actif correspond à cette adresse. Aucun compte n&apos;est créé automatiquement.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">4. Sécurité et accès</h2>
            <p>Les accès sont limités selon les responsabilités de chaque utilisateur. Les opérations sensibles sont journalisées afin d&apos;assurer la traçabilité. Les données ne sont pas vendues ni utilisées à des fins publicitaires.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900">5. Conservation et vos droits</h2>
            <p>Les données sont conservées le temps nécessaire à la gestion de la communauté et aux obligations de traçabilité. Vous pouvez demander la consultation, la correction ou la désactivation de votre compte auprès de l&apos;administrateur du Culte d&apos;Enfants de Melen.</p>
          </section>
        </div>
      </article>
    </main>
  )
}
