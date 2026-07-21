'use client'

import { useState } from 'react'
import { cn, getInitials, avatarColorFromName } from '@/lib/utils'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number

const SIZE_PX: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
}

interface AvatarProps {
  /** Nom complet de la personne — sert aux initiales ET à la couleur déterministe. */
  name: string
  /** URL de photo optionnelle (pas encore utilisée en pratique — support futur). */
  src?: string | null
  /** Taille prédéfinie ou taille en pixels. Défaut : 'sm' (32px). */
  size?: AvatarSize
  /** Force une couleur (ex. jaune de marque pour l'utilisateur connecté) au lieu de la couleur déterministe. */
  override?: { bg: string; text: string }
  className?: string
}

export function Avatar({ name, src, size = 'sm', override, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false)
  const px = typeof size === 'number' ? size : SIZE_PX[size]
  const colors = override ?? avatarColorFromName(name)
  const showImage = Boolean(src) && !imgError

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold leading-none',
        className
      )}
      style={{
        width: px,
        height: px,
        backgroundColor: showImage ? undefined : colors.bg,
        color: colors.text,
        fontSize: Math.max(10, Math.round(px * 0.38)),
        boxShadow: `0 0 0 2px ${colors.text}26`,
      }}
    >
      {showImage ? (
        // pas de next/image ici : next.config.ts ne liste que localhost dans images.domains,
        // une photoUrl de prod casserait le rendu (voir MonProfil.tsx qui fait pareil)
        <img
          src={src as string}
          alt=""
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        getInitials(name || '?')
      )}
    </span>
  )
}
