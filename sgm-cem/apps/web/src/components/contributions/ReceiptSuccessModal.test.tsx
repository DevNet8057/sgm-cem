import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReceiptSuccessContent } from './ReceiptSuccessModal'

const ACTION_LABELS = ['Afficher', 'Télécharger', 'Partager']

describe('ReceiptSuccessContent', () => {
  it('rend immédiatement le succès et les actions pendant la finalisation du reçu', () => {
    const html = renderToStaticMarkup(
      <ReceiptSuccessContent contributionId="contribution-sans-recu" />
    )

    expect(html).toContain('Paiement confirmé !')
    expect(html).toContain('La contribution est bien enregistrée.')
    expect(html).toContain('Finalisation du reçu…')
    ACTION_LABELS.forEach(label => expect(html).toContain(label))
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=| |>)/)
  })

  it('rend le reçu prêt, les actions et le résumé de la contribution', () => {
    const html = renderToStaticMarkup(
      <ReceiptSuccessContent
        contributionId="contribution-avec-recu"
        initialReceiptUrl="/recus/contribution-avec-recu.pdf"
        memberName="Marie Ngo"
        rubriqueLabel="Offrande spéciale"
        amount={12500}
      />
    )

    expect(html).toContain('Reçu prêt')
    ACTION_LABELS.forEach(label => expect(html).toContain(label))
    expect(html).toContain('Membre')
    expect(html).toContain('Marie Ngo')
    expect(html).toContain('Rubrique')
    expect(html).toContain('Offrande spéciale')
    expect(html).toContain('Montant')
    expect(html).toMatch(/12(?: |&#x202f;| )500(?: |&#xa0;| )FCFA/)
  })

  it('expose un intitulé principal français avec une zone de statut accessible', () => {
    const html = renderToStaticMarkup(
      <ReceiptSuccessContent contributionId="contribution-semantique" />
    )

    expect(html).toMatch(
      /<h3[^>]*>\s*Paiement confirmé !\s*<\/h3>/
    )
    expect(html).toContain('aria-live="polite"')
  })
})
