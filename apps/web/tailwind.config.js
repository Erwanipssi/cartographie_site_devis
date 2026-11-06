/** @type {import('tailwindcss').Config} */
// Palette neutre (gris zinc) + un accent bleu réservé au focus et aux liens.
// Les noms historiques sont conservés pour ne pas toucher chaque page :
// pine/moss = succès, clay = erreur/danger, amber/sand = avertissement.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#18181b',
          800: '#3f3f46',
          600: '#71717a',
          400: '#a1a1aa',
        },
        paper: '#fafafa',
        card: '#ffffff',
        line: '#e4e4e7',
        accent: '#2563eb',
        pine: '#15803d',
        moss: '#f0fdf4',
        clay: '#dc2626',
        sand: '#fef7ec',
        amber: '#b45309',
      },
      fontFamily: {
        display: ['Geist', 'system-ui', 'sans-serif'],
        sans: ['Geist', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
