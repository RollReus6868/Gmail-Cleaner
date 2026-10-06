// Kiem thu tu cap nhat TU DAU DEN CUOI voi app da dong goi va file phat hanh that.
// Mot may chu gia thay GitHub: bao co ban 9.9.9, file tai ve chinh la bo cai/zip vua
// build. App phai: thay ban moi -> tai -> kiem SHA-256 -> tu thoat -> cai de len.
//   GC_APP=<exe da cai> GC_UPDATE_FILE=<setup.exe hoac .zip> node tests/e2e-update.js
// Khong co GC_UPDATE_FILE (chay tu ma nguon): chi kiem buoc phat hien ban moi.
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { execFileSync } = require('child_process')
const { run, sleep } = require('./lib')
const u = require('../src/updater')

const FILE = process.env.GC_UPDATE_FILE ? path.resolve(process.env.GC_UPDATE_FILE) : null
const WIN = process.platform === 'win32'
const NAME = u.assetName(WIN ? 'win-setup' : 'mac-app', '9.9.9', process.arch)
const exe = process.env.GC_APP ? path.resolve(process.env.GC_APP) : null

const srv = http.createServer((req, res) => {
  if (req.url === '/latest') {
    const assets = FILE ? [{
      name: NAME, browser_download_url: `http://127.0.0.1:${srv.address().port}/file`,
      digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex'),
    }] : []
    res.end(JSON.stringify({ tag_name: 'v9.9.9', body: 'Ban thu nghiem', html_url: 'http://127.0.0.1/', assets }))
  } else if (req.url === '/file' && FILE) {
    res.setHeader('content-length', fs.statSync(FILE).size)
    fs.createReadStream(FILE).pipe(res)
  } else {
    res.statusCode = 404
    res.end()
  }
})

srv.listen(0, '127.0.0.1', () => {
  const env = { GC_UPDATE_API: `http://127.0.0.1:${srv.address().port}/latest`, GC_UPDATE_NO_RELAUNCH: '1' }
  run(9334, env, async ({ ui, exited, dataDir }) => {
    // Dau vet de biet ban cai da that su duoc ghi lai
    const license = exe && WIN ? path.join(path.dirname(exe), 'LICENSE.electron.txt') : null
    const licenseSize = license ? fs.statSync(license).size : 0
    if (license && FILE) fs.appendFileSync(license, '\nDAU VET BAN CU\n')
    const macApp = exe && !WIN ? u.macAppPath(exe) : null
    const inode = macApp && fs.statSync(macApp).ino

    await ui.getByRole('button', { name: 'Có bản mới 9.9.9' }).click({ timeout: 30000 })
    await ui.getByRole('heading', { name: 'Có bản mới 9.9.9' }).waitFor()
    console.log('PHAT HIEN BAN MOI: OK')
    if (!FILE) {
      await ui.getByRole('button', { name: 'Mở trang tải về' }).waitFor()
      console.log('BAN CHAY TU MA NGUON: hien nut mo trang tai ve - OK')
      return
    }
    await ui.getByRole('button', { name: 'Tải và cài bản 9.9.9' }).click()
    const code = await Promise.race([exited, sleep(180000).then(() => 'TREO')])
    assert.notEqual(code, 'TREO', 'app khong tu thoat de cai ban moi')
    console.log('APP DA TU THOAT, ma', code)

    if (WIN) {
      // Cho bo cai NSIS (chay ngam) lam xong: file dau vet tro ve kich thuoc goc
      let size = -1
      for (let i = 0; i < 480 && size !== licenseSize; i++) {
        await sleep(500)
        try { size = fs.statSync(license).size } catch (_) { size = -1 }
      }
      assert.equal(size, licenseSize, 'bo cai khong ghi lai ban cai (file dau vet con nguyen)')
      // cho bo cai thoat han roi moi sang buoc sau
      for (let i = 0; i < 120; i++) {
        if (!execFileSync('tasklist', ['/FO', 'CSV'], { encoding: 'utf8' }).includes(NAME)) break
        await sleep(1000)
      }
      assert(fs.existsSync(exe), 'mat file chay sau khi cap nhat')
    } else {
      const log = path.join(dataDir, 'update.log')
      let text = ''
      for (let i = 0; i < 240 && !/da thay ban moi|tra lai ban cu/.test(text); i++) {
        await sleep(500)
        text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
      }
      console.log('---- update.log\n' + text)
      assert(text.includes('da thay ban moi'), 'khong thay duoc .app')
      assert.notEqual(fs.statSync(macApp).ino, inode, '.app van la ban cu')
      execFileSync('codesign', ['--verify', '--deep', '--strict', macApp], { stdio: 'inherit' })
    }
    console.log('TU CAP NHAT: OK')
  })
})
