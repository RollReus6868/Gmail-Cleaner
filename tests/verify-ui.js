// Kiem tra giao dien trong trinh duyet thuong (khong can Electron): chup anh sang/toi
// o 2 co cua so, bat loi console, tran ngang, nut bi cat.
//   cd ui && npx vite preview --port 4173 &      roi:  GC_BROWSER=/duong/dan/chrome node tests/verify-ui.js
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const URL = 'http://localhost:4173/'
const OUT = path.join(__dirname, 'screenshots')
const problems = []
const overflow = () => {
  const bad = []
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('trang tran ngang')
  for (const el of document.querySelectorAll('button, input, h1, h2, [role=switch]')) {
    const r = el.getBoundingClientRect()
    const box = el.closest('main, section, aside').getBoundingClientRect()
    if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) {
      bad.push('bi cat: ' + (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30))
    }
  }
  return bad
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const exe = process.env.GC_BROWSER
  const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'chrome' })
  for (const mode of ['light', 'dark']) {
    for (const [width, height] of [[1400, 860], [1100, 640]]) {
      const ctx = await browser.newContext({ viewport: { width, height } })
      await ctx.addInitScript(`localStorage.setItem('gmail-cleaner-mode', '${mode}')`)
      const page = await ctx.newPage()
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
      page.on('pageerror', (e) => problems.push(`pageerror: ${e}`))
      const tag = `${mode}-${width}`
      const check = async (name) => {
        problems.push(...(await page.evaluate(overflow)).map((b) => `${tag} ${name}: ${b}`))
        await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) })
      }
      for (const [name, query] of [['trong', ''], ['demo', '?demo']]) {
        await page.goto(URL + query)
        await page.waitForTimeout(400)
        assert.equal((await page.evaluate(() => document.documentElement.className)).includes('dark'), mode === 'dark')
        const pane = await page.locator('[data-pane]').boundingBox()
        assert(pane.width >= 380 && pane.height >= 400, `${tag}: khung Gmail qua nho ${JSON.stringify(pane)}`)
        await check(name)
      }
      // trang cap nhat (du lieu mau: co ban moi 1.1.0)
      await page.getByRole('button', { name: 'Có bản mới 1.1.0' }).click()
      await page.getByRole('button', { name: 'Tải và cài bản 1.1.0' }).waitFor()
      await check('update')
      // hop thoai xac nhan phai nam TRONG cot dieu khien (khung Gmail la lop ve rieng, se che no)
      await page.goto(URL)
      await page.getByRole('button', { name: 'Bắt đầu xóa' }).click()
      const dlg = await page.getByRole('dialog').boundingBox()
      const pane = await page.locator('[data-pane]').boundingBox()
      assert(dlg.x + dlg.width <= pane.x, `${tag}: hop thoai de len khung Gmail`)
      await check('dialog')
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog').count(), 0)
      // tuy chon duoc luu lai
      await page.getByRole('button', { name: 'Diễn đàn' }).click()
      await page.reload()
      assert.equal(await page.getByRole('button', { name: 'Diễn đàn' }).getAttribute('aria-pressed'), 'true')
      // trang cai dat + doi chu de + luu lai sau khi tai lai
      await page.getByRole('button', { name: 'Cài đặt' }).click()
      await page.locator('[data-theme="sunset"]').click()
      await page.waitForTimeout(200)
      await check('settings')
      await page.reload()
      const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'))
      assert(/^(25|30) /.test(primary.trim()), primary)
      // thanh ben mo rong / thu gon
      const before = (await page.locator('aside').boundingBox()).width
      await page.getByRole('button', { name: before < 100 ? 'Mở rộng' : 'Thu gọn' }).click()
      await page.waitForTimeout(300)
      assert.notEqual((await page.locator('aside').boundingBox()).width, before)
      await ctx.close()
    }
  }
  await browser.close()
  if (problems.length) { console.log(problems.join('\n')); process.exit(1) }
  console.log('ALL CHECKS PASSED')
})().catch((e) => { console.log(e.stack || e); process.exit(1) })
