// Dung chung cho cac bai e2e: mo app (ma nguon hoac ban dong goi qua GC_APP),
// noi vao bang CDP de dieu khien giao dien va khung Gmail nhu nguoi dung.
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright-core')

const ROOT = path.join(__dirname, '..')
const MOCK_URL = require('url').pathToFileURL(path.join(__dirname, 'mock_gmail.html')).href
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchApp(port, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-test-'))
  const args = [`--remote-debugging-port=${port}`].concat(process.platform === 'linux' ? ['--no-sandbox'] : [])
  const exe = process.env.GC_APP ? path.resolve(process.env.GC_APP) : require('electron')
  const proc = spawn(exe, (process.env.GC_APP ? [] : [ROOT]).concat(args), {
    env: { ...process.env, GC_GMAIL_URL: MOCK_URL, GC_DATA_DIR: dataDir, ...extraEnv }, stdio: 'inherit',
  })
  const exited = new Promise((r) => proc.on('exit', r))
  let browser
  for (let i = 0; i < 80 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null)
    if (!browser) await sleep(500)
  }
  if (!browser) throw new Error('khong noi duoc vao app qua CDP')
  const find = async (key) => {
    for (let i = 0; i < 120; i++) {
      for (const ctx of browser.contexts()) for (const pg of ctx.pages()) if (pg.url().includes(key)) return pg
      await sleep(250)
    }
    throw new Error(`khong thay trang ${key}: ${browser.contexts().flatMap((c) => c.pages().map((p) => p.url()))}`)
  }
  const ui = await find('ui_dist')
  const console_ = []
  ui.on('console', (m) => console_.push(`${m.type()}: ${m.text()}`))
  ui.on('pageerror', (e) => console_.push(`pageerror: ${e}`))
  // in trang thai app + nhat ky khi bai kiem loi
  const diagnose = async () => {
    try {
      const st = await ui.evaluate(() => window.gc.call('hello'))
      console.log('---- TRANG THAI APP:', st.status, st.account, JSON.stringify(st.update))
      for (const l of st.logs) console.log('  |', l.t, l.level, l.msg)
      console.log('---- CONSOLE:', console_.slice(-15))
      console.log('---- GIAO DIEN:', (await ui.evaluate(() => document.body.innerText)).slice(0, 600))
    } catch (e) { console.log('khong doc duoc trang thai:', e.message) }
    for (const f of ['error.log', 'update.log']) {
      const p = path.join(dataDir, f)
      if (fs.existsSync(p)) console.log(`---- ${f}\n${fs.readFileSync(p, 'utf8').slice(-2500)}`)
    }
  }
  return { proc, exited, browser, ui, find, dataDir, diagnose }
}

// Chay bai kiem; loi thi in chan doan, luon dong app.
async function run(port, extraEnv, body) {
  const app = await launchApp(port, extraEnv)
  let failed = false
  try {
    await body(app)
  } catch (e) {
    failed = true
    console.log(e.stack || e)
    await app.diagnose()
  } finally {
    if (app.proc.exitCode === null) { app.proc.kill(); await Promise.race([app.exited, sleep(5000)]) }
  }
  process.exit(failed ? 1 : 0)
}

module.exports = { ROOT, MOCK_URL, sleep, launchApp, run }
