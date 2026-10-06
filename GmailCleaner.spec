# -*- mode: python ; coding: utf-8 -*-
# Build:  python -m PyInstaller --noconfirm --clean GmailCleaner.spec
#   Windows -> dist/GmailCleaner/GmailCleaner.exe (+ _internal), dung cho bo cai Inno Setup
#   macOS   -> dist/GmailCleaner.app
import sys

from PyInstaller.utils.hooks import collect_all

sys.path.insert(0, SPECPATH)
from app_info import APP_NAME, APP_VERSION

# Playwright mang theo "driver" (node + ma JS) duoi dang file du lieu, phai gom du.
pw_datas, pw_binaries, pw_hidden = collect_all("playwright")

a = Analysis(
    ["app.py"],
    datas=pw_datas + [("ui_dist", "ui_dist")],
    binaries=pw_binaries,
    hiddenimports=pw_hidden,
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "PyQt5", "PyQt6", "PySide6"],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name=APP_NAME, console=False)
coll = COLLECT(exe, a.binaries, a.datas, name=APP_NAME)
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        bundle_identifier="com.rollreus.gmailcleaner",
        version=APP_VERSION,
        info_plist={"NSHighResolutionCapable": True, "CFBundleDisplayName": "Gmail Cleaner"},
    )
