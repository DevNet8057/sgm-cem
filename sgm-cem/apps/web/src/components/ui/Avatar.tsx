'use client'

import { Avatar as AntAvatar } from 'antd'
import { useEffect, useState } from 'react'
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
  /** Nom complet de la personne — sert aux initiales et à la couleur déterministe. */
  name: string
  /** URL de photo optionnelle. */
  src?: string | null
  /** Taille prédéfinie ou taille en pixels. Défaut : 'sm' (32px). */
  size?: AvatarSize
  /** Force une couleur au lieu de la couleur déterministe. */
  override?: { bg: string; text: string }
  className?: string
}

export function Avatar({ name, src, size = 'sm', override, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false)
  const px = typeof size === 'number' ? size : SIZE_PX[size]
  const colors = override ?? avatarColorFromName(name)
  const showImage = Boolean(src) && !imgError

  useEffect(() => {
    setImgError(false)
  }, [src])

  return (
    <AntAvatar
      aria-label={name ? `Avatar de ${name}` : 'Avatar'}
      alt=""
      shape="circle"
      size={px}
      src={showImage ? src : undefined}
      onError={() => {
        setImgError(true)
        return true
      }}
      className={cn(
        '!inline-flex !shrink-0 !items-center !justify-center !overflow-hidden !rounded-full',
        '!font-bold !leading-none [&>img]:!object-cover',
        'transition-[box-shadow,transform] duration-[250ms]',
        className
      )}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        fontSize: Math.max(10, Math.round(px * 0.38)),
        boxShadow: `0 0 0 2px ${colors.text}26`,
      }}
    >
      {getInitials(name || '?')}
    </AntAvatar>
  )
}
