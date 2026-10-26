/** @type {import('tailwindcss').Config} */
// Warna memakai CSS variable (lihat src/styles/global.css) supaya light/dark cukup ganti class `dark` di <html>.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,ts}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        elevated: v('elevated'),
        line: v('line'),
        fg: v('fg'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        ok: v('green'),
        warn: v('orange'),
        bad: v('red'),
        purple: v('purple'),
        teal: v('teal'),
        yellow: v('yellow'),
        pink: v('pink'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '14px', '2xl': '20px', '3xl': '28px' },
      boxShadow: {
        soft: '0 1px 2px rgb(0 0 0 / .04), 0 8px 24px -8px rgb(0 0 0 / .12)',
        lift: '0 2px 4px rgb(0 0 0 / .05), 0 24px 48px -12px rgb(0 0 0 / .25)',
        window: '0 0 0 .5px rgb(0 0 0 / .12), 0 30px 80px -20px rgb(0 0 0 / .45)',
      },
      transitionTimingFunction: { spring: 'cubic-bezier(.32,.72,0,1)' },
      keyframes: {
        blink: { '50%': { opacity: '0' } },
        rise: { from: { opacity: '0', transform: 'translateY(8px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        pop: { '0%': { transform: 'scale(.94)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
      },
      animation: {
        blink: 'blink 1.05s steps(1) infinite',
        rise: 'rise .5s cubic-bezier(.32,.72,0,1) both',
        fade: 'fade .25s ease both',
        pop: 'pop .28s cubic-bezier(.32,.72,0,1) both',
        shimmer: 'shimmer 1.4s linear infinite',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
