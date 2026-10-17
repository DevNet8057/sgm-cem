import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperatorSelector, PaymentMethodSelector } from './PaymentMethodSelector'

function buttonContaining(html: string, label: string): string {
  const button = html
    .split('</button>')
    .find(fragment => fragment.includes(label))

  expect(button).toBeDefined()
  return `${button}</button>`
}

describe('PaymentMethodSelector', () => {
  it('affiche les trois catégories de paiement', () => {
    const html = renderToStaticMarkup(
      <PaymentMethodSelector value="MOBILE_MONEY" onChange={() => {}} />
    )

    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html).toContain('Mobile Money')
    expect(html).toContain('MTN MoMo / Orange Money')
    expect(html).toContain('Carte bancaire')
    expect(html).toContain('Espèces')
  })

  it('masque un mode désactivé au lieu d\'afficher un choix impossible', () => {
    const html = renderToStaticMarkup(
      <PaymentMethodSelector
        value="MOBILE_MONEY"
        disabledModes={['CARTE_VISA']}
        onChange={() => {}}
      />
    )

    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).not.toContain('Carte bancaire')
    expect(html).toContain('Mobile Money')
  })
})

describe('OperatorSelector', () => {
  it('affiche les opérateurs et expose correctement le choix actif', () => {
    const html = renderToStaticMarkup(
      <OperatorSelector value="ORANGE" onChange={() => {}} />
    )
    const mtnButton = buttonContaining(html, 'MTN MoMo')
    const orangeButton = buttonContaining(html, 'Orange Money')

    expect(mtnButton).toContain('aria-pressed="false"')
    expect(orangeButton).toContain('aria-pressed="true"')
  })
})
