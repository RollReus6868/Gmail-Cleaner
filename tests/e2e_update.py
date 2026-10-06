"""Kiem thu tu cap nhat TU DAU DEN CUOI voi app da dong goi va file phat hanh that.

Dung mot may chu gia thay GitHub: bao co ban 9.9.9, file tai ve chinh la bo cai/zip
vua build. App phai: thay ban moi -> tai -> kiem SHA-256 -> tu thoat -> cai de len.

    GC_APP=<exe da cai>  GC_UPDATE_FILE=<setup.exe hoac .zip>  python tests/e2e_update.py

Khong co GC_UPDATE_FILE (chay tu ma nguon): chi kiem buoc phat hien ban moi.
"""
import hashlib
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import updater  # noqa: E402

APP = str(Path(os.environ["GC_APP"]).resolve()) if os.environ.get("GC_APP") else None
FILE = Path(os.environ["GC_UPDATE_FILE"]) if os.environ.get("GC_UPDATE_FILE") else None
KIND = "win-setup" if os.name == "nt" else "mac-app"
NAME = updater.asset_name(KIND, "9.9.9")
PORT_CDP = 9334


class Fake(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/latest":
            assets = []
            if FILE:
                assets = [{"name": NAME, "browser_download_url": f"http://127.0.0.1:{self.server.server_port}/file",
                           "digest": "sha256:" + hashlib.sha256(FILE.read_bytes()).hexdigest()}]
            body = json.dumps({"tag_name": "v9.9.9", "body": "Ban thu nghiem", "html_url": "http://127.0.0.1/",
                               "assets": assets}).encode()
        elif self.path == "/file" and FILE:
            body = FILE.read_bytes()
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
data = Path(tempfile.mkdtemp())
env = dict(os.environ, GC_UPDATE_API=f"http://127.0.0.1:{srv.server_port}/latest",
           GC_ARGS=f"--remote-debugging-port={PORT_CDP}", GC_DATA_DIR=str(data),
           GC_UPDATE_NO_RELAUNCH="1")
mac_app = updater.mac_app_path(APP) if APP and sys.platform == "darwin" else None
inode_before = mac_app.stat().st_ino if mac_app else None
proc = subprocess.Popen([APP] if APP else [sys.executable, str(HERE.parent / "app.py")], env=env)
try:
    with sync_playwright() as p:
        for _ in range(60):
            try:
                browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT_CDP}")
                break
            except Exception:
                time.sleep(0.5)
        ctx = browser.contexts[0]
        ui = None
        for _ in range(80):
            ui = next((pg for pg in ctx.pages if "gmailcleaner" in pg.url), None)
            if ui:
                break
            ctx.pages[0].wait_for_timeout(250)
        ui.get_by_role("button", name="Có bản mới 9.9.9").click(timeout=30000)
        ui.get_by_role("heading", name="Có bản mới 9.9.9").wait_for()
        print("PHAT HIEN BAN MOI: OK")
        if not FILE:
            ui.get_by_role("button", name="Mở trang tải về").wait_for()
            print("BAN CHAY TU MA NGUON: hien nut mo trang tai ve - OK")
            ui.close()
        else:
            ui.get_by_role("button", name="Tải và cài bản 9.9.9").click()
    if FILE:
        proc.wait(timeout=180)
        print("APP DA TU THOAT, ma", proc.returncode)
        log = data / "update.log"
        done = "Log closed" if KIND == "win-setup" else "da thay ban moi"
        text = ""
        for _ in range(360):
            # log cua Inno Setup co the la UTF-16 hoac UTF-8 tuy phien ban
            raw = log.read_bytes() if log.exists() else b""
            text = raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8", "replace")
            if done in text or "tra lai ban cu" in text:
                break
            time.sleep(0.5)
        print("---- update.log (30 dong cuoi)\n" + "\n".join(text.splitlines()[-30:]))
        if KIND == "win-setup":
            assert "Installation process succeeded" in text, "bo cai khong bao thanh cong"
            assert Path(APP).exists()
        else:
            assert "da thay ban moi" in text, "khong thay duoc .app"
            assert mac_app.stat().st_ino != inode_before, ".app van la ban cu"
            subprocess.run(["codesign", "--verify", "--deep", "--strict", str(mac_app)], check=True)
        print("TU CAP NHAT: OK")
    else:
        proc.wait(timeout=30)
finally:
    if proc.poll() is None:
        proc.kill()
    err = Path(env["GC_DATA_DIR"]) / "error.log"
    if err.exists():
        print("---- error.log cua app\n" + err.read_text(encoding="utf-8", errors="replace"))
