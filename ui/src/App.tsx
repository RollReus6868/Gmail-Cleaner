import { ArrowUpCircle, Bell, Download, Eraser, ExternalLink, Inbox, RefreshCw, LogIn, MailX, MessagesSquare, Palette, Play, ScrollText, Settings, ShieldAlert, Square, Tag, Trash2, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { call, demoState, emptyState, type Level, type Options, type State } from './api'
import { ActionBar, AppShell, Button, Card, Dialog, EmptyState, GradientProgress, LevelTag, PageBody, PageHeader, Pill, Sidebar, Switch, ThemeGrid, cn, load, save, type Tone } from './kit'

const PAGE_SIZE = 100
const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'inbox', label: 'Hộp thư đến', icon: Inbox },
  { id: 'social', label: 'Mạng xã hội', icon: Users },
  { id: 'promotions', label: 'Quảng cáo', icon: Tag },
  { id: 'updates', label: 'Cập nhật', icon: Bell },
  { id: 'forums', label: 'Diễn đàn', icon: MessagesSquare },
  { id: 'spam', label: 'Thư rác', icon: ShieldAlert },
]
const LEVELS: Record<Level, { tone: Tone; label: string }> = {
  info: { tone: 'info', label: 'TIN' },
  ok: { tone: 'success', label: 'XONG' },
  warn: { tone: 'warning', label: 'LƯU Ý' },
  error: { tone: 'error', label: 'LỖI' },
}
const DEFAULTS: Options = { sections: ['social', 'promotions'], startPage: 1, emptyTrash: true }

function useBackend() {
  const [state, setState] = useState<State>(() => (location.search.includes('demo') ? demoState : emptyState))
  useEffect(() => {
    window.__gcPush = setState
    call('hello').then((s) => s && setState(s))
  }, [])
  const send = (cmd: string, payload?: unknown) => call(cmd, payload).then((s) => s && setState({ ...s }))
  return { state, send }
}

type Backend = ReturnType<typeof useBackend>

function CleanPage({ state, send, goUpdate }: Backend & { goUpdate: () => void }) {
  const [opts, setOpts] = useState<Options>(() => ({ ...DEFAULTS, ...load('options', {}) }))
  const [confirm, setConfirm] = useState(false)
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => save('options', opts), [opts])
  useEffect(() => logEnd.current?.scrollIntoView({ block: 'nearest' }), [state.logs.length])

  const busy = state.status !== 'idle'
  const kept = (opts.startPage - 1) * PAGE_SIZE
  const picked = SECTIONS.filter((s) => opts.sections.includes(s.id))
  const toggle = (id: string) =>
    setOpts((o) => ({ ...o, sections: o.sections.includes(id) ? o.sections.filter((x) => x !== id) : [...o.sections, id] }))
  const start = () => {
    setConfirm(false)
    // gui dung thu tu hien thi, khong theo thu tu bam
    send('run', { ...opts, sections: picked.map((s) => s.id) })
  }

  const status =
    state.status === 'login' ? <Pill tone="active">Đang chờ đăng nhập…</Pill>
    : state.status === 'run' ? <Pill tone="active">Đang xóa{state.section ? `: ${state.section}` : '…'}</Pill>
    : state.account ? <Pill tone="success" className="max-w-[220px]">{state.account}</Pill>
    : <Pill tone="muted">Chưa đăng nhập</Pill>

  return (
    <>
      <PageHeader
        icon={MailX}
        title="Dọn thư Gmail"
        description="Tự động xóa thư cũ theo từng mục, rồi dọn sạch thùng rác."
        actions={
          <>
            {state.update.status === 'available' && (
              <button onClick={goUpdate} className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400">
                <ArrowUpCircle className="h-3.5 w-3.5" /> Có bản mới {state.update.latest}
              </button>
            )}
            {status}
          </>
        }
      />
      <PageBody>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 basis-48">
              <h2 className="text-sm font-bold">Bước 1 · Đăng nhập</h2>
              <p className="text-xs text-muted-foreground">
                Mở Gmail trong cửa sổ trình duyệt của tool. Bạn tự nhập mật khẩu với Google, tool không lưu mật khẩu.
              </p>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => send('login')}>
              <LogIn /> {state.account ? 'Mở lại Gmail' : 'Đăng nhập Gmail'}
            </Button>
          </div>
        </Card>

        <Card title="Bước 2 · Chọn mục cần xóa" hint={`Đã chọn ${picked.length}/${SECTIONS.length}`}>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const on = opts.sections.includes(id)
              return (
                <button
                  key={id}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-all disabled:opacity-50',
                    on ? 'border-primary/40 bg-primary/10 text-primary' : 'border-dashed border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              )
            })}
          </div>
        </Card>

        <Card title="Bước 3 · Tùy chọn">
          <div className="space-y-4">
            <label className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-sm font-semibold">Xóa từ trang</span>
                <span className="block text-xs text-muted-foreground">
                  {kept === 0
                    ? 'Trang 1: xóa toàn bộ thư trong các mục đã chọn.'
                    : `Giữ lại ${kept} thư mới nhất của mỗi mục (${PAGE_SIZE} thư mỗi trang), xóa phần cũ hơn.`}
                </span>
              </span>
              <input
                type="number"
                min={1}
                value={opts.startPage}
                disabled={busy}
                onChange={(e) => setOpts((o) => ({ ...o, startPage: Math.max(1, Math.floor(Number(e.target.value)) || 1) }))}
                className="h-9 w-24 rounded-md border border-input bg-background/50 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
            </label>
            <hr className="gradient-divider" />
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Dọn sạch Thùng rác sau khi xóa</span>
                <span className="block text-xs text-muted-foreground">
                  Xóa vĩnh viễn mọi thư trong Thùng rác, kể cả thư bạn tự xóa trước đó. Không khôi phục được.
                </span>
              </span>
              <Switch label="Dọn sạch Thùng rác sau khi xóa" checked={opts.emptyTrash} onChange={(v) => !busy && setOpts((o) => ({ ...o, emptyTrash: v }))} />
            </div>
          </div>
        </Card>

        <Card title="Nhật ký" hint={state.deleted > 0 && `Đã xóa ${state.deleted} cuộc trò chuyện`}>
          {state.logs.length === 0 ? (
            <EmptyState icon={ScrollText} text="Chưa có gì. Đăng nhập, chọn mục rồi bấm Bắt đầu xóa — tiến trình sẽ hiện ở đây." />
          ) : (
            <ul className="space-y-1.5">
              {state.logs.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <LevelTag tone={LEVELS[l.level].tone}>{LEVELS[l.level].label}</LevelTag>
                  <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{l.t}</span>
                  <span className="min-w-0 break-words">{l.msg}</span>
                </li>
              ))}
            </ul>
          )}
          <div ref={logEnd} />
        </Card>
      </PageBody>

      <ActionBar>
        {busy ? (
          <Button variant="danger" size="xl" className="flex-1" onClick={() => send('stop')}>
            <Square /> Dừng
          </Button>
        ) : (
          <Button variant="gradient" size="xl" className="flex-1" disabled={picked.length === 0 && !opts.emptyTrash} onClick={() => setConfirm(true)}>
            <Play /> Bắt đầu xóa
          </Button>
        )}
        <Button variant="subtle" size="icon-xl" aria-label="Xóa nhật ký" title="Xóa nhật ký" onClick={() => send('clear')}>
          <Eraser />
        </Button>
      </ActionBar>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Xác nhận xóa thư"
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>Hủy</Button>
            <Button onClick={start}><Trash2 /> Xóa</Button>
          </>
        }
      >
        {picked.length > 0 && (
          <p>
            Xóa thư từ <b className="text-foreground">trang {opts.startPage}</b> trở đi trong:{' '}
            <b className="text-foreground">{picked.map((s) => s.label).join(', ')}</b>
            {kept > 0 && ` (giữ lại ${kept} thư mới nhất mỗi mục)`}.
          </p>
        )}
        {opts.sections.includes('spam') && <p>Thư trong mục Thư rác bị xóa vĩnh viễn ngay, không qua Thùng rác.</p>}
        {opts.emptyTrash ? (
          <p>Sau đó dọn sạch Thùng rác: mọi thư trong đó bị <b className="text-foreground">xóa vĩnh viễn</b>.</p>
        ) : (
          <p>Thư đã xóa nằm trong Thùng rác 30 ngày, bạn vẫn có thể khôi phục.</p>
        )}
      </Dialog>
    </>
  )
}

function UpdatePage({ state, send }: Backend) {
  const u = state.update
  const busy = state.status !== 'idle'
  return (
    <>
      <PageHeader
        icon={ArrowUpCircle}
        title="Cập nhật"
        description="Tool tự kiểm tra bản mới mỗi lần mở. Bấm một nút để tải và cài."
        actions={<Pill tone="muted">Đang dùng bản {state.version || '—'}</Pill>}
      />
      <PageBody>
        <Card>
          {u.status === 'available' || u.status === 'downloading' || u.status === 'installing' ? (
            <div className="space-y-3">
              <h2 className="text-sm font-bold">Có bản mới {u.latest}</h2>
              {u.notes && <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">{u.notes}</pre>}
              {u.status === 'downloading' && (
                <div className="space-y-1.5">
                  <GradientProgress value={u.progress} />
                  <p className="text-xs text-muted-foreground">Đang tải… {u.progress}%</p>
                </div>
              )}
              {u.status === 'installing' && <p className="text-sm text-muted-foreground">Đang cài bản mới. Tool sẽ tự đóng và mở lại sau ít giây.</p>}
              {u.manual && <p className="text-xs text-muted-foreground">Bản đang chạy không tự cài được (chạy từ mã nguồn, hoặc chưa kéo vào thư mục Applications). Hãy tải bản mới ở trang phát hành.</p>}
            </div>
          ) : u.status === 'error' ? (
            <div className="space-y-2">
              <Pill tone="error">Không kiểm tra được</Pill>
              <p className="break-words text-sm text-muted-foreground">{u.error}</p>
            </div>
          ) : u.status === 'none' ? (
            <EmptyState icon={ArrowUpCircle} text="Bạn đang dùng bản mới nhất." />
          ) : (
            <EmptyState icon={RefreshCw} text={u.status === 'checking' ? 'Đang kiểm tra bản mới…' : 'Bấm nút bên dưới để kiểm tra bản mới.'} />
          )}
        </Card>
      </PageBody>
      <ActionBar>
        {u.status === 'available' && u.manual ? (
          <Button variant="gradient" size="xl" className="flex-1" onClick={() => send('update_open')}>
            <ExternalLink /> Mở trang tải về
          </Button>
        ) : (
          <Button variant="gradient" size="xl" className="flex-1" disabled={busy || u.status !== 'available'} onClick={() => send('update_install')}>
            <Download /> {u.status === 'available' ? `Tải và cài bản ${u.latest}` : 'Tải và cài bản mới'}
          </Button>
        )}
        <Button variant="subtle" size="icon-xl" aria-label="Kiểm tra lại" title="Kiểm tra lại" disabled={busy || u.status === 'checking'} onClick={() => send('update_check')}>
          <RefreshCw />
        </Button>
      </ActionBar>
    </>
  )
}

function SettingsPage() {
  return (
    <>
      <PageHeader icon={Settings} title="Cài đặt" description="Màu sắc của tool. Đổi sáng/tối bằng nút mặt trời ở thanh bên." />
      <PageBody>
        <Card title="Chủ đề" hint={<Palette className="inline h-3.5 w-3.5" />}>
          <ThemeGrid />
        </Card>
      </PageBody>
    </>
  )
}

export default function App() {
  const backend = useBackend()
  const [page, setPage] = useState('clean')
  return (
    <AppShell
      sidebar={
        <Sidebar
          brand="Gmail Cleaner"
          items={[{ id: 'clean', label: 'Dọn thư', icon: MailX }]}
          bottomItems={[
            { id: 'update', label: 'Cập nhật', icon: ArrowUpCircle, dot: backend.state.update.status === 'available' },
            { id: 'settings', label: 'Cài đặt', icon: Settings },
          ]}
          activeId={page}
          onSelect={setPage}
        />
      }
    >
      {page === 'clean' ? <CleanPage {...backend} goUpdate={() => setPage('update')} /> : page === 'update' ? <UpdatePage {...backend} /> : <SettingsPage />}
    </AppShell>
  )
}
