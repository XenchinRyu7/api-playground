/** @type {import('tailwindcss').Config} */
export default {
  // .js ikut di-scan karena markup island dirender dari src/scripts/console.js
  content: ['./src/**/*.{astro,html,js,ts}'],
  theme: {
    extend: {
      colors: {
        ink: '#09090b',
        accent: { DEFAULT: '#67e8f9', dim: '#0e7490', ok: '#6ee7b7' },
      },
      fontFamily: {
        mono: ['"JetBrains Mono Variable"', '"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { DEFAULT: '0', sm: '2px' },
      keyframes: {
        blink: { '50%': { opacity: '0' } },
        line: { from: { opacity: '0', transform: 'translateX(-4px)' }, to: { opacity: '1', transform: 'none' } },
        sweep: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
      },
      animation: {
        blink: 'blink 1.1s steps(1) infinite',
        line: 'line .18s ease-out both',
        sweep: 'sweep .9s linear infinite',
      },
    },
  },
  plugins: [],
};
