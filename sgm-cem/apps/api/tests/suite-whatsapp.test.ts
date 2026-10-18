// Reste à faire n° 3 : WhatsApp par l'API Cloud de 360dialog, modèles approuvés
// par Meta (obligatoires hors fenêtre de 24 h), délai d'expiration.
// Le fournisseur est simulé : aucun message réel n'est envoyé.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import axios from 'axios'
import { sendWhatsApp, sendMonthlyStatement, templateMessage } from '../src/services/notification'

type Call = [string, Record<string, unknown>, { headers: Record<string, string>; timeout: number }]
const posted = () => (vi.mocked(axios.post).mock.calls as unknown as Call[])

beforeAll(() => {
  process.env.DIALOG360_API_KEY = 'cle-de-test'
  process.env.WHATSAPP_TEMPLATE_LANG = 'fr'
})

afterAll(() => {
  delete process.env.DIALOG360_API_KEY
  delete process.env.WHATSAPP_TEMPLATE_LANG
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.WHATSAPP_TEMPLATE_PAIEMENT_CONFIRME
  delete process.env.WHATSAPP_TEMPLATE_OTP
})

describe('WhatsApp (360dialog, API Cloud)', () => {
  it('modèle réglé : envoi par modèle sur waba-v2, avec délai d\'expiration', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } })
    process.env.WHATSAPP_TEMPLATE_PAIEMENT_CONFIRME = 'sgm_paiement_confirme'
    const ok = await sendWhatsApp('677123456', 'texte libre', { configKey: 'WHATSAPP_TEMPLATE_PAIEMENT_CONFIRME', params: ['Awa N.', '5 000 FCFA', 'DIME'] })
    expect(ok).toBe(true)
    const [url, body, options] = posted()[0]
    expect(url).toBe('https://waba-v2.360dialog.io/messages')
    expect(options.headers['D360-API-KEY']).toBe('cle-de-test')
    expect(options.timeout).toBeGreaterThan(0)
    expect(body).toMatchObject({
      messaging_product: 'whatsapp', to: '237677123456', type: 'template',
      template: { name: 'sgm_paiement_confirme', language: { code: 'fr' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Awa N.' }, { type: 'text', text: '5 000 FCFA' }, { type: 'text', text: 'DIME' }] }] },
    })
  })

  it('modèle non réglé : message libre (fenêtre de 24 h)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} })
    await sendWhatsApp('+33612345678', 'Bonjour', { configKey: 'WHATSAPP_TEMPLATE_PAIEMENT_CONFIRME', params: ['x'] })
    expect(posted()[0][1]).toMatchObject({ to: '33612345678', type: 'text', text: { body: 'Bonjour' } })
  })

  it('code de connexion : modèle d\'authentification avec bouton « copier le code »', () => {
    expect(templateMessage('sgm_code', 'fr', { configKey: 'WHATSAPP_TEMPLATE_OTP', params: ['123456'], otpCode: '123456' }).template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
    ])
  })

  it('erreur du fournisseur : échec signalé à l\'appelant', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('timeout of 10000ms exceeded'), { isAxiosError: true }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await sendWhatsApp('677123456', 'x')).toBe(false)
  })

  it('relevé mensuel : « non délivré » quand aucun canal n\'aboutit', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { errors: [{ code: 470 }] } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const delivered = await sendMonthlyStatement({
      userId: 'inexistant', phone: '677123456', memberName: 'Awa N.', month: 'septembre 2026',
      totalConfirmed: 5000, totalPending: 0, contributions: [{ rubrique: 'DIME', montant: 5000, statut: 'CONFIRME' }],
    })
    expect(delivered).toBe(false)
  })
})
