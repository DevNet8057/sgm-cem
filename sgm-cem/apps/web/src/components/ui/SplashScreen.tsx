'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

// Clé de session : évite de rejouer l'écran d'ouverture à chaque navigation
// interne (uniquement au tout premier chargement de l'onglet).
const SPLASH_SESSION_KEY = 'sgm-splash-shown'
// Durée minimale d'affichage, pour laisser le temps à l'animation d'être vue
// même si l'app est déjà prête avant (évite un flash trop bref).
const SPLASH_MIN_DURATION_MS = 1100
const FADE_OUT_MS = 400

/**
 * Écran de démarrage plein écran, affiché le temps que l'app s'hydrate.
 * `visible = true` par défaut au rendu initial pour éviter tout flash blanc
 * et tout mismatch d'hydratation SSR/client.
 *
 * Le retrait du DOM est piloté par un setTimeout brut + une transition CSS,
 * PAS par AnimatePresence/exit de framer-motion : un exit qui ne se termine
 * jamais (observé en pratique — reste bloqué à opacity:1, `isPresent` figé à
 * `true`) laisserait cet overlay plein écran, en z-[9999], bloquer TOUTE
 * l'interface pour toujours (clics interceptés y compris sur les éléments du
 * dashboard en dessous). Un setTimeout ne peut pas rester "en attente d'un
 * callback d'animation qui ne vient jamais" — il se déclenche, point final.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true)
  const [fadingOut, setFadingOut] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(SPLASH_SESSION_KEY)) {
      setFadingOut(true)
      return
    }
    sessionStorage.setItem(SPLASH_SESSION_KEY, '1')
    const timer = setTimeout(() => setFadingOut(true), SPLASH_MIN_DURATION_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!fadingOut) return
    const timer = setTimeout(() => setVisible(false), FADE_OUT_MS)
    return () => clearTimeout(timer)
  }, [fadingOut])

  if (!visible) return null

  return (
    <div
      aria-hidden="true"
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity ease-out',
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      )}
      style={{ background: 'linear-gradient(160deg,#052005 0%,#0F4A0F 45%,#1A6B1A 100%)', transitionDuration: `${FADE_OUT_MS}ms` }}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-white p-3 shadow-[0_12px_40px_rgba(0,0,0,0.25)] sm:h-24 sm:w-24"
      >
        <Image
          src="/icon-192.png"
          width={96}
          height={96}
          alt=""
          priority
          className="h-full w-full rounded-full object-contain"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="mt-5 text-center"
      >
        <p className="font-display text-base font-semibold tracking-wide text-white sm:text-lg">SGM-CEM</p>
        <p className="mt-1 text-xs text-white/60 sm:text-sm">Culte d&apos;Enfants de Melen</p>
      </motion.div>

      <div className="mt-8 h-1 w-32 overflow-hidden rounded-full bg-white/15 sm:w-40">
        <motion.div
          className="h-full w-1/3 rounded-full"
          style={{ background: '#F5C400' }}
          animate={{ x: ['-100%', '220%'] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </div>
  )
}
