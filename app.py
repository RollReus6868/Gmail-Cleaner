"""Gmail Cleaner - cua so giao dien + cua so Gmail, deu chay tren Chrome/Edge
co san trong may thong qua Playwright."""
import os
import re
import subprocess
import sys
import time
import traceback
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Error as PWError
from playwright.sync_api import sync_playwright

import cleaner
import updater
from app_info import APP_NAME as APP
from app_info import APP_VERSION

UI_ORIGIN = "http://gmailcleaner.localhost"
MAX_LOGS = 300


def res_dir():
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def data_dir():
    if os.environ.get("GC_DATA_DIR"):  # dung khi kiem thu
        d = Path(os.environ["GC_DATA_DIR"])
    elif sys.platform == "darwin":
        d = Path.home() / "Library" / "Application Support" / APP
    else:
        d = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / APP
    d.mkdir(parents=True, exist_ok=True)
    return d


def launch(p):
    """Mo Chrome (hoac Edge) voi ho so rieng cua tool, de lan sau khoi dang nhap lai."""
    opts = dict(
        headless=False,
        no_viewport=True,
        chromium_sandbox=sys.platform != "linux",
        ignore_default_args=["--enable-automation"],
        args=["--app=data:text/html,<title>Gmail Cleaner</title>",
              "--window-size=1040,780",
              "--disable-blink-features=AutomationControlled",
              *os.environ.get("GC_ARGS", "").split()],
    )
    exe = os.environ.get("GC_BROWSER")
    if exe:
        return p.chromium.launch_persistent_context(
            str(data_dir() / "profile-custom"), executable_path=exe, **opts)
    last = None
    for channel in ("chrome", "msedge"):
        try:
            return p.chromium.launch_persistent_context(
                str(data_dir() / f"profile-{channel}"), channel=channel, **opts)
        except PWError as e:
            last = e
    raise RuntimeError(
        "Không mở được Google Chrome hoặc Microsoft Edge. Hãy cài Chrome, và đóng "
        f"Gmail Cleaner nếu đang mở sẵn.\n\n{last}")


def serve_ui(route):
    """Phuc vu giao dien da build (ui_dist) cho dia chi UI_ORIGIN."""
    root = (res_dir() / "ui_dist").resolve()
    rel = urlparse(route.request.url).path.lstrip("/") or "index.html"
    f = (root / rel).resolve()
    if f.is_file() and root in f.parents:
        route.fulfill(path=str(f))
    else:
        route.fulfill(status=404, body="not found")


class App:
    def __init__(self, ctx, ui):
        self.ctx, self.ui = ctx, ui
        self.gmail = None
        self.cmds = []
        self.stop = self.closed = False
        self.release = None  # ban moi tim thay tren GitHub
        self.pending_update = None  # (kieu cai dat, file da tai) -> cai khi app thoat
        self.state = {"status": "idle", "account": "", "deleted": 0, "section": "", "logs": [],
                      "version": APP_VERSION,
                      "update": {"status": "idle", "latest": "", "notes": "", "progress": 0,
                                 "error": "", "manual": updater.install_kind() == "manual"}}

    # ---- goi tu giao dien (JS) -----------------------------------------
    def call(self, cmd, payload=None):
        if cmd == "stop":
            self.stop = True
        elif cmd == "clear":
            self.state["logs"] = []
        elif cmd == "update_open":
            webbrowser.open(self.release["url"] if self.release else updater.RELEASES_PAGE)
        elif (cmd in ("login", "run", "update_check", "update_install")
              and self.state["status"] == "idle" and not self.cmds):
            self.cmds.append((cmd, payload or {}))
        return self.state

    # ---- day trang thai ra giao dien -----------------------------------
    def push(self):
        try:
            self.ui.evaluate("s => window.__gcPush && window.__gcPush(s)", self.state)
        except PWError:
            self.closed = self.stop = True

    def log(self, level, msg):
        logs = self.state["logs"]
        logs.append({"t": time.strftime("%H:%M:%S"), "level": level, "msg": msg})
        del logs[:-MAX_LOGS]
        self.push()

    def tick(self):
        if self.stop:
            raise cleaner.Stopped()

    def progress(self, section, deleted):
        self.state.update(section=section, deleted=deleted)
        self.push()

    # ---- cap nhat -------------------------------------------------------
    def set_update(self, **kw):
        self.state["update"].update(kw)
        self.push()

    def update_job(self, name):
        try:
            if name == "update_check":
                self.set_update(status="checking", error="")
                self.release = updater.check()
                if self.release:
                    self.set_update(status="available", latest=self.release["version"],
                                    notes=self.release["notes"])
                else:
                    self.set_update(status="none")
            elif self.release:
                kind = updater.install_kind()
                self.state["status"] = "update"
                self.set_update(status="downloading", progress=0, error="")
                file = updater.download(self.release, kind,
                                        lambda pct: self.set_update(progress=pct))
                self.pending_update = (kind, file)
                self.set_update(status="installing")
                self.closed = True  # thoat vong lap -> dong trinh duyet -> cai ban moi
        except updater.UpdateError as e:
            self.set_update(status="error", error=str(e))
        finally:
            self.state["status"] = "idle"
            self.push()

    # ---- cong viec ------------------------------------------------------
    def job(self, name, opts):
        if name.startswith("update"):
            return self.update_job(name)
        self.stop = False
        self.state.update(status=name, section="")
        if name == "run":
            self.state["deleted"] = 0
        self.push()
        try:
            if self.gmail is None or self.gmail.is_closed():
                self.gmail = self.ctx.new_page()
            self.gmail.bring_to_front()
            c = cleaner.Cleaner(self.gmail, self.log, self.tick, self.progress)
            self.state["account"] = c.login()
            if name == "login":
                self.log("ok", f"Đã đăng nhập: {self.state['account']}")
            else:
                sections = [s for s in opts.get("sections", []) if s in cleaner.SECTIONS]
                start_page = max(1, int(opts.get("startPage", 1)))
                c.run(sections, start_page, bool(opts.get("emptyTrash")))
                self.log("ok", f"Hoàn tất. Tổng cộng đã xóa {c.deleted} cuộc trò chuyện.")
        except cleaner.Stopped:
            self.log("warn", "Đã dừng theo yêu cầu.")
        except cleaner.CleanerError as e:
            self.log("error", str(e))
        except PWError as e:
            self.log("error", "Lỗi trình duyệt (có thể cửa sổ Gmail đã bị đóng): "
                     + str(e).splitlines()[0])
        finally:
            self.state.update(status="idle", section="")
            self.push()
            try:
                self.ui.bring_to_front()  # xong viec thi dua cua so tool len truoc
            except PWError:
                pass

    def loop(self):
        while not self.closed:
            if self.cmds:
                self.job(*self.cmds.pop(0))
                continue
            try:
                self.ui.wait_for_timeout(150)
            except PWError:
                break


def main():
    with sync_playwright() as p:
        ctx = launch(p)
        ui = ctx.pages[0] if ctx.pages else ctx.new_page()
        app = App(ctx, ui)
        ctx.route(re.compile(r"^https?://gmailcleaner\.localhost/"), serve_ui)
        ui.expose_function("gcCall", app.call)
        ui.on("close", lambda *_: setattr(app, "closed", True) or setattr(app, "stop", True))
        ui.goto(UI_ORIGIN + "/index.html")
        if not os.environ.get("GC_NO_UPDATE_CHECK"):
            app.cmds.append(("update_check", {}))
        app.loop()
        try:
            ctx.close()
        except PWError:
            pass
    # Trinh duyet va Playwright da dong han -> khong con file nao bi khoa
    if app.pending_update:
        updater.apply(*app.pending_update, data_dir() / "update.log")


if __name__ == "__main__":
    if os.name == "nt":
        import ctypes
        # Bo cai Windows nhin mutex nay de biet app con chay; giu den khi tien trinh thoat
        _mutex = ctypes.windll.kernel32.CreateMutexW(None, False, updater.MUTEX)
    try:
        main()
    except Exception:
        err = traceback.format_exc()
        log = data_dir() / "error.log"
        log.write_text(err, encoding="utf-8")
        if os.name == "nt":
            ctypes.windll.user32.MessageBoxW(
                0, f"{err[-900:]}\n\nChi tiết: {log}", "Gmail Cleaner - lỗi", 0x10)
        elif sys.platform == "darwin":
            last = err.strip().splitlines()[-1].replace('"', "'")
            subprocess.run(["osascript", "-e",
                            f'display alert "Gmail Cleaner - lỗi" message "{last}\n\n{log}"'])
        else:
            print(err, file=sys.stderr)
        sys.exit(1)
