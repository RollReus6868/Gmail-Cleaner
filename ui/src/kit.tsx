// Bo khung giao dien kieu Youwee, ban toi gian cho tool nay.
import { ChevronLeft, ChevronRight, Moon, Sun, type LucideIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { themes, themeVars, type Theme } from './themes'

export const STORAGE_KEY = 'gmail-cleaner'
export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function load<T>(name: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`${STORAGE_KEY}-${name}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
export function save(name: string, value: unknown) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${name}`, JSON.stringify(value))
  } catch {
    /* khong luu duoc thi thoi */
  }
}

/* ---------- Chu de ---------- */
type ThemeCtx = { theme: Theme; dark: boolean; setTheme: (id: string) => void; toggleDark: () => void }
const Ctx = createContext<ThemeCtx | null>(null)
export const useTheme = () => useContext(Ctx)!

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState(() => load('theme', themes[0].id))
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(`${STORAGE_KEY}-mode`) !== 'light'
    } catch {
      return true
    }
  })
  const theme = themes.find((t) => t.id === id) ?? themes[0]
  useEffect(() => {
    const root = document.documentElement
    const vars = themeVars(theme, dark)
    root.classList.toggle('dark', dark)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    save('theme', theme.id)
    save('vars', vars)
    try {
      localStorage.setItem(`${STORAGE_KEY}-mode`, dark ? 'dark' : 'light')
    } catch {
      /* bo qua */
    }
  }, [theme, dark])
  return <Ctx.Provider value={{ theme, dark, setTheme: setId, toggleDark: () => setDark((d) => !d) }}>{children}</Ctx.Provider>
}

export function ThemeGrid() {
  const { theme, setTheme, dark } = useTheme()
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {themes.map((t) => {
        const g = (dark ? t.dark : t.light).gradient
        return (
          <button
            key={t.id}
            data-theme={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              'flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-semibold transition-all',
              t.id === theme.id ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 hover:bg-muted/50',
            )}
          >
            <span
              className="h-6 w-6 shrink-0 rounded-full"
              style={{ background: `linear-gradient(135deg, hsl(${g[0]}), hsl(${g[1]}), hsl(${g[2]}))` }}
            />
            <span className="truncate">
              {t.emoji} {t.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Nut ---------- */
const variants = {
  gradient: 'btn-gradient rounded-xl shadow-lg',
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-border bg-background/50 hover:bg-accent hover:text-accent-foreground',
  subtle: 'rounded-xl bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'rounded-xl bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400',
}
const sizes = {
  default: 'h-9 px-4 text-sm [&_svg]:size-4',
  xl: 'h-12 px-6 text-base [&_svg]:size-5',
  'icon-xl': 'h-12 w-12 shrink-0 [&_svg]:size-5',
}
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }

export function Button({ variant = 'default', size = 'default', className, ...p }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
        variants[variant], sizes[size], className,
      )}
      {...p}
    />
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span className={cn('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

/* ---------- Trang thai ---------- */
const tones = {
  muted: 'bg-muted text-muted-foreground',
  active: 'bg-primary/10 text-primary',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
}
export type Tone = keyof typeof tones

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone], className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', tone === 'active' && 'animate-pulse')} />
      <span className="truncate">{children}</span>
    </span>
  )
}

export function LevelTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn('w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold', tones[tone])}>{children}</span>
}

export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <Icon className="h-5 w-5" />
    </div>
  )
}

/* ---------- Khung cua so ---------- */
export type NavItem = { id: string; label: string; icon: LucideIcon; dot?: boolean }

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex h-full gap-3 p-3">
      <div className="app-bg-glow" />
      {sidebar}
      <main className="glass-panel relative flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}

function SideButton({ icon: Icon, label, open, active, onClick, iconClass, dot }: {
  icon: LucideIcon; label: string; open: boolean; active?: boolean; onClick: () => void; iconClass?: string; dot?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={open ? undefined : label}
      aria-label={label}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {active && <span className="absolute left-0 h-5 w-1 rounded-r-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.5)]" />}
      <Icon className={cn('h-5 w-5 shrink-0 transition-transform group-hover:scale-110', iconClass)} />
      {dot && <span className="absolute left-7 top-2 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background" />}
      {open && <span className="truncate text-sm font-semibold">{label}</span>}
    </button>
  )
}

export function Sidebar({ brand, items, bottomItems, activeId, onSelect }: {
  brand: string; items: NavItem[]; bottomItems: NavItem[]; activeId: string; onSelect: (id: string) => void
}) {
  const { dark, toggleDark } = useTheme()
  const [open, setOpen] = useState(() => load('sidebar', window.innerWidth >= 900))
  useEffect(() => save('sidebar', open), [open])
  const nav = (list: NavItem[]) =>
    list.map((i) => <SideButton key={i.id} icon={i.icon} label={i.label} open={open} active={i.id === activeId} dot={i.dot} onClick={() => onSelect(i.id)} />)
  return (
    <aside className={cn('glass-panel relative flex shrink-0 flex-col gap-1 p-2 transition-[width] duration-200', open ? 'w-[180px]' : 'w-[60px]')}>
      <div className="flex h-11 items-center justify-center px-1">
        <span className="gradient-text truncate text-lg font-extrabold">{open ? brand : brand[0]}</span>
      </div>
      {nav(items)}
      <div className="flex-1" />
      {nav(bottomItems)}
      <SideButton icon={dark ? Moon : Sun} label={dark ? 'Giao diện tối' : 'Giao diện sáng'} open={open} onClick={toggleDark} iconClass={dark ? 'text-indigo-400' : 'text-amber-400'} />
      <SideButton icon={open ? ChevronLeft : ChevronRight} label={open ? 'Thu gọn' : 'Mở rộng'} open={open} onClick={() => setOpen(!open)} />
    </aside>
  )
}

export function PageHeader({ icon, title, description, actions }: { icon: LucideIcon; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
      <IconTile icon={icon} />
      <div className="min-w-0 flex-1 basis-40">
        <h1 className="truncate text-lg font-extrabold">{title}</h1>
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      </div>
      {actions}
    </header>
  )
}

export const PageBody = ({ children }: { children: ReactNode }) => (
  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 sm:px-6">{children}</div>
)

export const ActionBar = ({ children }: { children: ReactNode }) => (
  <footer className="shrink-0">
    <hr className="gradient-divider" />
    <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">{children}</div>
  </footer>
)

export function Card({ title, hint, children, className }: { title?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl bg-muted/30 p-4', className)}>
      {title && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold">{title}</h2>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

export function GradientProgress({ value }: { value: number }) {
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted">
      <div className="btn-gradient h-full rounded-full" style={{ width: `${value}%` }} />
    </div>
  )
}

export function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
      <Icon className="h-8 w-8 opacity-50" />
      <p className="max-w-xs text-sm">{text}</p>
    </div>
  )
}

export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border/50 bg-popover p-5 text-popover-foreground shadow-2xl">
        <h2 className="text-base font-extrabold">{title}</h2>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </div>
  )
}
