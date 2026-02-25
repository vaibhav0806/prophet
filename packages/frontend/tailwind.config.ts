import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        gold: {
          50: '#FFF8E1',
          100: '#FFE082',
          200: '#FFD43B',
          DEFAULT: '#F0B90B',
          400: '#D4A30A',
          500: '#C99700',
          600: '#8B6914',
          light: 'var(--gold-light)',
          dim: 'var(--gold-dim)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          hover: 'var(--surface-hover)',
        },
        border: {
          DEFAULT: 'var(--border)',
          bright: 'var(--border-bright)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'glow-border': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(240, 185, 11, 0.15)' },
          '50%': { boxShadow: '0 0 20px rgba(240, 185, 11, 0.35)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'glow-border': 'glow-border 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
