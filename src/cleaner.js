// Tu dong hoa Gmail trong khung trinh duyet nhung (webContents cua Electron).
// Moi selector cua Gmail nam trong SEL / TEXT. Neu Google doi giao dien, chi sua o day.

const GMAIL_URL = process.env.GC_GMAIL_URL || 'https://mail.google.com/mail/'
const PAGE_SIZE = 100

// id -> [ten hien thi, hash tren Gmail, nut xoa la "Xoa vinh vien"]
const SECTIONS = {
  inbox: ['Hộp thư đến', 'inbox', false],
  social: ['Mạng xã hội', 'category/social', false],
  promotions: ['Quảng cáo', 'category/promotions', false],
  updates: ['Cập nhật', 'category/updates', false],
  forums: ['Diễn đàn', 'category/forums', false],
  spam: ['Thư rác', 'spam', true],
}
const TRASH = ['Thùng rác', 'trash', true]

const SEL = {
  main: 'div[role="main"]',
  rows: 'div[role="main"] tr.zA',
  selectAll: '[gh="tm"] span[role="checkbox"]',
  delete: '[gh="tm"] div[act="10"]',
  toolbarButton: '[gh="tm"] [role="button"]',
  counter: '[gh="tm"] .Dj', // "101–200 trong số 1.234"
  saveSettings: 'button[guidedhelpid="save_changes_button"]',
  dialogOk: '[role="alertdialog"] button[name="ok"]',
}
const TEXT = {
  deleteForever: '^\\s*(Delete forever|Xóa vĩnh viễn|Xoá vĩnh viễn)\\s*$',
  saveSettings: '^\\s*(Save Changes|Lưu thay đổi)\\s*$',
  // dong chu tren dau Thung rac: "Thu trong Thung rac se duoc tu dong xoa sau 30 ngay. Don sach thung rac ngay"
  emptyTrash: '^\\s*(Empty Trash now|Dọn sạch thùng rác ngay)\\s*$',
  ok: '^\\s*(OK|Đồng ý)\\s*$', // nut xac nhan trong hop "Xac nhan xoa thu"
}

class Stopped extends Error {}
class CleanerError extends Error {}

// ---- Cac ham duoi day chay BEN TRONG trang Gmail (duoc chuyen thanh chuoi) --------
// Dung chung: q(sel) = cac phan tu DANG HIEN khop selector (Gmail giu ca thanh
// cong cu cu cua muc khac o dang an).
const PRELUDE = `
  const q = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0);
  const byText = (sel, re) => q(sel).filter((el) => new RegExp(re, 'iu').test(el.textContent));
`
const inPage = {
  hasMain: (SEL) => !!document.querySelector(SEL.main),
  rowCount: (SEL) => q(SEL.rows).length,
  counterText: (SEL) => (q(SEL.counter)[0] ? q(SEL.counter)[0].innerText : null),
  boxState: (SEL) => (q(SEL.selectAll)[0] ? q(SEL.selectAll)[0].getAttribute('aria-checked') : null),
  // Tim o chon "so cuoc tro chuyen moi trang": la <select> duy nhat co 25, 50, 100.
  pageSize: () => {
    const sels = [...document.querySelectorAll('select')]
    for (let i = 0; i < sels.length; i++) {
      const t = [...sels[i].options].map((o) => o.text.trim())
      if (['25', '50', '100'].every((x) => t.includes(x))) return { i, opt: t.indexOf('100'), cur: t[sels[i].selectedIndex] }
    }
    return null
  },
  setPageSize: (i, opt) => {
    const sel = document.querySelectorAll('select')[i]
    sel.selectedIndex = opt
    sel.dispatchEvent(new Event('input', { bubbles: true }))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  },
  // Tim mot nut theo loai; tra ve toa do tam (de bam chuot that) hoac bam bang JS.
  target: (SEL, TEXT, kind, jsClick) => {
    const el = {
      box: () => q(SEL.selectAll)[0],
      delete: () => q(SEL.delete)[0],
      forever: () => byText(SEL.toolbarButton, TEXT.deleteForever)[0],
      ok: () => q(SEL.dialogOk)[0] || byText('[role="alertdialog"] button, [role="dialog"] button', TEXT.ok)[0],
      // phan tu trong cung mang dung dong chu do (phan tu con dung sau phan tu cha)
      emptyTrash: () => byText('span, a, [role="button"], [role="link"]', TEXT.emptyTrash).pop(),
      save: () => q(SEL.saveSettings)[0] || byText('button', TEXT.saveSettings)[0],
    }[kind]()
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    if (jsClick) {
      for (const type of ['mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      }
    }
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  },
}

class Cleaner {
  // wc: webContents cua khung Gmail; log(level, msg); tick() nem Stopped khi bam Dung
  constructor(wc, log, tick, onProgress = () => {}) {
    Object.assign(this, { wc, log, tick, onProgress, deleted: 0 })
  }

  // ---- tien ich -------------------------------------------------------
  js(fn, ...args) {
    const code = `(() => { ${PRELUDE}; return (${fn})(...${JSON.stringify(args)}) })()`
    return this.wc.executeJavaScript(code, true)
  }

  async sleep(ms) {
    await new Promise((r) => setTimeout(r, ms))
    this.tick()
  }

  // Cho den khi cond() dung; tra ve false neu het gio. Gmail tu tai lai trang
  // (vd sau khi luu cai dat) thi cau hoi dang do bi loi -> coi nhu chua xong.
  async wait(cond, timeoutS, stepMs = 300) {
    const check = async () => {
      try { return !!(await cond()) } catch (e) { if (e instanceof Stopped) throw e; return false }
    }
    for (let i = 0; i < (timeoutS * 1000) / stepMs; i++) {
      if (await check()) return true
      await this.sleep(stepMs)
    }
    return check()
  }

  async ready() {
    return this.wc.getURL().startsWith(GMAIL_URL) && !this.wc.isLoading() && (await this.js(inPage.hasMain, SEL))
  }

  hash() {
    const i = this.wc.getURL().indexOf('#')
    return i < 0 ? '' : this.wc.getURL().slice(i)
  }

  // Mo mot muc roi tai lai trang, de chac chan danh sach dang hien la cua dung
  // muc do (khong con danh sach cu cua muc truoc).
  async open(hash) {
    await this.js((h) => { location.hash = h }, hash)
    await this.sleep(200)
    this.wc.reload()
    await this.sleep(500)
    if (!(await this.wait(() => this.ready(), 60))) throw new CleanerError('Gmail tải quá lâu, hãy thử lại.')
    await this.sleep(1200)
  }

  // Bam chuot THAT vao nut (Gmail nghe mousedown/mouseup); jsClick=true thi bam bang JS.
  async click(kind, jsClick = false) {
    const p = await this.js(inPage.target, SEL, TEXT, kind, jsClick)
    if (!p) return false
    if (!jsClick) {
      const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 }
      this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
      this.wc.sendInputEvent({ ...base, type: 'mouseDown' })
      this.wc.sendInputEvent({ ...base, type: 'mouseUp' })
    }
    return true
  }

  // Bam chuot that, cho xem co tac dung khong; khong thi thu bam bang JS mot lan.
  async clickUntil(kind, done, realS, jsS) {
    if (!(await this.click(kind))) return null // khong tim thay nut
    if (await this.wait(done, realS)) return true
    await this.click(kind, true)
    return this.wait(done, jsS)
  }

  // ---- dang nhap ------------------------------------------------------
  async login(timeoutS = 600) {
    if (!this.wc.getURL().startsWith(GMAIL_URL)) this.wc.loadURL(GMAIL_URL).catch(() => {})
    if (!(await this.wait(() => this.ready(), 3))) {
      this.log('info', 'Hãy đăng nhập Gmail ở khung trình duyệt bên phải…')
      if (!(await this.wait(() => this.ready(), timeoutS, 1000))) {
        throw new CleanerError('Chưa đăng nhập được Gmail (hết thời gian chờ).')
      }
    }
  }

  // ---- cai dat 100 thu/trang -----------------------------------------
  async pageSizeSelect() {
    await this.open('#settings/general')
    let info = null
    await this.wait(async () => (info = await this.js(inPage.pageSize)) !== null, 15)
    return info
  }

  // Dat hien thi 100 cuoc tro chuyen moi trang. Tra ve true neu da xac nhan duoc.
  async setPageSize() {
    let info = await this.pageSizeSelect()
    if (!info || info.opt < 0) return false
    if (info.cur === String(PAGE_SIZE)) {
      this.log('info', 'Gmail đã ở chế độ 100 thư mỗi trang.')
      return true
    }
    await this.js(inPage.setPageSize, info.i, info.opt)
    await this.sleep(300)
    const saved = await this.clickUntil('save', async () => !this.hash().includes('settings') && (await this.ready()), 12, 20)
    if (!saved) return false
    info = await this.pageSizeSelect()
    const ok = !!info && info.cur === String(PAGE_SIZE)
    if (ok) this.log('ok', 'Đã đặt hiển thị 100 thư mỗi trang.')
    return ok
  }

  // ---- xoa ------------------------------------------------------------
  // So thu tu cua thu dau tien dang hien (vd 201 o trang 3), null neu khong doc duoc.
  async rangeStart() {
    const m = /\d[\d.,]*/.exec((await this.js(inPage.counterText, SEL)) || '')
    return m ? parseInt(m[0].replace(/\D/g, ''), 10) : null
  }

  // Xoa het thu tu trang startPage tro di trong mot muc. Luon dung o trang
  // startPage: xoa xong, thu cu hon tu don len dung trang nay. Truoc MOI lan xoa
  // deu kiem tra lai rang dang o dung trang; khong chac thi dung muc nay chu khong xoa.
  async cleanView(name, hash, startPage, forever) {
    const target = startPage > 1 ? `#${hash}/p${startPage}` : `#${hash}`
    const first = (startPage - 1) * PAGE_SIZE + 1
    this.log('info', `${name}: bắt đầu xóa từ trang ${startPage}.`)
    await this.open(target)
    let count = 0
    let stuck = 0
    for (;;) {
      this.tick()
      const n = await this.js(inPage.rowCount, SEL)
      if (n === 0) break
      if (this.hash() !== target) {
        this.log('info', `${name}: không còn trang ${startPage}.`)
        break
      }
      const start = await this.rangeStart()
      if (start !== first && !(start === null && startPage === 1)) {
        this.log('warn', `${name}: không xác nhận được đang ở trang ${startPage} (thư đầu trang là ${start}, cần ${first}) — bỏ qua để an toàn.`)
        break
      }
      const checked = async () => (await this.js(inPage.boxState, SEL)) === 'true'
      if (!(await checked())) {
        const ok = await this.clickUntil('box', checked, 3, 5)
        if (ok === null) throw new CleanerError(`${name}: không tìm thấy ô chọn tất cả của Gmail.`)
        if (!ok) throw new CleanerError(`${name}: không chọn được tất cả thư.`)
      }
      const gone = async () => {
        if (await this.click('ok')) await this.sleep(300) // hop xac nhan (neu co)
        return (await this.js(inPage.boxState, SEL)) !== 'true'
      }
      const deleted = await this.clickUntil(forever ? 'forever' : 'delete', gone, 10, 15)
      if (deleted === null) throw new CleanerError(`${name}: không tìm thấy nút xóa của Gmail.`)
      if (!deleted) {
        if (++stuck >= 3) throw new CleanerError(`${name}: bấm xóa nhưng Gmail không phản hồi.`)
        continue
      }
      stuck = 0
      count += n
      this.deleted += n
      this.onProgress(name, this.deleted)
      this.log('info', `${name}: đã xóa ${count} cuộc trò chuyện.`)
      await this.sleep(900)
    }
    this.log('ok', `${name}: xong, đã xóa ${count} cuộc trò chuyện.`)
  }

  // Don sach Thung rac bang nut "Don sach thung rac ngay" cua Gmail: mot lan bam la
  // xoa HET, khong phai tung trang 100 thu. Khong thay nut thi moi xoa tung trang.
  async emptyTrash() {
    const [name, hash, forever] = TRASH
    this.onProgress(name, this.deleted)
    await this.open(`#${hash}`)
    const empty = async () => (await this.js(inPage.rowCount, SEL)) === 0
    if (await empty()) {
      this.log('ok', `${name}: đã trống sẵn.`)
      return
    }
    // "1–100 trong so 1.234" -> 1234 (chi de bao cao)
    const nums = ((await this.js(inPage.counterText, SEL)) || '').match(/\d[\d.,]*/g) || []
    const total = nums.length ? parseInt(nums[nums.length - 1].replace(/\D/g, ''), 10) : 0
    const asked = await this.clickUntil('emptyTrash', () => this.js(inPage.target, SEL, TEXT, 'ok', false), 4, 6)
    if (asked) {
      this.log('info', `${name}: đã bấm "Dọn sạch thùng rác ngay", đang chờ Gmail xóa…`)
      const done = await this.clickUntil('ok', empty, 60, 60)
      if (done) {
        this.deleted += total
        this.onProgress(name, this.deleted)
        this.log('ok', `${name}: đã dọn sạch${total ? ` ${total} cuộc trò chuyện` : ''}.`)
        return
      }
    }
    this.log('warn', `${name}: không dùng được nút "Dọn sạch thùng rác ngay", chuyển sang xóa từng trang.`)
    await this.cleanView(name, hash, 1, forever)
  }

  async run(sections, startPage, emptyTrash) {
    if (!(await this.setPageSize())) {
      if (startPage > 1) {
        throw new CleanerError(
          `Không đặt được 100 thư mỗi trang nên không xác định được chính xác trang ${startPage}. ` +
          'Hãy đặt trong Gmail: Cài đặt > Chung > Kích thước trang tối đa = 100, lưu lại rồi chạy lại.')
      }
      this.log('warn', 'Không đặt được 100 thư mỗi trang, vẫn xóa với cỡ trang hiện tại.')
    }
    for (const id of sections) {
      const [name, hash, forever] = SECTIONS[id]
      this.onProgress(name, this.deleted)
      await this.cleanView(name, hash, startPage, forever)
    }
    if (emptyTrash) await this.emptyTrash()
  }
}

module.exports = { Cleaner, Stopped, CleanerError, SECTIONS, SEL, GMAIL_URL, PAGE_SIZE }
