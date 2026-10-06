const c = (v) => ({ DEFAULT: `hsl(var(--${v}))`, foreground: `hsl(var(--${v}-foreground))` })
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))', input: 'hsl(var(--input))', ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))', foreground: 'hsl(var(--foreground))',
        primary: c('primary'), secondary: c('secondary'), destructive: c('destructive'),
        muted: c('muted'), accent: c('accent'), card: c('card'), popover: c('popover'),
      },
      borderRadius: {
        lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 2px)', '2xl': 'calc(var(--radius) + 6px)',
      },
      fontFamily: { sans: ['var(--font-sans)'] },
    },
  },
}
