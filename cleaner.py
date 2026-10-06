"""Tu dong hoa Gmail bang Playwright.

Moi selector cua Gmail nam trong SEL / TEXT ben duoi. Neu Google doi giao dien,
chi can sua o day.
"""
import os
import re

GMAIL_URL = os.environ.get("GC_GMAIL_URL", "https://mail.google.com/mail/")
PAGE_SIZE = 100

# id -> (ten hien thi, hash tren Gmail, nut xoa la "Xoa vinh vien")
SECTIONS = {
    "inbox": ("Hộp thư đến", "inbox", False),
    "social": ("Mạng xã hội", "category/social", False),
    "promotions": ("Quảng cáo", "category/promotions", False),
    "updates": ("Cập nhật", "category/updates", False),
    "forums": ("Diễn đàn", "category/forums", False),
    "spam": ("Thư rác", "spam", True),
}
TRASH = ("Thùng rác", "trash", True)

SEL = {
    "main": 'div[role="main"]',
    "rows": 'div[role="main"] tr.zA',
    "select_all": '[gh="tm"] span[role="checkbox"]',
    "delete": '[gh="tm"] div[act="10"]',
    "toolbar_button": '[gh="tm"] [role="button"]',
    "counter": '[gh="tm"] .Dj',  # "101–200 trong số 1.234"
    "save_settings": 'button[guidedhelpid="save_changes_button"]',
    "dialog_ok": '[role="alertdialog"] button[name="ok"]',
}
TEXT = {
    "delete_forever": re.compile(r"^\s*(Delete forever|Xóa vĩnh viễn|Xoá vĩnh viễn)\s*$"),
    "save_settings": re.compile(r"^\s*(Save Changes|Lưu thay đổi)\s*$"),
}

# Tim o chon "so cuoc tro chuyen moi trang" trong Cai dat > Chung: la <select>
# duy nhat co cac lua chon 25, 50, 100 (khong phu thuoc ngon ngu).
FIND_PAGE_SIZE_JS = """() => {
  const sels = [...document.querySelectorAll('select')];
  for (let i = 0; i < sels.length; i++) {
    const t = [...sels[i].options].map(o => o.text.trim());
    if (['25', '50', '100'].every(x => t.includes(x)))
      return { i, opt: t.indexOf('100'), cur: t[sels[i].selectedIndex] };
  }
  return null;
}"""


class Stopped(Exception):
    """Nguoi dung bam Dung."""


class CleanerError(Exception):
    """Loi co thong bao tieng Viet de hien cho nguoi dung."""


class Cleaner:
    def __init__(self, page, log, tick, on_progress=lambda section, deleted: None):
        self.page = page
        self.log = log  # log(level, msg)
        self.tick = tick  # tick() nem Stopped khi nguoi dung bam Dung
        self.on_progress = on_progress
        self.deleted = 0

    # ---- tien ich -------------------------------------------------------
    def _sleep(self, ms):
        self.page.wait_for_timeout(ms)
        self.tick()

    def _wait(self, cond, timeout_s, step_ms=300):
        """Cho den khi cond() dung. Tra ve False neu het gio."""
        for _ in range(int(timeout_s * 1000 / step_ms)):
            if cond():
                return True
            self._sleep(step_ms)
        return cond()

    def _visible(self, selector, has_text=None):
        loc = self.page.locator(selector)
        if has_text:
            loc = loc.filter(has_text=has_text)
        return loc.locator("visible=true")

    def _ready(self):
        return self.page.url.startswith(GMAIL_URL) and self.page.locator(SEL["main"]).count() > 0

    def _hash(self):
        return self.page.evaluate("location.hash")

    def _open(self, hash_):
        """Mo mot muc roi tai lai trang, de chac chan danh sach dang hien la
        cua dung muc do (khong con danh sach cu cua muc truoc)."""
        self.page.evaluate("h => { location.hash = h }", hash_)
        self.page.reload()
        if not self._wait(self._ready, 60):
            raise CleanerError("Gmail tải quá lâu, hãy thử lại.")
        self._sleep(1200)

    # ---- dang nhap ------------------------------------------------------
    def login(self, timeout_s=600):
        """Mo Gmail va cho nguoi dung dang nhap. Tra ve dia chi email."""
        if not self.page.url.startswith(GMAIL_URL):
            self.page.goto(GMAIL_URL)
        if not self._ready():
            self.log("info", "Hãy đăng nhập Gmail trong cửa sổ trình duyệt vừa mở…")
            if not self._wait(self._ready, timeout_s, 1000):
                raise CleanerError("Chưa đăng nhập được Gmail (hết thời gian chờ).")
        m = re.search(r"[\w.+-]+@[\w.-]+\.\w+", self.page.title())
        return m.group(0) if m else "Gmail"

    # ---- cai dat 100 thu/trang -----------------------------------------
    def _page_size_select(self):
        self._open("#settings/general")
        found = {}

        def look():
            found["v"] = self.page.evaluate(FIND_PAGE_SIZE_JS)
            return found["v"] is not None

        self._wait(look, 15)
        return found["v"]

    def set_page_size(self):
        """Dat hien thi 100 cuoc tro chuyen moi trang. Tra ve True neu da xac nhan duoc."""
        info = self._page_size_select()
        if not info or info["opt"] < 0:
            return False
        if info["cur"] == str(PAGE_SIZE):
            self.log("info", "Gmail đã ở chế độ 100 thư mỗi trang.")
            return True
        self.page.locator("select").nth(info["i"]).select_option(index=info["opt"])
        save = self._visible(SEL["save_settings"])
        if save.count() == 0:
            save = self._visible("button", TEXT["save_settings"])
        if save.count() == 0:
            return False
        save.first.click()
        self._wait(lambda: "settings" not in self._hash() and self._ready(), 30)
        info = self._page_size_select()
        ok = bool(info) and info["cur"] == str(PAGE_SIZE)
        if ok:
            self.log("ok", "Đã đặt hiển thị 100 thư mỗi trang.")
        return ok

    # ---- xoa ------------------------------------------------------------
    def _row_count(self):
        return self._visible(SEL["rows"]).count()

    def _range_start(self):
        """So thu tu cua thu dau tien dang hien (vd 201 o trang 3), None neu khong doc duoc."""
        loc = self._visible(SEL["counter"])
        if loc.count() == 0:
            return None
        m = re.search(r"\d[\d.,]*", loc.first.inner_text())
        return int(re.sub(r"\D", "", m.group(0))) if m else None

    def _delete_button(self, forever):
        if forever:
            return self._visible(SEL["toolbar_button"], TEXT["delete_forever"])
        return self._visible(SEL["delete"])

    def clean_view(self, name, hash_, start_page, forever):
        """Xoa het thu tu trang start_page tro di trong mot muc.

        Luon dung o trang start_page: xoa xong, thu cu hon tu don len dung trang
        nay. Truoc MOI lan xoa deu kiem tra lai rang dang o dung trang, neu
        khong chac thi dung muc nay chu khong xoa.
        """
        target = f"#{hash_}/p{start_page}" if start_page > 1 else f"#{hash_}"
        first = (start_page - 1) * PAGE_SIZE + 1
        self.log("info", f"{name}: bắt đầu xóa từ trang {start_page}.")
        self._open(target)
        count = stuck = 0
        while True:
            self.tick()
            n = self._row_count()
            if n == 0:
                break
            if self._hash() != target:
                self.log("info", f"{name}: không còn trang {start_page}.")
                break
            start = self._range_start()
            if start != first and not (start is None and start_page == 1):
                self.log("warn", f"{name}: không xác nhận được đang ở trang {start_page} "
                                 f"(thư đầu trang là {start}, cần {first}) — bỏ qua để an toàn.")
                break
            box = self._visible(SEL["select_all"])
            button = self._delete_button(forever)
            if box.count() == 0:
                raise CleanerError(f"{name}: không tìm thấy ô chọn tất cả của Gmail.")
            if box.first.get_attribute("aria-checked") != "true":
                box.first.click()
                self._wait(lambda: box.first.get_attribute("aria-checked") == "true", 5, 100)
            if button.count() == 0:
                raise CleanerError(f"{name}: không tìm thấy nút xóa của Gmail.")
            button.first.click()
            self._sleep(300)
            ok = self._visible(SEL["dialog_ok"])
            if ok.count():
                ok.first.click()
            gone = self._wait(
                lambda: box.count() == 0 or box.first.get_attribute("aria-checked") != "true", 20)
            if not gone:
                stuck += 1
                if stuck >= 3:
                    raise CleanerError(f"{name}: bấm xóa nhưng Gmail không phản hồi.")
                continue
            stuck = 0
            count += n
            self.deleted += n
            self.on_progress(name, self.deleted)
            self.log("info", f"{name}: đã xóa {count} cuộc trò chuyện.")
            self._sleep(900)
        self.log("ok", f"{name}: xong, đã xóa {count} cuộc trò chuyện.")

    def run(self, sections, start_page, empty_trash):
        if not self.set_page_size():
            if start_page > 1:
                raise CleanerError(
                    "Không đặt được 100 thư mỗi trang nên không xác định được chính xác "
                    f"trang {start_page}. Hãy đặt trong Gmail: Cài đặt > Chung > Kích thước "
                    "trang tối đa = 100, lưu lại rồi chạy lại.")
            self.log("warn", "Không đặt được 100 thư mỗi trang, vẫn xóa với cỡ trang hiện tại.")
        for sid in sections:
            name, hash_, forever = SECTIONS[sid]
            self.on_progress(name, self.deleted)
            self.clean_view(name, hash_, start_page, forever)
        if empty_trash:
            name, hash_, forever = TRASH
            self.on_progress(name, self.deleted)
            self.clean_view(name, hash_, 1, forever)
