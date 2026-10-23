/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F3EBDD', paper2: '#EFE5D3', ink: '#17130F', rule: '#CFC3AD',
        muted: '#6B6153', magenta: '#A3204F', signal: '#FF004D', brass: '#B8873B', sea: '#2E5E6E', safe: '#2F7D4F',
      },
      fontFamily: {
        serif: ['"Newsreader Variable"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: { caps: '0.16em' },
    },
  },
  plugins: [],
}
