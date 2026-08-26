/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: { colors: { amber: { 500: '#F5A623', 600: '#E8960F', 700: '#d4820a' } }, fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['Courier New', 'monospace'] } } },
  plugins: [],
}
