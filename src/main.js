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

// ---- kieu trinh duyet khi dang nhap Google ------------------------------------------
// Google tu choi dang nhap ("This browser or app may not be secure") tuy theo
// User-Agent cua trinh duyet nhung, va cach xet thay doi theo thoi gian. Khong thu
// duoc voi tai khoan that tu noi viet ma, nen app TU THU lan luot cac kieu duoi day
// moi khi Google tu choi, va nho kieu nao dang nhap duoc.
//   app      - bo chu "Electron/x", giu ten app (giong mot trinh duyet Chromium khac)
//   electron - de nguyen User-Agent mac dinh cua Electron
//   firefox  - gia lam Firefox (bo luon cac header sec-ch-ua ma Firefox khong gui)
const LOGIN_MODES = ['app', 'electron', 'firefox']
// Trang "Couldn't sign you in" cua Google: nhan theo dia chi, hoac theo chu tren trang
const REJECTED = /signin\/rejected|deniedsigninrejected/
const REJECTED_TEXT = /may not be secure|có thể không an toàn/i
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch (_) { return {} }
}
let loginMode = 'app'
let triedModes = new Set()
let defaultUA = ''

function userAgentFor(mode) {
  if (mode === 'electron') return defaultUA
  if (mode === 'firefox') {
    const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15'
      : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
    return `Mozilla/5.0 (${os}; rv:140.0) Gecko/20100101 Firefox/140.0`
  }
  return defaultUA.replace(/\sElectron\/\S+/i, '')
}

function applyLoginMode() {
  const ua = userAgentFor(loginMode)
  gmail.webContents.session.setUserAgent(ua)
  gmail.webContents.setUserAgent(ua)
}

// Google vua tu choi: chuyen sang kieu tiep theo chua thu va mo lai Gmail.
async function nextLoginMode() {
  triedModes.add(loginMode)
  const next = LOGIN_MODES.find((m) => !triedModes.has(m))
  if (!next) {
    if (!triedModes.has('het')) {
      triedModes.add('het')
      log('error', 'Google từ chối đăng nhập với cả 3 kiểu trình duyệt của tool. Bấm "Về Gmail" để thử lại, hoặc báo lại kèm ảnh chụp.')
    }
    return
  }
  log('warn', `Google từ chối đăng nhập (kiểu trình duyệt "${loginMode}"). Tool tự thử lại với kiểu "${next}"…`)
  loginMode = next
  await gmail.webContents.session.clearStorageData().catch(() => {})
  applyLoginMode()
  gmail.webContents.loadURL(GMAIL_URL).catch(() => {})
}

// ---- khung Gmail --------------------------------------------------------------------
function createGmailView() {
  const ses = session.fromPartition('persist:gmail')
  defaultUA = ses.getUserAgent()
  const saved = readSettings().loginMode
  if (LOGIN_MODES.includes(saved)) loginMode = saved
  ses.webRequest.onBeforeSendHeaders((details, done) => {
    const headers = details.requestHeaders
    if (loginMode === 'firefox') for (const h of Object.keys(headers)) if (/^sec-ch-ua/i.test(h)) delete headers[h]
    done({ requestHeaders: headers })
  })
  gmail = new WebContentsView({ webPreferences: { session: ses, backgroundThrottling: false } })
  applyLoginMode()
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
  if (REJECTED.test(wc.getURL())) return nextLoginMode()
  if (/^https:\/\/accounts\.google\.com\//.test(wc.getURL()) && !wc.isLoading()) {
    const text = await wc.executeJavaScript('document.body ? document.body.innerText.slice(0, 2000) : ""').catch(() => '')
    if (REJECTED_TEXT.test(text)) return nextLoginMode()
  }
  let account = ''
  try {
    if (wc.getURL().startsWith(GMAIL_URL) && !wc.isLoading() &&
        (await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(SEL.main)})`))) {
      account = (/[\w.+-]+@[\w.-]+\.\w+/.exec(wc.getTitle()) || ['Gmail'])[0]
    }
  } catch (_) { /* trang dang chuyen */ }
  if (account !== state.account) {
    state.account = account
    if (account) {
      log('ok', `Đã đăng nhập: ${account}`)
      // nho kieu trinh duyet vua dang nhap duoc cho cac lan mo sau
      if (readSettings().loginMode !== loginMode) {
        try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), loginMode })) } catch (_) { /* bo qua */ }
      }
    } else push()
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
    else if (cmd === 'gmail_home') {
      triedModes = new Set() // cho thu lai tu dau cac kieu trinh duyet
      gmail.webContents.loadURL(GMAIL_URL).catch(() => {})
    }
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
