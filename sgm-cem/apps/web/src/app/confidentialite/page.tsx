import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Politique de confidentialité | SGM-CEM',
  description: 'Comment le Culte d’Enfants de Melen traite vos données personnelles dans SGM-CEM.',
}

// Contenu aligné sur le registre des traitements (docs/securite/04 § 3.2).
// Toute évolution d'un traitement ou d'un prestataire met à jour cette page.
const TRAITEMENTS: Array<{ finalite: string; donnees: string; duree: string }> = [
  { finalite: 'Gestion des membres et vie de la communauté', donnees: 'Identité, coordonnées, catégorie, groupe, profil de contribution', duree: 'Durée de l’adhésion, puis 3 ans' },
  { finalite: 'Contributions, reçus et comptabilité', donnees: 'Identité, téléphone, montants, moyens de paiement, dates', duree: '10 ans (pièces comptables)' },
  { finalite: 'Dons des collectes publiques (non-membres)', donnees: 'Nom, téléphone, e-mail facultatif, informations demandées par la collecte', duree: 'Pièce comptable 10 ans ; identité anonymisée après 3 ans' },
  { finalite: 'Notifications (WhatsApp, SMS, e-mail, application)', donnees: 'Téléphone, e-mail, contenu des messages', duree: 'Journaux d’envoi : 1 an' },
  { finalite: 'Sécurité et traçabilité des opérations', donnees: 'Actions réalisées, date, adresse IP, navigateur', duree: '10 ans pour les opérations financières ; adresses IP : 1 an' },
]

const DESTINATAIRES: Array<{ nom: string; role: string }> = [
  { nom: 'Yelii (MTN Mobile Money, Orange Money)', role: 'Encaissement des paiements Mobile Money' },
  { nom: 'CinetPay', role: 'Encaissement des paiements par carte' },
  { nom: '360dialog / Meta (WhatsApp)', role: 'Envoi des confirmations et codes de connexion' },
  { nom: 'Twilio', role: 'Envoi de SMS lorsque WhatsApp est indisponible' },
  { nom: 'Fournisseur de messagerie électronique', role: 'Envoi des reçus par e-mail' },
  { nom: 'Google', role: 'Connexion « Continuer avec Google » (comptes de l’équipe)' },
  { nom: 'Hébergeur de l’application et des sauvegardes', role: 'Stockage sécurisé des données' },
]

export default function PolitiqueConfidentialitePage() {
  return (
    <main className="min-h-[100dvh] bg-[#f3f7f3] px-4 py-8 sm:px-8 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="text-sm font-medium text-[#1A6B1A] hover:underline">← Retour à la connexion</Link>
        <h1 className="mt-6 text-3xl font-bold text-[#0F4A0F]">Politique de confidentialité</h1>
        <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : 17 octobre 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="text-lg font-semibold text-slate-900">1. Responsable du traitement</h2>
            <p>
              SGM-CEM est le système de gestion du Culte d&apos;Enfants de Melen (Église Évangélique du Cameroun, Yaoundé),
              responsable du traitement de vos données. Ce traitement respecte la loi camerounaise n° 2024/017 du
              23 décembre 2024 relative à la protection des données à caractère personnel.
              Contact : <a className="text-[#1A6B1A] underline" href="mailto:devnet8057@gmail.com">devnet8057@gmail.com</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">2. Ce que nous traitons, pourquoi et combien de temps</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Finalité</th>
                    <th className="py-2 pr-3 font-semibold">Données</th>
                    <th className="py-2 font-semibold">Conservation</th>
                  </tr>
                </thead>
                <tbody>
                  {TRAITEMENTS.map(t => (
                    <tr key={t.finalite} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 font-medium text-slate-800">{t.finalite}</td>
                      <td className="py-2 pr-3">{t.donnees}</td>
                      <td className="py-2">{t.duree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2">Les montants et pièces comptables sont conservés pour la durée légale, même après une demande d&apos;effacement : l&apos;identité est alors anonymisée.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">3. Qui reçoit vos données</h2>
            <p>Seuls les membres de l&apos;équipe habilités, selon leur rôle (collecteur, responsable, trésorier, administrateur), et les prestataires techniques suivants, pour la seule exécution de leur service :</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {DESTINATAIRES.map(d => <li key={d.nom}><strong>{d.nom}</strong> — {d.role}</li>)}
            </ul>
            <p className="mt-2">Certains de ces prestataires traitent les données hors du Cameroun (notamment WhatsApp, Twilio et Google). Ces transferts sont encadrés conformément à la loi n° 2024/017. Vos données ne sont ni vendues ni utilisées à des fins publicitaires.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">4. Donateurs des collectes publiques</h2>
            <p>Si vous donnez sans être membre, vos informations ne sont utilisées qu&apos;avec votre accord explicite (case à cocher avant le paiement), pour enregistrer votre don, vous envoyer votre reçu et vous joindre à son sujet.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">5. Sécurité</h2>
            <p>Accès limités selon les responsabilités, mots de passe protégés, connexions chiffrées, opérations sensibles journalisées, sauvegardes régulières et testées.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">6. Vos droits</h2>
            <p>
              Vous pouvez demander l&apos;accès à vos données, leur rectification, leur effacement (anonymisation de votre identité),
              vous opposer à un traitement ou retirer votre consentement. Écrivez au contact ci-dessus ou adressez-vous à
              l&apos;administrateur du Culte d&apos;Enfants de Melen ; chaque demande est enregistrée et traitée dans les délais légaux.
              Vous pouvez aussi saisir l&apos;Autorité de protection des données à caractère personnel (APDP).
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
