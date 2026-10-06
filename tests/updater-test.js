// Kiem thu src/updater.js (khong can mang, khong can Electron):  node tests/updater-test.js
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const u = require('../src/updater')

const DATA = Buffer.from('noi dung ban cai moi'.repeat(1000))
const SHA = crypto.createHash('sha256').update(DATA).digest('hex')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ut-'))
const tests = []
const test = (name, fn) => tests.push([name, fn])

function release({ version = '9.9.9', digest = `sha256:${SHA}`, sums = false, name } = {}) {
  name = name || u.assetName('win-setup', version)
  const assets = { [name]: { name, browser_download_url: 'https://x/file', digest } }
  if (sums) assets['SHA256SUMS.txt'] = { name: 'SHA256SUMS.txt', browser_download_url: 'https://x/sums' }
  return { version, notes: '', url: 'https://x', assets }
}
// fetch gia: /sums tra ve bang ma, con lai tra ve DATA
const fakeFetch = (sums = '') => async (url) => new Response(url.endsWith('/sums') ? sums : DATA, {
  headers: { 'content-length': String(url.endsWith('/sums') ? sums.length : DATA.length) },
})
const jsonFetch = (status, body) => async () => new Response(JSON.stringify(body), { status })

test('so sanh phien ban', () => {
  assert.deepEqual(u.parseVersion('v1.2.10'), [1, 2, 10])
  assert(u.newer('1.10.0', '1.9.9') && u.newer('2.0.0', '1.99.99'))
  assert(!u.newer('1.0.0', '1.0.0') && !u.newer('0.9.0', '1.0.0'))
})

test('ten file phat hanh', () => {
  assert.equal(u.assetName('win-setup', '1.2.3'), 'GmailCleaner-1.2.3-windows-setup.exe')
  assert.equal(u.assetName('mac-app', '1.2.3', 'arm64'), 'GmailCleaner-1.2.3-mac-arm64.zip')
  assert.equal(u.assetName('mac-app', '1.2.3', 'x64'), 'GmailCleaner-1.2.3-mac-x64.zip')
})

test('kieu cai dat', () => {
  const d = tmp()
  assert.equal(u.installKind({ exe: 'x', packaged: false, platform: 'win32' }), 'manual')
  const exe = path.join(d, 'GmailCleaner.exe')
  assert.equal(u.installKind({ exe, packaged: true, platform: 'win32' }), 'manual')
  fs.writeFileSync(path.join(d, 'Uninstall GmailCleaner.exe'), '')
  assert.equal(u.installKind({ exe, packaged: true, platform: 'win32' }), 'win-setup')
  const mac = path.join(d, 'GmailCleaner.app', 'Contents', 'MacOS', 'GmailCleaner')
  assert.equal(u.installKind({ exe: mac, packaged: true, platform: 'darwin' }), 'mac-app')
  const moved = path.join(d, 'AppTranslocation', 'X', 'GmailCleaner.app', 'Contents', 'MacOS', 'GmailCleaner')
  assert.equal(u.installKind({ exe: moved, packaged: true, platform: 'darwin' }), 'manual')
})

test('kiem tra ban moi', async () => {
  const rel = { tag_name: 'v1.1.0', body: 'moi', html_url: 'u', assets: [{ name: 'a', browser_download_url: 'b' }] }
  const r = await u.check(jsonFetch(200, rel), '1.0.0')
  assert.deepEqual([r.version, r.notes, Object.keys(r.assets)], ['1.1.0', 'moi', ['a']])
  assert.equal(await u.check(jsonFetch(200, { tag_name: 'v1.0.0' }), '1.0.0'), null)
  assert.equal(await u.check(jsonFetch(200, { tag_name: 'v0.9.0' }), '1.0.0'), null)
  assert.equal(await u.check(jsonFetch(404, {}), '1.0.0'), null, 'kho chua co ban phat hanh')
  await assert.rejects(u.check(jsonFetch(403, {}), '1.0.0'), /HTTP 403/)
  await assert.rejects(u.check(async () => { throw new Error('khong co mang') }, '1.0.0'), u.UpdateError)
})

test('tai ve + kiem SHA-256', async () => {
  let d = tmp()
  const seen = []
  const f = await u.download(fakeFetch(), release(), 'win-setup', 'x64', (p) => seen.push(p), d)
  assert(fs.readFileSync(f).equals(DATA))
  assert.equal(seen[seen.length - 1], 100)

  const name = u.assetName('win-setup', '9.9.9')
  d = tmp()
  await u.download(fakeFetch(`${SHA}  ${name}\n`), release({ digest: null, sums: true }), 'win-setup', 'x64', undefined, d)
  assert.deepEqual(fs.readdirSync(d), [name], 'dung SHA256SUMS.txt khi asset khong co digest')

  d = tmp()
  await assert.rejects(u.download(fakeFetch(), release({ digest: `sha256:${'0'.repeat(64)}` }), 'win-setup', 'x64', undefined, d), /SHA-256/)
  assert.deepEqual(fs.readdirSync(d), [], 'file sai ma phai bi xoa')
  await assert.rejects(u.download(fakeFetch(), release({ digest: null }), 'win-setup', 'x64', undefined, tmp()), /SHA-256/)
  await assert.rejects(u.download(fakeFetch(), release({ name: 'khac.exe' }), 'win-setup', 'x64', undefined, tmp()), /chưa có file/)
})

// Script bash thay .app chi dung tren macOS (chay duoc ca tren Linux). Tren Windows
// "bash" la trinh khoi dong WSL, khong co distro thi thoat ma 1 -> bo qua.
if (process.platform !== 'win32') {
  const setup = () => {
    const d = tmp()
    const target = path.join(d, 'Thu muc co dau cach', 'GmailCleaner.app')
    const neu = path.join(d, 'new', 'GmailCleaner.app')
    for (const [app, ver] of [[target, 'cu'], [neu, 'moi']]) {
      fs.mkdirSync(app, { recursive: true })
      fs.writeFileSync(path.join(app, 'ver.txt'), ver)
    }
    return { target, neu, log: path.join(d, 'log.txt'), ver: () => fs.readFileSync(path.join(target, 'ver.txt'), 'utf8') }
  }
  const exit = (p) => new Promise((r) => p.on('exit', r))
  const DEAD_PID = 2 ** 22 + 12345 // khong co tien trinh nao mang so nay
  process.env.GC_UPDATE_NO_RELAUNCH = '1'

  test('mac: thay .app', async () => {
    const s = setup()
    assert.equal(await exit(u.launchMacHelper(s.neu, s.target, DEAD_PID, s.log)), 0, fs.existsSync(s.log) && fs.readFileSync(s.log, 'utf8'))
    assert.equal(s.ver(), 'moi')
    assert(!fs.existsSync(`${s.target}.old`) && !fs.existsSync(s.neu))
  })

  test('mac: cho app cu thoat roi moi thay', async () => {
    const s = setup()
    const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'])
    const p = u.launchMacHelper(s.neu, s.target, app.pid, s.log)
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(s.ver(), 'cu', 'app con chay thi chua duoc thay')
    assert.equal(await exit(p), 0)
    assert.equal(s.ver(), 'moi')
  })

  test('mac: loi thi tra lai ban cu', async () => {
    const s = setup()
    assert.equal(await exit(u.launchMacHelper(path.join(s.neu, '..', 'khong-co.app'), s.target, DEAD_PID, s.log)), 1)
    assert.equal(s.ver(), 'cu')
  })
}

;(async () => {
  setInterval(() => {}, 1000) // tien trinh tro giup da unref: giu node song toi khi xong
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log('OK  ', name) } catch (e) { failed++; console.log('LOI ', name, '\n', e.stack || e) }
  }
  console.log(failed ? `${failed} BAI LOI` : `TAT CA ${tests.length} BAI DAT`)
  process.exit(failed ? 1 : 0)
})()
