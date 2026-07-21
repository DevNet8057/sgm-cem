'use client'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera, Check, KeyRound, Loader2,
  Phone, Save, ShieldCheck, Trash2, User,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { PasswordInput } from '@/components/ui/PasswordInput'
import api from '@/lib/api'
import { cn, ROLE_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'

interface ProfileData {
  id: string; memberId?: string; firstName: string; lastName: string
  fullName: string; email: string; phone?: string; whatsappPhone?: string
  role: string; photoUrl?: string; lastLoginAt?: string; createdAt?: string
  membre?: { categorie: string; groupe: string; statut: string; profilFinancier: string; profession?: string }
}

export function MonProfil() {
  const { user, setUser } = useAuthStore()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [firstName,     setFirstName]     = useState('')
  const [lastName,      setLastName]      = useState('')
  const [email,         setEmail]         = useState('')
  const [phone,         setPhone]         = useState('')
  const [whatsappPhone, setWhatsappPhone] = useState('')

  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd,     setNewPwd]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError,    setPwdError]   = useState('')
  const [pwdSuccess,  setPwdSuccess] = useState('')
  const [infoSuccess, setInfoSuccess] = useState('')
  const [infoError,   setInfoError]  = useState('')

  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ['my-profile'],
    queryFn: async () => (await api.get('/profile')).data.data,
  })

  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName)
      setLastName(profile.lastName)
      setEmail(profile.email ?? '')
      setPhone(profile.phone ?? '')
      setWhatsappPhone(profile.whatsappPhone ?? '')
    }
  }, [profile])

  const saveInfo = useMutation({
    mutationFn: async () => api.patch('/profile', {
      firstName:     firstName     || undefined,
      lastName:      lastName      || undefined,
      email:         email         || undefined,
      phone:         phone         || null,
      whatsappPhone: whatsappPhone || null,
    }),
    onSuccess: async (res) => {
      setInfoError('')
      setInfoSuccess('Informations mises à jour.')
      setTimeout(() => setInfoSuccess(''), 3000)
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] })
      if (user) setUser({ ...user, firstName: res.data.data.firstName, fullName: res.data.data.fullName })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setInfoError(e.response?.data?.error?.message ?? 'Erreur lors de la sauvegarde')
    },
  })

  const hasValidPassword = newPwd.length >= 8 && /[A-Z]/.test(newPwd) && /[0-9]/.test(newPwd)

  const changePwd = useMutation({
    mutationFn: async () => api.post('/auth/change-password', { currentPassword: currentPwd, newPassword: newPwd }),
    onSuccess: () => {
      setPwdError('')
      setPwdSuccess('Mot de passe modifié avec succès.')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
      setTimeout(() => setPwdSuccess(''), 4000)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setPwdError(e.response?.data?.error?.message ?? 'Mot de passe actuel incorrect')
    },
  })

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('photo', file)
      return api.post('/profile/photo', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] })
    },
  })

  const deletePhoto = useMutation({
    mutationFn: async () => api.delete('/profile/photo'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-profile'] }),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadPhoto.mutate(file)
  }

  function submitPwd(e: React.FormEvent) {
    e.preventDefault()
    setPwdError('')
    if (newPwd !== confirmPwd) { setPwdError('Les mots de passe ne correspondent pas'); return }
    if (!hasValidPassword) { setPwdError('Mot de passe trop faible (majuscule + chiffre + 8 car. min.)'); return }
    changePwd.mutate()
  }

  if (isLoading) return (
    <div className="p-6 animate-page-enter">
      <div className="h-40 skeleton rounded-[18px] mb-5" />
      <div className="h-60 skeleton rounded-[18px]" />
    </div>
  )

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter space-y-5">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[20px] cross-bg"
        style={{ background: 'linear-gradient(135deg, #052005 0%, #0F4A0F 50%, #1A6B1A 100%)' }}>
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, #F5C400, transparent)', opacity: 0.08 }} />
        <div className="relative z-10 p-5 flex flex-col sm:flex-row items-center gap-5">
          {/* Avatar */}
          <div className="relative group">
            <Avatar
              name={profile?.fullName ?? ''}
              src={profile?.photoUrl}
              size={80}
              override={{ bg: '#F5C400', text: '#0F4A0F' }}
              className="shadow-cem-yellow border-4 border-white/20"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadPhoto.isPending}
              className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
            >
              {uploadPhoto.isPending
                ? <Loader2 size={20} className="text-white animate-spin" />
                : <Camera size={20} className="text-white" />
              }
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>

          <div className="text-center sm:text-left">
            <p className="text-white/50 text-xs uppercase tracking-widest">{ROLE_LABELS[profile?.role ?? ''] ?? profile?.role}</p>
            <h2 className="font-display font-semibold text-white text-2xl">{profile?.fullName}</h2>
            <p className="text-white/60 text-sm">{profile?.email}</p>
            {profile?.memberId && <p className="font-mono text-white/40 text-xs mt-0.5">{profile.memberId}</p>}
          </div>

          <div className="sm:ml-auto flex gap-2">
            {profile?.photoUrl && (
              <button
                onClick={() => deletePhoto.mutate()}
                disabled={deletePhoto.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white/10 hover:bg-red-400/30 text-white/70 hover:text-white text-xs transition-colors"
              >
                <Trash2 size={12} /> Supprimer photo
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#F5C400] text-[#0F4A0F] font-semibold text-xs hover:bg-[#D4A800] transition-colors"
            >
              <Camera size={12} /> Changer photo
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        {/* Informations personnelles */}
        <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center">
              <User size={16} />
            </div>
            <h3 className="font-display font-semibold text-[#0F4A0F] text-lg">Informations du compte</h3>
          </div>

          <form onSubmit={e => { e.preventDefault(); saveInfo.mutate() }} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Prénom" value={firstName} onChange={setFirstName} />
              <Field label="Nom"    value={lastName}  onChange={setLastName}  />
            </div>

            <div>
              <Field label="Adresse email" type="email" value={email} onChange={setEmail} />
              <p className="text-xs text-gray-400 mt-1">
                💡 Pour vous connecter avec Google, votre email ici doit correspondre à votre adresse Gmail.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                  <span className="flex items-center gap-1"><Phone size={11} /> Téléphone</span>
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center px-2.5 py-2.5 bg-gray-100 border border-gray-200 rounded-[10px] text-xs text-gray-500">🇨🇲 +237</span>
                  <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="6XXXXXXXX"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                  <span className="flex items-center gap-1">💬 WhatsApp</span>
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center px-2.5 py-2.5 bg-gray-100 border border-gray-200 rounded-[10px] text-xs text-gray-500">🇨🇲 +237</span>
                  <input value={whatsappPhone} onChange={e => setWhatsappPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="6XXXXXXXX"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
                </div>
              </div>
            </div>

            {infoError   && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{infoError}</p>}
            {infoSuccess && (
              <p className="text-sm text-[#1A6B1A] bg-[#E8F5E8] border border-[#1A6B1A]/20 rounded-[10px] px-3 py-2 flex items-center gap-1.5">
                <Check size={13} /> {infoSuccess}
              </p>
            )}

            <div className="flex justify-end">
              <Button loading={saveInfo.isPending}><Save size={14} /> Sauvegarder</Button>
            </div>
          </form>

          {/* Infos membre */}
          {profile?.membre && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Informations membre</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Catégorie',  value: profile.membre.categorie?.replace(/_/g, ' ') },
                  { label: 'Groupe',     value: profile.membre.groupe?.replace(/_/g, ' ') },
                  { label: 'Statut',     value: profile.membre.statut?.replace(/_/g, ' ') },
                  { label: 'Profil',     value: profile.membre.profilFinancier },
                  { label: 'Profession', value: profile.membre.profession ?? '—' },
                ].map(item => (
                  <div key={item.label} className="bg-gray-50 rounded-[10px] p-2.5">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">{item.label}</p>
                    <p className="text-sm font-semibold text-gray-700">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Changer mot de passe */}
        <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center">
              <KeyRound size={16} />
            </div>
            <h3 className="font-display font-semibold text-[#0F4A0F] text-lg">Mot de passe</h3>
          </div>

          <form onSubmit={submitPwd} className="space-y-4">
            <PasswordInput
              label="Mot de passe actuel"
              value={currentPwd}
              onChange={e => setCurrentPwd(e.target.value)}
              placeholder="Entrez votre mot de passe actuel"
              autoComplete="current-password"
              required
            />

            <PasswordInput
              label="Nouveau mot de passe"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="Min. 8 caractères, majuscule, chiffre"
              autoComplete="new-password"
              showStrengthIndicator={true}
              required
            />

            <PasswordInput
              label="Confirmer le nouveau mot de passe"
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              placeholder="Répétez le nouveau mot de passe"
              autoComplete="new-password"
              required
            />
            {confirmPwd && newPwd !== confirmPwd && (
              <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas</p>
            )}
            {confirmPwd && newPwd === confirmPwd && hasValidPassword && (
              <p className="text-xs text-green-600 mt-1">✓ Les mots de passe correspondent</p>
            )}

            {pwdError   && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{pwdError}</p>}
            {pwdSuccess && (
              <p className="text-sm text-[#1A6B1A] bg-[#E8F5E8] border border-[#1A6B1A]/20 rounded-[10px] px-3 py-2 flex items-center gap-1.5">
                <ShieldCheck size={13} /> {pwdSuccess}
              </p>
            )}

            <Button
              type="submit"
              loading={changePwd.isPending}
              disabled={!currentPwd || !newPwd || newPwd !== confirmPwd || !hasValidPassword}
              className="w-full"
            >
              <ShieldCheck size={14} /> Changer le mot de passe
            </Button>
          </form>

          {/* Infos sécurité */}
          {profile?.lastLoginAt && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Dernière connexion :{' '}
                <span className="font-semibold text-gray-600">
                  {new Date(profile.lastLoginAt).toLocaleString('fr-FR')}
                </span>
              </p>
              {profile.createdAt && (
                <p className="text-xs text-gray-400 mt-1">
                  Compte créé le :{' '}
                  <span className="font-semibold text-gray-600">
                    {new Date(profile.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, disabled, type = 'text' }: {
  label: string; value: string; onChange?: (v: string) => void; disabled?: boolean; type?: string
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange ? e => onChange(e.target.value) : undefined}
        disabled={disabled}
        className={cn(
          'w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm transition-colors',
          disabled ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]'
        )}
      />
    </div>
  )
}