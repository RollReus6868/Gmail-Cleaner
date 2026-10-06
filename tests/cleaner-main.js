// Kiem thu loi xoa thu (src/cleaner.js) voi Gmail gia lap, chay trong Electron that:
//   npx electron tests/cleaner-main.js        (Linux: xvfb-run -a npx electron --no-sandbox tests/cleaner-main.js)
const path = require('path')
process.env.GC_GMAIL_URL = require('url').pathToFileURL(path.join(__dirname, 'mock_gmail.html')).href

const assert = require('assert')
const { app, BrowserWindow } = require('electron')
const cleaner = require('../src/cleaner')

const COUNTS = { inbox: 430, 'category/social': 250, 'category/promotions': 120, spam: 30 }
let wc

async function seed(size = 50, overflow = 'prev', trustedOnly = false) {
  await wc.loadURL(cleaner.GMAIL_URL)
  await wc.executeJavaScript(`seed(${JSON.stringify(COUNTS)}, ${size}, '${overflow}', ${trustedOnly})`)
  wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
}

async function sizes() {
  const d = await wc.executeJavaScript('dump()')
  return [d.size, Object.fromEntries(Object.entries(d.labels).map(([k, v]) => [k, v.length])), d.labels]
}

function make(logs, stopAfter = null) {
  const tick = () => { if (stopAfter !== null && logs.length >= stopAfter) throw new cleaner.Stopped() }
  return new cleaner.Cleaner(wc, (level, msg) => logs.push([level, msg]), tick)
}

async function main() {
  const win = new BrowserWindow({ width: 1000, height: 800 })
  wc = win.webContents

  // 1. Xoa tu trang 3: giu dung 200 thu moi nhat moi muc, don sach thung rac.
  //    Lan dau nut chi nhan CHUOT THAT (nhu Gmail that), lan sau nhan ca JS.
  for (const [overflow, trustedOnly] of [['prev', true], ['stay', false]]) {
    await seed(50, overflow, trustedOnly)
    const c = make([])
    await c.login()
    await c.run(['inbox', 'social'], 3, true)
    const [size, n, labels] = await sizes()
    assert.equal(size, 100)
    assert.deepEqual(n, { trash: 0, inbox: 200, 'category/social': 200, 'category/promotions': 120, spam: 30 })
    assert.deepEqual(labels.inbox, Array.from({ length: 200 }, (_, i) => `inbox-${i + 1}`), 'phai giu 200 thu dau')
    assert.equal(c.deleted, 230 + 50 + 280)
    console.log(`OK  [${overflow}${trustedOnly ? ', chi chuot that' : ''}] xoa tu trang 3 + don thung rac`)
  }

  // 2. Xoa tu trang 1, khong don thung rac, co ca Thu rac (xoa vinh vien)
  await seed()
  let c = make([])
  await c.login()
  await c.run(['promotions', 'spam'], 1, false)
  let [, n] = await sizes()
  assert.deepEqual(n, { trash: 120, inbox: 430, 'category/social': 250, 'category/promotions': 0, spam: 0 })
  console.log('OK  xoa tu trang 1, giu thung rac')

  // 3. Trang bat dau lon hon so trang hien co: khong duoc xoa gi
  await seed()
  c = make([])
  await c.login()
  await c.run(['promotions'], 5, false)
  ;[, n] = await sizes()
  assert(n['category/promotions'] === 120 && n.trash === 0, JSON.stringify(n))
  console.log('OK  trang vuot qua so trang: khong xoa gi')

  // 4. Bam Dung giua chung: dung lai, khong dong vao muc chua toi
  await seed(100)
  c = make([], 4)
  await c.login()
  await assert.rejects(c.run(['inbox', 'social'], 1, true), cleaner.Stopped)
  ;[, n] = await sizes()
  assert(n['category/social'] === 250 && n.inbox > 0 && n.inbox < 430, JSON.stringify(n))
  console.log('OK  dung giua chung')

  // 5. Khong doc duoc o dem "101-200": phai tu choi xoa tu trang > 1
  await seed(100)
  const saved = cleaner.SEL.counter
  cleaner.SEL.counter = '.khong-ton-tai'
  const logs = []
  c = make(logs)
  await c.login()
  await c.run(['inbox'], 2, false)
  cleaner.SEL.counter = saved
  ;[, n] = await sizes()
  assert.equal(n.inbox, 430)
  assert(logs.some(([level]) => level === 'warn'))
  console.log('OK  khong chac trang thi khong xoa')
  console.log('TAT CA DAT')
}

app.whenReady().then(main).then(() => app.exit(0), (e) => { console.log(e.stack || e); app.exit(1) })
