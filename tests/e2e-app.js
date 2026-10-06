// Chay that app (ma nguon, hoac ban dong goi qua GC_APP) voi Gmail gia lap nhung
// trong cua so: dang nhap -> chon muc -> xoa tu trang 2 -> don thung rac.
//   node tests/e2e-app.js            (Linux khong man hinh: xvfb-run -a node tests/e2e-app.js)
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { run, sleep } = require('./lib')

run(9333, {}, async ({ ui, find, exited }) => {
  await ui.getByRole('button', { name: 'Bắt đầu xóa' }).waitFor()
  assert.equal(await ui.evaluate(() => typeof window.gc.call), 'function')

  // Kiem tra cap nhat luc mo app: phai noi chuyen duoc voi GitHub qua HTTPS.
  // Loi "HTTP 4xx" (vd bi gioi han luot goi) van chung to HTTPS chay tot.
  let st
  for (let i = 0; i < 120; i++) {
    st = await ui.evaluate(() => window.gc.call('hello'))
    if (!['idle', 'checking'].includes(st.update.status)) break
    await sleep(500)
  }
  console.log('PHIEN BAN', st.version, '| CAP NHAT:', st.update.status, st.update.error)
  assert(['none', 'available'].includes(st.update.status) || st.update.error.startsWith('HTTP '), JSON.stringify(st.update))

  // Khung Gmail nam TRONG cua so, dung vi tri giao dien danh cho no
  const gmail = await find('mock_gmail')
  const pane = await ui.locator('[data-pane]').boundingBox()
  assert(pane.width > 300 && pane.height > 300, JSON.stringify(pane))
  const size = await gmail.evaluate(() => [innerWidth, innerHeight])
  assert(Math.abs(size[0] - pane.width) <= 2 && Math.abs(size[1] - pane.height) <= 2, `khung ${JSON.stringify(pane)} != trang ${size}`)

  // "Nguoi dung dang nhap xong": Gmail gia lap co du lieu -> app tu nhan ra tai khoan
  await gmail.evaluate(() => window.seed({ inbox: 350, 'category/social': 130, 'category/promotions': 90 }, 50))
  await gmail.reload()
  await ui.getByText('Đã đăng nhập: test@gmail.com').waitFor({ timeout: 20000 })

  // Chon Hop thu den + Mang xa hoi (bo Quang cao), xoa tu trang 2
  await ui.getByRole('button', { name: 'Hộp thư đến' }).click()
  await ui.getByRole('button', { name: 'Quảng cáo' }).click()
  await ui.getByRole('spinbutton').fill('2')
  await ui.getByRole('button', { name: 'Bắt đầu xóa' }).click()
  await ui.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click()
  await ui.getByRole('button', { name: 'Dừng' }).waitFor()
  await ui.getByText('Hoàn tất. Tổng cộng đã xóa 560').waitFor({ timeout: 120000 })
  await ui.getByRole('button', { name: 'Bắt đầu xóa' }).waitFor()
  const d = await gmail.evaluate(() => window.dump())
  const n = Object.fromEntries(Object.entries(d.labels).map(([k, v]) => [k, v.length]))
  assert.equal(d.size, 100)
  assert.deepEqual(n, { trash: 0, inbox: 100, 'category/social': 100, 'category/promotions': 90 })
  fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true })
  await ui.screenshot({ path: path.join(__dirname, 'screenshots', 'e2e-ui.png') }).catch(() => {})
  console.log('E2E OK', JSON.stringify(n))

  // Dong cua so -> chuong trinh tu thoat
  await ui.evaluate(() => window.close()).catch(() => {})
  const code = await Promise.race([exited, sleep(20000).then(() => 'TREO')])
  assert.notEqual(code, 'TREO', 'app khong thoat sau khi dong cua so')
  console.log('THOAT SACH, ma thoat', code)
})
