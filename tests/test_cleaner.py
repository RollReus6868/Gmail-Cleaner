"""Kiem thu loi xoa thu voi Gmail gia lap (tests/mock_gmail.html).
Chay:  python tests/test_cleaner.py   (GC_BROWSER=/duong/dan/chrome neu khong co Google Chrome)
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["GC_GMAIL_URL"] = (HERE / "mock_gmail.html").as_uri()
sys.path.insert(0, str(HERE.parent))

from playwright.sync_api import sync_playwright  # noqa: E402

import cleaner  # noqa: E402


def make(page, logs, stop_after=None):
    def tick():
        if stop_after is not None and len(logs) >= stop_after:
            raise cleaner.Stopped()
    return cleaner.Cleaner(page, lambda lv, m: logs.append((lv, m)), tick)


def seed(page, counts, size=50, overflow="prev"):
    page.goto(cleaner.GMAIL_URL)
    page.evaluate("([c, s, o]) => seed(c, s, o)", [counts, size, overflow])
    page.reload()


def sizes(page):
    d = page.evaluate("dump()")
    return d["size"], {k: len(v) for k, v in d["labels"].items()}


def main():
    with sync_playwright() as p:
        exe = os.environ.get("GC_BROWSER")
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch(channel="chrome")
        page = browser.new_page()
        counts = {"inbox": 430, "category/social": 250, "category/promotions": 120, "spam": 30}

        for overflow in ("prev", "stay"):
            # 1. Xoa tu trang 3: giu lai dung 200 thu moi nhat moi muc, don sach thung rac
            seed(page, counts, overflow=overflow)
            logs = []
            c = make(page, logs)
            assert c.login() == "test@gmail.com"
            c.run(["inbox", "social"], 3, True)
            size, n = sizes(page)
            assert size == 100, size
            assert n == {"inbox": 200, "category/social": 200, "category/promotions": 120,
                         "spam": 30, "trash": 0}, n
            kept = page.evaluate("dump().labels.inbox")
            assert kept == [f"inbox-{i}" for i in range(1, 201)], "phai giu 200 thu dau"
            assert c.deleted == 230 + 50 + 280, c.deleted
            print(f"OK  [{overflow}] xoa tu trang 3 + don thung rac")

        # 2. Xoa tu trang 1, khong don thung rac, co ca Thu rac (xoa vinh vien)
        seed(page, counts)
        c = make(page, [])
        c.login()
        c.run(["promotions", "spam"], 1, False)
        _, n = sizes(page)
        assert n == {"inbox": 430, "category/social": 250, "category/promotions": 0,
                     "spam": 0, "trash": 120}, n
        print("OK  xoa tu trang 1, giu thung rac")

        # 3. Trang bat dau lon hon so trang hien co: khong duoc xoa gi
        seed(page, counts)
        c = make(page, [])
        c.login()
        c.run(["promotions"], 5, False)
        _, n = sizes(page)
        assert n["category/promotions"] == 120 and n["trash"] == 0, n
        print("OK  trang vuot qua so trang: khong xoa gi")

        # 4. Bam Dung giua chung: dung lai, khong dong vao muc chua toi
        seed(page, counts, size=100)
        logs = []
        c = make(page, logs, stop_after=4)
        c.login()
        try:
            c.run(["inbox", "social"], 1, True)
            raise AssertionError("phai dung giua chung")
        except cleaner.Stopped:
            pass
        _, n = sizes(page)
        assert n["category/social"] == 250 and 0 < n["inbox"] < 430, n
        print("OK  dung giua chung")

        # 5. Khong xac nhan duoc o dem "101-200": phai tu choi xoa tu trang > 1
        seed(page, counts, size=100)
        saved = cleaner.SEL["counter"]
        cleaner.SEL["counter"] = ".khong-ton-tai"
        logs = []
        c = make(page, logs)
        c.login()
        c.run(["inbox"], 2, False)
        cleaner.SEL["counter"] = saved
        _, n = sizes(page)
        assert n["inbox"] == 430, n
        assert any(lv == "warn" for lv, _ in logs)
        print("OK  khong chac trang thi khong xoa")
        browser.close()
    print("TAT CA DAT")


if __name__ == "__main__":
    main()
