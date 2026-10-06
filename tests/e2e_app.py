"""Chay that app.py (2 cua so) voi Gmail gia lap, dieu khien giao dien qua CDP.
    xvfb-run -a env GC_BROWSER=/duong/dan/chrome python tests/e2e_app.py
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "screenshots"
OUT.mkdir(exist_ok=True)
env = dict(os.environ,
           GC_GMAIL_URL=(HERE / "mock_gmail.html").as_uri(),
           GC_ARGS="--remote-debugging-port=9333",
           GC_DATA_DIR=tempfile.mkdtemp())


def find(ctx, key):
    """Cho den khi co cua so co dia chi chua `key`."""
    for _ in range(60):
        for pg in ctx.pages:
            if key in pg.url:
                return pg
        ctx.pages[0].wait_for_timeout(250)  # time.sleep se khong cap nhat dia chi
    raise AssertionError(f"khong thay cua so {key}: {[pg.url for pg in ctx.pages]}")


# GC_APP=duong/dan/GmailCleaner de thu ban da dong goi thay vi ma nguon
cmd = [str(Path(os.environ["GC_APP"]).resolve())] if os.environ.get("GC_APP") else [sys.executable, str(HERE.parent / "app.py")]
proc = subprocess.Popen(cmd, env=env)
try:
    with sync_playwright() as p:
        for _ in range(40):
            try:
                browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
                break
            except Exception:
                time.sleep(0.5)
        ctx = browser.contexts[0]
        ui = find(ctx, "gmailcleaner")
        console = []
        ui.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        ui.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
        ui.get_by_role("button", name="Đăng nhập Gmail").wait_for()
        assert ui.evaluate("typeof window.gcCall") == "function"

        # Kiem tra cap nhat luc mo app: phai noi chuyen duoc voi GitHub qua HTTPS.
        # Loi "HTTP 4xx" (vd bi gioi han luot goi) van chung to HTTPS chay tot.
        for _ in range(120):
            st = ui.evaluate("window.gcCall('hello')")
            if st["update"]["status"] not in ("idle", "checking"):
                break
            ui.wait_for_timeout(500)
        up = st["update"]
        print("PHIEN BAN", st["version"], "| CAP NHAT:", up["status"], up["error"])
        assert up["status"] in ("none", "available") or up["error"].startswith("HTTP "), up

        try:
            # Buoc 1: bam dang nhap -> cua so Gmail mo ra, tool cho nguoi dung dang nhap
            ui.get_by_role("button", name="Đăng nhập Gmail").click()
            ui.get_by_text("Đang chờ đăng nhập").wait_for()
            gmail = find(ctx, "mock_gmail")
            # "nguoi dung dang nhap xong": Gmail gia lap co du lieu
            gmail.evaluate("seed({inbox: 350, 'category/social': 130, 'category/promotions': 90}, 50)")
            gmail.reload()
            ui.get_by_text("Đã đăng nhập: test@gmail.com").wait_for(timeout=15000)

            # Buoc 2-3: chon Hop thu den + Mang xa hoi (bo Quang cao), xoa tu trang 2
            ui.get_by_role("button", name="Hộp thư đến").click()
            ui.get_by_role("button", name="Quảng cáo").click()
            ui.get_by_role("spinbutton").fill("2")
            ui.get_by_role("button", name="Bắt đầu xóa").click()
            ui.get_by_role("dialog").get_by_role("button", name="Xóa").click()
            ui.get_by_role("button", name="Dừng").wait_for()
            ui.screenshot(path=OUT / "e2e-dang-chay.png")
            ui.get_by_text("Hoàn tất. Tổng cộng đã xóa 560").wait_for(timeout=90000)
            ui.get_by_role("button", name="Bắt đầu xóa").wait_for()
            d = gmail.evaluate("dump()")
            n = {k: len(v) for k, v in d["labels"].items()}
            assert d["size"] == 100 and n == {"inbox": 100, "category/social": 100,
                                              "category/promotions": 90, "trash": 0}, (d["size"], n)
            ui.screenshot(path=OUT / "e2e-xong.png")
            print("E2E OK", n)

        except Exception:
            st = ui.evaluate("window.gcCall('hello')")
            print("---- TRANG THAI APP LUC LOI:", st["status"], st["account"], st["update"])
            for entry in st["logs"]:
                print("   ", entry["t"], entry["level"], entry["msg"])
            print("---- CAC CUA SO:", [pg.url for pg in ctx.pages])
            print("---- CONSOLE:", console[-15:])
            print("---- GIAO DIEN:", ui.evaluate("""() => new Promise(done => {
                const info = {visibility: document.visibilityState, focus: document.hasFocus(),
                              size: [innerWidth, innerHeight], raf: false,
                              html: document.documentElement.outerHTML.slice(0, 1200),
                              text: document.body.innerText.slice(0, 600)};
                requestAnimationFrame(() => { info.raf = true; });
                setTimeout(() => done(info), 1500);
            })"""))
            raise

        # Dong cua so giao dien -> chuong trinh tu thoat
        ui.close()
    proc.wait(timeout=20)
    print("THOAT SACH, ma thoat", proc.returncode)
finally:
    if proc.poll() is None:
        proc.kill()
    err = Path(env["GC_DATA_DIR"]) / "error.log"
    if err.exists():
        print("---- error.log cua app\n" + err.read_text(encoding="utf-8", errors="replace"))
