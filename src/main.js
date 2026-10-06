// Gmail Cleaner - mot cua so duy nhat: giao dien dieu khien ben trai,
// trinh duyet Gmail nhung ngay ben phai (WebContentsView).
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, net, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

const { Cleaner, Stopped, CleanerError, SECTIONS, SEL, GMAIL_URL } = require('./cleaner')
const updater = require('./updater')

const MAX_LOGS = 300
// Phai dat TRUOC app.whenReady(): noi luu phien dang nhap Gmail va log.
if (process.env.GC_DATA_DIR) app.setPath('userData', process.env.GC_DATA_DIR)

let win = null
let gmail = null // WebContentsView
let busy = false
let stop = false
let release = null // ban moi tim thay tren GitHub
const kind = updater.installKind({ exe: process.execPath, packaged: app.isPackaged, platform: process.platform })
const state = {
  status: 'idle', account: '', deleted: 0, section: '', logs: [],
  version: app.getVersion(),
  update: { status: 'idle', latest: '', notes: '', progress: 0, error: '', manual: kind === 'manual' },
}

const push = () => { if (win && !win.isDestroyed()) win.webContents.send('state', state) }
function log(level, msg) {
  state.logs.push({ t: new Date().toTimeString().slice(0, 8), level, msg })
  state.logs.splice(0, state.logs.length - MAX_LOGS)
  push()
}
const tick = () => { if (stop) throw new Stopped() }
const logFile = (name) => path.join(app.getPath('userData'), name)

// ---- khung Gmail --------------------------------------------------------------------
function createGmailView() {
  const ses = session.fromPartition('persist:gmail')
  // Google chan dang nhap tu "trinh duyet nhung" khi thay chu Electron trong User-Agent.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|GmailCleaner|gmail-cleaner)\/\S+/gi, ''))
  gmail = new WebContentsView({ webPreferences: { session: ses, backgroundThrottling: false } })
  const wc = gmail.webContents
  // Cua so pop-up cua Google (dang nhap, chon tai khoan) mo ngay trong khung;
  // lien ket ra trang khac thi mo bang trinh duyet mac dinh.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([\w-]+\.)*google\.com\//.test(url)) wc.loadURL(url)
    else if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (gmail.setBorderRadius) gmail.setBorderRadius(10)
  gmail.setVisible(false) // hien khi giao dien bao vi tri khung
  win.contentView.addChildView(gmail)
  wc.loadURL(GMAIL_URL).catch(() => {})
}

// Giao dien bao vi tri khung trinh duyet (theo px cua cua so).
function setPane(r) {
  if (!gmail || !r || r.width < 50 || r.height < 50) return
  gmail.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
  gmail.setVisible(true)
}

// Da dang nhap chua? Doc dia chi email tu tieu de trang Gmail.
async function refreshAccount() {
  if (!gmail || gmail.webContents.isDestroyed() || busy) return
  const wc = gmail.webContents
  let account = ''
  try {
    if (wc.getURL().startsWith(GMAIL_URL) && !wc.isLoading() &&
        (await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(SEL.main)})`))) {
      account = (/[\w.+-]+@[\w.-]+\.\w+/.exec(wc.getTitle()) || ['Gmail'])[0]
    }
  } catch (_) { /* trang dang chuyen */ }
  if (account !== state.account) {
    state.account = account
    if (account) log('ok', `Đã đăng nhập: ${account}`)
    else push()
  }
}

// ---- cong viec ----------------------------------------------------------------------
async function runClean(opts) {
  busy = true
  stop = false
  Object.assign(state, { status: 'run', section: '', deleted: 0 })
  push()
  const c = new Cleaner(gmail.webContents, log, tick, (section, deleted) => {
    Object.assign(state, { section, deleted })
    push()
  })
  try {
    await c.login()
    const sections = (opts.sections || []).filter((s) => SECTIONS[s])
    const startPage = Math.max(1, parseInt(opts.startPage, 10) || 1)
    await c.run(sections, startPage, !!opts.emptyTrash)
    log('ok', `Hoàn tất. Tổng cộng đã xóa ${c.deleted} cuộc trò chuyện.`)
  } catch (e) {
    if (e instanceof Stopped) log('warn', 'Đã dừng theo yêu cầu.')
    else if (e instanceof CleanerError) log('error', e.message)
    else log('error', `Lỗi trình duyệt: ${String(e.message || e).split('\n')[0]}`)
  } finally {
    busy = false
    Object.assign(state, { status: 'idle', section: '' })
    push()
    refreshAccount()
  }
}

function setUpdate(patch) {
  Object.assign(state.update, patch)
  push()
}

async function updateCheck() {
  setUpdate({ status: 'checking', error: '' })
  try {
    release = await updater.check(net.fetch)
    if (release) setUpdate({ status: 'available', latest: release.version, notes: release.notes })
    else setUpdate({ status: 'none' })
  } catch (e) {
    setUpdate({ status: 'error', error: e.message })
  }
}

async function updateInstall() {
  if (!release || busy) return
  busy = true
  state.status = 'update'
  setUpdate({ status: 'downloading', progress: 0, error: '' })
  try {
    const file = await updater.download(net.fetch, release, kind, process.arch, (progress) => setUpdate({ progress }))
    setUpdate({ status: 'installing' })
    await updater.apply(kind, file, { exe: process.execPath, log: logFile('update.log') })
    app.quit()
  } catch (e) {
    setUpdate({ status: 'error', error: e.message })
    busy = false
    state.status = 'idle'
    push()
  }
}

// ---- lenh tu giao dien --------------------------------------------------------------
ipcMain.handle('call', (_e, cmd, payload) => {
  if (cmd === 'pane') setPane(payload)
  else if (cmd === 'stop') stop = true
  else if (cmd === 'clear') state.logs = []
  else if (cmd === 'update_open') shell.openExternal(release ? release.url : updater.RELEASES_PAGE)
  else if (!busy) {
    if (cmd === 'run') runClean(payload || {})
    else if (cmd === 'gmail_home') gmail.webContents.loadURL(GMAIL_URL).catch(() => {})
    else if (cmd === 'update_check') updateCheck()
    else if (cmd === 'update_install') updateInstall()
  }
  return state
})

// ---- khoi dong ----------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1100, minHeight: 640,
    title: 'Gmail Cleaner', backgroundColor: '#0a0a0b', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, '..', 'ui_dist', 'index.html'))
  createGmailView()
  win.on('closed', () => { win = null })
}

function fatal(err) {
  const text = String((err && err.stack) || err)
  try { fs.writeFileSync(logFile('error.log'), text) } catch (_) { /* bo qua */ }
  dialog.showErrorBox('Gmail Cleaner - lỗi', `${text.slice(-900)}\n\nChi tiết: ${logFile('error.log')}`)
  app.exit(1)
}
process.on('uncaughtException', fatal)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (win) { win.restore(); win.focus() } })
  app.on('window-all-closed', () => { stop = true; app.quit() })
  app.whenReady().then(() => {
    createWindow()
    setInterval(refreshAccount, 2000)
    if (!process.env.GC_NO_UPDATE_CHECK) updateCheck()
  }).catch(fatal)
}
