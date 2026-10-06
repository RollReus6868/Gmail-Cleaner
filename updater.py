"""Tu cap nhat qua GitHub Releases. Khong import Playwright nen test rieng duoc.

Ten file trong Release la co dinh (workflow build.yml sinh dung cac ten nay):
    GmailCleaner-<ver>-windows-setup.exe   bo cai Inno Setup
    GmailCleaner-<ver>-mac-arm64.zip       .app nen bang ditto
    GmailCleaner-<ver>-mac-x64.zip
    SHA256SUMS.txt                         du phong khi asset khong co digest
"""
import hashlib
import json
import os
import platform
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import certifi

from app_info import APP_NAME, APP_VERSION, GITHUB_REPO

# GC_UPDATE_API: tro toi may chu gia khi kiem thu (tests/e2e_update.py)
API = os.environ.get("GC_UPDATE_API") or f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
RELEASES_PAGE = f"https://github.com/{GITHUB_REPO}/releases/latest"
MUTEX = "GmailCleanerRunning"  # bo cai Windows cho mutex nay bien mat roi moi ghi file
_HELPERS = []  # giu tham chieu tien trinh tro giup de khong bi canh bao khi thu gom


class UpdateError(Exception):
    pass


def parse_version(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3])


def mac_app_path(exe=None):
    """.../GmailCleaner.app/Contents/MacOS/GmailCleaner -> .../GmailCleaner.app"""
    exe = Path(exe or sys.executable)
    app = exe.parent.parent.parent
    return app if app.suffix == ".app" else None


def install_kind(exe=None, frozen=None, plat=None):
    """win-setup | mac-app | manual (manual = chi mo trang tai ve)."""
    exe = Path(exe or sys.executable)
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    plat = plat or sys.platform
    if not frozen:
        return "manual"
    if plat == "win32":
        return "win-setup" if (exe.parent / "unins000.exe").exists() else "manual"
    if plat == "darwin":
        app = mac_app_path(exe)
        # AppTranslocation: macOS chay app tu ban sao chi doc -> khong tu thay duoc
        if app and "AppTranslocation" not in app.parts and os.access(app.parent, os.W_OK):
            return "mac-app"
    return "manual"


def asset_name(kind, version, machine=None):
    if kind == "win-setup":
        return f"{APP_NAME}-{version}-windows-setup.exe"
    arch = "arm64" if (machine or platform.machine()) == "arm64" else "x64"
    return f"{APP_NAME}-{version}-mac-{arch}.zip"


def _open(url):
    # App dong goi tren macOS khong co san chung chi goc -> dung bo cua certifi.
    # SSL_CERT_FILE: mang cong ty co proxy tu ky chung chi.
    ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or certifi.where())
    req = urllib.request.Request(url, headers={"User-Agent": f"{APP_NAME}/{APP_VERSION}"})
    return urllib.request.urlopen(req, timeout=20, context=ctx)


def _net(fn):
    try:
        return fn()
    except urllib.error.HTTPError as e:
        raise UpdateError(f"HTTP {e.code}") from e
    except (OSError, ValueError) as e:  # URLError, timeout, SSL, JSON
        raise UpdateError(str(e)) from e


def check(current=APP_VERSION):
    """Tra ve thong tin ban moi nhat neu moi hon ban dang chay, None neu khong."""
    def get():
        try:
            with _open(API) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:  # kho chua co ban phat hanh nao
                return None
            raise
    rel = _net(get)
    if not rel:
        return None
    latest = rel.get("tag_name", "").lstrip("v")
    if parse_version(latest) <= parse_version(current):
        return None
    return {"version": latest, "notes": rel.get("body") or "",
            "url": rel.get("html_url") or RELEASES_PAGE,
            "assets": {a["name"]: a for a in rel.get("assets", [])}}


def expected_sha256(release, name):
    asset = release["assets"][name]
    digest = asset.get("digest") or ""
    if digest.startswith("sha256:"):
        return digest[7:].lower()
    sums = release["assets"].get("SHA256SUMS.txt")
    if sums:
        with _open(sums["browser_download_url"]) as r:
            for line in r.read().decode().splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[1].lstrip("*") == name:
                    return parts[0].lower()
    raise UpdateError("Bản phát hành không có mã kiểm tra SHA-256, không cài để đảm bảo an toàn.")


def download(release, kind, progress=lambda pct: None, dest_dir=None):
    """Tai file cap nhat, kiem SHA-256. Tra ve duong dan file."""
    name = asset_name(kind, release["version"])
    if name not in release["assets"]:
        raise UpdateError(f"Bản {release['version']} chưa có file {name}.")

    def run():
        want = expected_sha256(release, name)
        dest = Path(dest_dir or tempfile.mkdtemp(prefix="gc-update-")) / name
        h = hashlib.sha256()
        with _open(release["assets"][name]["browser_download_url"]) as r, open(dest, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            done = last = 0
            while chunk := r.read(1 << 18):
                f.write(chunk)
                h.update(chunk)
                done += len(chunk)
                pct = done * 100 // total if total else 0
                if pct != last:
                    last = pct
                    progress(pct)
        if h.hexdigest() != want:
            dest.unlink(missing_ok=True)
            raise UpdateError("File tải về bị hỏng (sai mã SHA-256). Hãy thử lại.")
        return dest
    return _net(run)


# ---- cai dat: goi SAU KHI da dong trinh duyet, ngay truoc khi app thoat -------------

MAC_HELPER = r"""#!/bin/bash
# Thay GmailCleaner.app bang ban moi sau khi app cu thoat. Loi thi tra lai ban cu.
exec >>"$GC_LOG" 2>&1
echo "== $(date) pid=$GC_PID new=$GC_NEW target=$GC_TARGET"
for i in $(seq 1 120); do kill -0 "$GC_PID" 2>/dev/null || break; sleep 0.5; done
OLD="$GC_TARGET.old"
rm -rf "$OLD"
mv "$GC_TARGET" "$OLD" || { echo "khong doi ten duoc ban cu"; exit 1; }
if mv "$GC_NEW" "$GC_TARGET"; then
  rm -rf "$OLD"
  echo "da thay ban moi"
else
  echo "loi, tra lai ban cu"
  mv "$OLD" "$GC_TARGET"
  exit 1
fi
[ -n "$GC_UPDATE_NO_RELAUNCH" ] || open "$GC_TARGET"
"""


def launch_mac_helper(new_app, target_app, pid, log):
    """Chay script thay .app (tach khoi tien trinh hien tai). Tra ve Popen."""
    script = Path(tempfile.mkdtemp(prefix="gc-helper-")) / "update.sh"
    script.write_text(MAC_HELPER, encoding="utf-8", newline="\n")
    env = dict(os.environ, GC_PID=str(pid), GC_NEW=str(new_app), GC_TARGET=str(target_app),
               GC_LOG=str(log))
    p = subprocess.Popen(["/bin/bash", str(script)], env=env, start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    _HELPERS.append(p)
    return p


def apply(kind, file, log):
    """Bat dau cai ban moi. App phai thoat ngay sau khi goi ham nay."""
    file = Path(file)
    if kind == "win-setup":
        # Bo cai tu cho app cu thoat (mutex), cai de len thu muc cu, roi mo lai app.
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        p = subprocess.Popen([str(file), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
                              f"/LOG={log}"], creationflags=flags, close_fds=True)
        _HELPERS.append(p)
    elif kind == "mac-app":
        out = file.parent / "unzipped"
        # ditto giu symlink va chu ky cua .app (zipfile cua Python lam hong)
        subprocess.run(["ditto", "-x", "-k", str(file), str(out)], check=True)
        launch_mac_helper(out / f"{APP_NAME}.app", mac_app_path(), os.getpid(), log)
    else:
        raise UpdateError("Kiểu cài đặt này không tự cập nhật được.")
