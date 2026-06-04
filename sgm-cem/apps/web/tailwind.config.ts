import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        cem: {
          'green-950': '#031403',
          'green-900': '#052005',
          'green-800': '#0F4A0F',
          'green-700': '#1A6B1A',
          'green-600': '#2D8C2D',
          'green-500': '#3DAA3D',
          'green-100': '#D4EDD4',
          'green-50':  '#E8F5E8',
          'green-25':  '#F0FDF4',
          'yellow-600': '#C4A000',
          'yellow-500': '#D4A800',
          'yellow-400': '#F5C400',
          'yellow-100': '#FDE68A',
          'yellow-50':  '#FEFCE8',
        }
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        body:    ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        'xs': '4px', 'sm': '6px', 'md': '10px',
        'lg': '14px', 'xl': '18px', '2xl': '24px', '3xl': '28px',
      },
      boxShadow: {
        'cem-sm':     '0 2px 8px rgba(26,107,26,0.12)',
        'cem':        '0 4px 16px rgba(26,107,26,0.18)',
        'cem-lg':     '0 8px 32px rgba(15,74,15,0.14)',
        'cem-xl':     '0 20px 60px rgba(15,74,15,0.18)',
        'cem-yellow': '0 4px 20px rgba(245,196,0,0.35)',
        'inner-cem':  'inset 0 2px 8px rgba(26,107,26,0.06)',
      },
      animation: {
        'page-enter':    'page-enter 0.4s cubic-bezier(0.4,0,0.2,1) both',
        'slide-up':      'slide-up 0.35s cubic-bezier(0.4,0,0.2,1) both',
        'modal-in':      'modal-in 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'toast-in':      'toast-in 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        'skeleton':      'skeleton 1.5s ease-in-out infinite',
        'urgence-pulse': 'urgence-pulse 2s ease-in-out infinite',
        'float':         'float 3s ease-in-out infinite',
        'pop':           'pop-in 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        'spin-smooth':   'spin 0.8s linear infinite',
        'ping-slow':     'ping 2s cubic-bezier(0,0,0.2,1) infinite',
        'shimmer':       'shimmer 2s linear infinite',
      },
      keyframes: {
        'page-enter':    { from: { opacity:'0', transform:'translateY(12px)' }, to: { opacity:'1', transform:'translateY(0)' } },
        'slide-up':      { from: { opacity:'0', transform:'translateY(20px)' }, to: { opacity:'1', transform:'translateY(0)' } },
        'modal-in':      { from: { opacity:'0', transform:'translateY(40px) scale(0.97)' }, to: { opacity:'1', transform:'none' } },
        'toast-in':      { from: { opacity:'0', transform:'translateX(100%)' }, to: { opacity:'1', transform:'none' } },
        'skeleton':      { '0%': { backgroundPosition:'-200% 0' }, '100%': { backgroundPosition:'200% 0' } },
        'urgence-pulse': { '0%,100%': { boxShadow:'0 0 0 0 rgba(239,68,68,0.4)' }, '50%': { boxShadow:'0 0 0 8px rgba(239,68,68,0)' } },
        'float':         { '0%,100%': { transform:'translateY(0)' }, '50%': { transform:'translateY(-6px)' } },
        'pop-in':        { from: { opacity:'0', transform:'scale(0.92)' }, to: { opacity:'1', transform:'none' } },
        'shimmer':       { '0%': { backgroundPosition:'-200% 0' }, '100%': { backgroundPosition:'200% 0' } },
      },
    },
  },
  plugins: [],
} satisfies Config
