/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        kds: {
          bg: '#0B1120',      
          card: '#151d2c',    
          header: '#0f172a',  
          accent: '#3b82f6',
          ultra: '#ef4444',
          vip: '#f59e0b',
          success: '#16a34a', 
          weight: '#fbbf24',   
          border: '#1e293b'
        }
      },
      boxShadow: {
        'glow-red': '0 0 15px rgba(239, 68, 68, 0.3)',
        'glow-orange': '0 0 15px rgba(245, 158, 11, 0.25)',
        'glow-green': '0 0 20px rgba(22, 163, 74, 0.2)',
      }
    }
  },
  plugins: [],
}
