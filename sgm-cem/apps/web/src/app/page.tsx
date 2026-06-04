'use client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(6, 'Mot de passe trop court'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [apiError, setApiError] = useState('')
  const { login } = useAuthStore()
  const router = useRouter()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setApiError('')
    try {
      await login(data.email, data.password)
      router.replace('/dashboard')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: { message?: string } } } }
      setApiError(error?.response?.data?.error?.message ?? 'Erreur de connexion')
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-[420px] flex-shrink-0 flex-col justify-between p-10 cross-bg relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #052005 0%, #0F4A0F 45%, #1A6B1A 100%)' }}>
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, #F5C400, transparent)' }} />

        <div className="relative z-10">
          <div className="w-12 h-12 rounded-[12px] bg-[#F5C400] flex items-center justify-center mb-8">
            <span className="text-[#0F4A0F] font-black text-lg font-display">CEM</span>
          </div>
          <h1 className="font-display text-white text-4xl font-semibold leading-tight mb-3">
            Système de Gestion du Ministère
          </h1>
          <p className="text-white/60 text-sm leading-relaxed mb-8">
            Culte d'Enfants de Melen · Église Évangélique du Cameroun
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { value: '106+', label: 'Membres' },
              { value: '11', label: 'Rubriques' },
              { value: '100%', label: 'Traçabilité' },
            ].map(stat => (
              <div key={stat.label} className="rounded-[14px] px-3 py-3 text-center"
                style={{ background: 'rgba(255,255,255,0.08)' }}>
                <p className="font-display text-[#F5C400] text-2xl font-bold">{stat.value}</p>
                <p className="text-white/50 text-xs">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-white/40 text-xs italic">
          "La Marche Ensemble dans l'Unité"
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8">
            <div className="w-14 h-14 rounded-[14px] bg-[#F5C400] flex items-center justify-center">
              <span className="text-[#0F4A0F] font-black text-xl font-display">CEM</span>
            </div>
          </div>

          <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl mb-1">Connexion</h2>
          <p className="text-gray-400 text-sm mb-8">Accédez à votre espace de gestion</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Adresse email</label>
              <input
                {...register('email')}
                type="email"
                placeholder="admin@cem-melen.cm"
                className="w-full px-4 py-3 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A] transition-colors"
              />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Mot de passe</label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-10 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A] transition-colors"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            {apiError && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-[10px] text-sm text-red-700">
                {apiError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#1A6B1A] text-white font-semibold rounded-[10px] shadow-cem hover:bg-[#0F4A0F] active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {isSubmitting ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            SGM-CEM · Culte d'Enfants de Melen · EEC Yaoundé
          </p>
        </div>
      </div>
    </div>
  )
}
