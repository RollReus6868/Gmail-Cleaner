// Chu de: moi chu de chi doi mau nhan + dai gradient 3 diem, phan con lai la zinc.
type Side = { primary: string; gradient: [string, string, string] }
export type Theme = { id: string; label: string; emoji: string; light: Side; dark: Side }

export function themeFromHue(id: string, label: string, emoji: string, h: number): Theme {
  return {
    id, label, emoji,
    light: { primary: `${h} 75% 36%`, gradient: [`${h - 18} 75% 40%`, `${h} 75% 40%`, `${h + 22} 75% 44%`] },
    dark: { primary: `${h} 80% 46%`, gradient: [`${h - 18} 80% 28%`, `${h} 80% 30%`, `${h + 22} 80% 32%`] },
  }
}

const t = (id: string, label: string, emoji: string, lp: string, dp: string, lg: Side['gradient'], dg: Side['gradient']): Theme =>
  ({ id, label, emoji, light: { primary: lp, gradient: lg }, dark: { primary: dp, gradient: dg } })

export const themes: Theme[] = [
  themeFromHue('mint', 'Bạc hà', '🍃', 168), // mau rieng cua Gmail Cleaner
  t('ocean', 'Ocean', '🌊', '215 90% 55%', '215 95% 60%', ['200 90% 50%', '215 85% 55%', '230 80% 60%'], ['200 95% 35%', '215 90% 40%', '230 85% 45%']),
  t('midnight', 'Midnight', '🌌', '262 83% 58%', '270 80% 65%', ['240 60% 50%', '280 70% 55%', '320 65% 50%'], ['240 70% 35%', '280 80% 40%', '320 75% 35%']),
  t('aurora', 'Aurora', '✨', '175 80% 40%', '175 85% 50%', ['160 80% 45%', '190 85% 50%', '220 80% 55%'], ['160 90% 30%', '190 95% 35%', '220 90% 40%']),
  t('sunset', 'Sunset', '🌅', '25 95% 53%', '30 95% 55%', ['15 90% 55%', '35 95% 55%', '45 90% 50%'], ['15 85% 40%', '35 90% 42%', '45 85% 38%']),
  t('forest', 'Forest', '🌲', '152 75% 40%', '152 80% 48%', ['140 70% 40%', '160 65% 45%', '175 60% 42%'], ['140 75% 28%', '160 70% 32%', '175 65% 30%']),
  t('candy', 'Candy', '🍬', '340 85% 55%', '340 90% 60%', ['330 85% 60%', '350 80% 65%', '10 85% 60%'], ['330 90% 42%', '350 85% 48%', '10 90% 45%']),
]

export function themeVars(theme: Theme, dark: boolean): Record<string, string> {
  const s = dark ? theme.dark : theme.light
  const h = s.primary.split(' ')[0]
  return {
    '--primary': s.primary,
    '--ring': s.primary,
    '--primary-foreground': dark ? `${h} 100% 8%` : '0 0% 100%',
    '--accent': dark ? `${h} 50% 16%` : `${h} 60% 95%`,
    '--accent-foreground': dark ? `${h} 80% 83%` : `${h} 60% 27%`,
    '--gradient-from': s.gradient[0],
    '--gradient-via': s.gradient[1],
    '--gradient-to': s.gradient[2],
  }
}
