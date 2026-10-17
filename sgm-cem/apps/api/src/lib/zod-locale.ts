import { z } from 'zod'

// Messages de validation par défaut en français (renvoyés tels quels par l'API)
z.config(z.locales.fr())
