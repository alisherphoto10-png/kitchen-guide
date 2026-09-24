/** @type {import('tailwindcss').Config} */
// Палитра «бумажной» ТТК: тёплый фон, чернильный текст, один терракотовый акцент.
// Сознательно не повторяет тёмный стиль KitchenDesk.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: '#F6F3EE', 2: '#EFEAE2', card: '#FFFFFF' },
        ink: { DEFAULT: '#1C1A17', 2: '#4A453E', muted: '#8A8378', faint: '#B9B2A6' },
        line: { DEFAULT: '#E4DDD2', strong: '#D2C9BB' },
        brand: { DEFAULT: '#B4471F', hover: '#9A3B18', soft: '#F6E6DE', ink: '#7A2E12' },
        ok: { DEFAULT: '#2F7A4B', soft: '#E3F1E7' },
        warn: { DEFAULT: '#9A6A00', soft: '#FBF0D5' },
        bad: { DEFAULT: '#B3261E', soft: '#FBE4E1' },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      boxShadow: {
        card: '0 1px 0 rgba(28,26,23,0.04), 0 1px 3px rgba(28,26,23,0.06)',
        pop: '0 8px 30px rgba(28,26,23,0.14)',
      },
    },
  },
  plugins: [],
}
