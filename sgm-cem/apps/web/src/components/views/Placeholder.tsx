'use client'
import { Construction } from 'lucide-react'

export function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 animate-page-enter">
      <div className="w-20 h-20 bg-[#E8F5E8] rounded-[20px] flex items-center justify-center animate-float">
        <Construction size={32} className="text-[#1A6B1A]" />
      </div>
      <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">{title}</h2>
      <p className="text-gray-400 text-sm">Module en cours de développement</p>
    </div>
  )
}
