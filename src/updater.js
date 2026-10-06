// Tu cap nhat qua GitHub Releases. Khong require('electron') o dau file nen
// chay duoc bang node thuong de kiem thu (tests/updater-test.js).
//
// Ten file trong Release la co dinh (workflow build.yml sinh dung cac ten nay):
//   GmailCleaner-<ver>-windows-setup.exe   bo cai NSIS
//   GmailCleaner-<ver>-mac-arm64.zip       .app nen
//   GmailCleaner-<ver>-mac-x64.zip
//   SHA256SUMS.txt                         du phong khi asset khong co digest
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const pkg = require('../package.json')

const APP = pkg.productName
const REPO = pkg.repository.url.replace(/^.*github\.com\//, '').replace(/\.git$/, '')
// GC_UPDATE_API: tro toi may chu gia khi kiem thu (tests/e2e-update.js)
const API = process.env.GC_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

class UpdateError extends Error {}

const parseVersion = (s) => (String(s).match(/\d+/g) || []).slice(0, 3).map(Number)
function newer(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

// .../GmailCleaner.app/Contents/MacOS/GmailCleaner -> .../GmailCleaner.app
function macAppPath(exe) {
  const app = path.dirname(path.dirname(path.dirname(exe)))
  return app.endsWith('.app') ? app : null
}

// win-setup | mac-app | manual (manual = chi mo trang tai ve)
function installKind({ exe, packaged, platform }) {
  if (!packaged) return 'manual'
  if (platform === 'win32') {
    return fs.existsSync(path.join(path.dirname(exe), `Uninstall ${APP}.exe`)) ? 'win-setup' : 'manual'
  }
  if (platform === 'darwin') {
    const app = macAppPath(exe)
    // AppTranslocation: macOS chay app tu ban sao chi doc -> khong tu thay duoc
    if (app && !app.includes('AppTranslocation')) {
      try { fs.accessSync(path.dirname(app), fs.constants.W_OK); return 'mac-app' } catch (_) { /* khong ghi duoc */ }
    }
  }
  return 'manual'
}

function assetName(kind, version, arch) {
  if (kind === 'win-setup') return `${APP}-${version}-windows-setup.exe`
  return `${APP}-${version}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
}

async function get(fetchFn, url) {
  let res
  try {
    res = await fetchFn(url, { headers: { 'User-Agent': `${APP}/${pkg.version}`, Accept: 'application/vnd.github+json' } })
  } catch (e) {
    throw new UpdateError(e.message)
  }
  return res
}

// Tra ve thong tin ban moi nhat neu moi hon ban dang chay, null neu khong.
async function check(fetchFn, current = pkg.version) {
  const res = await get(fetchFn, API)
  if (res.status === 404) return null // kho chua co ban phat hanh nao
  if (!res.ok) throw new UpdateError(`HTTP ${res.status}`)
  let rel
  try { rel = await res.json() } catch (e) { throw new UpdateError(e.message) }
  const latest = String(rel.tag_name || '').replace(/^v/, '')
  if (!newer(latest, current)) return null
  const assets = {}
  for (const a of rel.assets || []) assets[a.name] = a
  return { version: latest, notes: rel.body || '', url: rel.html_url || RELEASES_PAGE, assets }
}

async function expectedSha256(fetchFn, release, name) {
  const digest = release.assets[name].digest || ''
  if (digest.startsWith('sha256:')) return digest.slice(7).toLowerCase()
  const sums = release.assets['SHA256SUMS.txt']
  if (sums) {
    const res = await get(fetchFn, sums.browser_download_url)
    if (!res.ok) throw new UpdateError(`HTTP ${res.status}`)
    for (const line of (await res.text()).split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length === 2 && parts[1].replace(/^\*/, '') === name) return parts[0].toLowerCase()
    }
  }
  throw new UpdateError('Bản phát hành không có mã kiểm tra SHA-256, không cài để đảm bảo an toàn.')
}

// Tai file cap nhat, kiem SHA-256. Tra ve duong dan file.
async function download(fetchFn, release, kind, arch, progress = () => {}, destDir) {
  const name = assetName(kind, release.version, arch)
  if (!release.assets[name]) throw new UpdateError(`Bản ${release.version} chưa có file ${name}.`)
  const want = await expectedSha256(fetchFn, release, name)
  const res = await get(fetchFn, release.assets[name].browser_download_url)
  if (!res.ok) throw new UpdateError(`HTTP ${res.status}`)
  const dest = path.join(destDir || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-update-')), name)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(dest)
  let done = 0
  let last = -1
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      hash.update(value)
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      done += value.length
      const pct = total ? Math.floor((done * 100) / total) : 0
      if (pct !== last) progress((last = pct))
    }
  } catch (e) {
    throw new UpdateError(e.message)
  } finally {
    await new Promise((r) => out.end(r))
  }
  if (hash.digest('hex') !== want) {
    fs.rmSync(dest, { force: true })
    throw new UpdateError('File tải về bị hỏng (sai mã SHA-256). Hãy thử lại.')
  }
  return dest
}

// ---- cai dat: goi ngay truoc khi app thoat ---------------------------------------

const MAC_HELPER = `#!/bin/bash
# Thay GmailCleaner.app bang ban moi sau khi app cu thoat. Loi thi tra lai ban cu.
exec >>"$GC_LOG" 2>&1
echo "== $(date) pid=$GC_PID new=$GC_NEW target=$GC_TARGET"
for i in $(seq 1 120); do kill -0 "$GC_PID" 2>/dev/null || break; sleep 0.5; done
OLD="$GC_TARGET.old"
rm -rf "$OLD"
mv "$GC_TARGET" "$OLD" || { echo "khong doi ten duoc ban cu"; exit 1; }
if mv "$GC_NEW" "$GC_TARGET"; then
  rm -rf "$OLD"
  echo "da thay ban moi"
else
  echo "loi, tra lai ban cu"
  mv "$OLD" "$GC_TARGET"
  exit 1
fi
[ -n "$GC_UPDATE_NO_RELAUNCH" ] || open "$GC_TARGET"
`

// Chay script thay .app, tach khoi tien trinh hien tai. Tra ve tien trinh con.
function launchMacHelper(newApp, targetApp, pid, log) {
  const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-helper-')), 'update.sh')
  fs.writeFileSync(script, MAC_HELPER)
  const env = { ...process.env, GC_PID: String(pid), GC_NEW: newApp, GC_TARGET: targetApp, GC_LOG: log }
  const p = spawn('/bin/bash', [script], { env, detached: true, stdio: 'ignore' })
  p.unref()
  return p
}

// Bat dau cai ban moi. App phai thoat ngay sau khi goi ham nay.
function apply(kind, file, { exe, log }) {
  if (kind === 'win-setup') {
    // NSIS: /S im lang, --updated giu thu muc cai cu, --force-run cai xong mo lai app.
    // Bo cai tu dong app cu neu no con chay.
    const args = ['/S', '--updated'].concat(process.env.GC_UPDATE_NO_RELAUNCH ? [] : ['--force-run'])
    spawn(file, args, { detached: true, stdio: 'ignore' }).unref()
  } else if (kind === 'mac-app') {
    const out = path.join(path.dirname(file), 'unzipped')
    // ditto giu symlink va chu ky cua .app
    execFileSync('/usr/bin/ditto', ['-x', '-k', file, out])
    launchMacHelper(path.join(out, `${APP}.app`), macAppPath(exe), process.pid, log)
  } else {
    throw new UpdateError('Kiểu cài đặt này không tự cập nhật được.')
  }
}

module.exports = {
  APP, REPO, RELEASES_PAGE, UpdateError, parseVersion, newer, macAppPath, installKind, assetName,
  check, download, apply, launchMacHelper,
}
