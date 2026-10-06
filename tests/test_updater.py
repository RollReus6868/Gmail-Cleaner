"""Kiem thu updater.py (khong can mang, khong can trinh duyet).
    python -m unittest discover -s tests -p "test_updater.py" -v
"""
import hashlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import updater  # noqa: E402

DATA = b"noi dung ban cai moi" * 1000
SHA = hashlib.sha256(DATA).hexdigest()


class FakeResp(io.BytesIO):
    def __init__(self, body):
        super().__init__(body)
        self.headers = {"Content-Length": str(len(body))}


def release(version="9.9.9", digest=f"sha256:{SHA}", sums=None, name=None):
    name = name or updater.asset_name("win-setup", version)
    assets = {name: {"name": name, "browser_download_url": "https://x/file", "digest": digest}}
    if sums is not None:
        assets["SHA256SUMS.txt"] = {"name": "SHA256SUMS.txt", "browser_download_url": "https://x/sums"}
    return {"version": version, "notes": "", "url": "https://x", "assets": assets}


def fake_open(sums=b""):
    return lambda url: FakeResp(sums if url.endswith("/sums") else DATA)


class VersionTests(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(updater.parse_version("v1.2.10"), (1, 2, 10))
        self.assertGreater(updater.parse_version("1.10.0"), updater.parse_version("1.9.9"))

    def test_asset_names(self):
        self.assertEqual(updater.asset_name("win-setup", "1.2.3"), "GmailCleaner-1.2.3-windows-setup.exe")
        self.assertEqual(updater.asset_name("mac-app", "1.2.3", "arm64"), "GmailCleaner-1.2.3-mac-arm64.zip")
        self.assertEqual(updater.asset_name("mac-app", "1.2.3", "x86_64"), "GmailCleaner-1.2.3-mac-x64.zip")


class InstallKindTests(unittest.TestCase):
    def test_source_is_manual(self):
        self.assertEqual(updater.install_kind(frozen=False), "manual")

    def test_windows(self):
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "GmailCleaner.exe"
            self.assertEqual(updater.install_kind(exe, True, "win32"), "manual")
            (Path(d) / "unins000.exe").touch()
            self.assertEqual(updater.install_kind(exe, True, "win32"), "win-setup")

    def test_mac(self):
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "GmailCleaner.app" / "Contents" / "MacOS" / "GmailCleaner"
            self.assertEqual(updater.install_kind(exe, True, "darwin"), "mac-app")
            moved = Path(d) / "AppTranslocation" / "X" / "GmailCleaner.app" / "Contents" / "MacOS" / "GmailCleaner"
            self.assertEqual(updater.install_kind(moved, True, "darwin"), "manual")


class CheckTests(unittest.TestCase):
    def _check(self, payload, current="1.0.0"):
        import json
        with mock.patch.object(updater, "_open", lambda url: FakeResp(json.dumps(payload).encode())):
            return updater.check(current)

    def test_newer(self):
        r = self._check({"tag_name": "v1.1.0", "body": "moi", "html_url": "u",
                         "assets": [{"name": "a", "browser_download_url": "b"}]})
        self.assertEqual((r["version"], r["notes"], list(r["assets"])), ("1.1.0", "moi", ["a"]))

    def test_same_or_older(self):
        self.assertIsNone(self._check({"tag_name": "v1.0.0"}))
        self.assertIsNone(self._check({"tag_name": "v0.9.0"}))

    def test_no_release_yet(self):
        def err(url):
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        with mock.patch.object(updater, "_open", err):
            self.assertIsNone(updater.check("1.0.0"))

    def test_errors_become_update_error(self):
        def http(url):
            raise urllib.error.HTTPError(url, 403, "rate limit", {}, None)

        def net(url):
            raise urllib.error.URLError("khong co mang")
        with mock.patch.object(updater, "_open", http):
            with self.assertRaisesRegex(updater.UpdateError, "HTTP 403"):
                updater.check("1.0.0")
        with mock.patch.object(updater, "_open", net):
            with self.assertRaises(updater.UpdateError):
                updater.check("1.0.0")


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def _download(self, rel, sums=b""):
        seen = []
        with mock.patch.object(updater, "_open", fake_open(sums)):
            f = updater.download(rel, "win-setup", seen.append, self.dir.name)
        return f, seen

    def test_ok_with_digest(self):
        f, seen = self._download(release())
        self.assertEqual(f.read_bytes(), DATA)
        self.assertEqual(seen[-1], 100)

    def test_ok_with_sha256sums(self):
        name = updater.asset_name("win-setup", "9.9.9")
        f, _ = self._download(release(digest=None, sums=True), f"{SHA}  {name}\n".encode())
        self.assertTrue(f.exists())

    def test_wrong_hash_is_rejected_and_deleted(self):
        with self.assertRaisesRegex(updater.UpdateError, "SHA-256"):
            self._download(release(digest="sha256:" + "0" * 64))
        self.assertEqual(os.listdir(self.dir.name), [])

    def test_no_hash_is_refused(self):
        with self.assertRaisesRegex(updater.UpdateError, "SHA-256"):
            self._download(release(digest=None))

    def test_missing_asset(self):
        with self.assertRaisesRegex(updater.UpdateError, "chưa có file"):
            self._download(release(name="khac.exe"))


# Script bash chi chay tren macOS/Linux. Tren Windows "bash" la trinh khoi dong WSL
# (khong co distro thi thoat ma 1) nen bo qua o do.
@unittest.skipIf(os.name == "nt", "script thay .app chi dung tren macOS")
class MacHelperTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        d = Path(self.dir.name)
        self.target, self.new, self.log = d / "Thu muc co dau cach" / "GmailCleaner.app", d / "new" / "GmailCleaner.app", d / "log.txt"
        for app, ver in ((self.target, "cu"), (self.new, "moi")):
            app.mkdir(parents=True)
            (app / "ver.txt").write_text(ver)
        done = subprocess.Popen([sys.executable, "-c", "pass"])
        done.wait()
        self.dead_pid = done.pid
        os.environ["GC_UPDATE_NO_RELAUNCH"] = "1"
        self.addCleanup(os.environ.pop, "GC_UPDATE_NO_RELAUNCH", None)

    def test_swap(self):
        p = updater.launch_mac_helper(self.new, self.target, self.dead_pid, self.log)
        self.assertEqual(p.wait(timeout=30), 0, self.log.read_text())
        self.assertEqual((self.target / "ver.txt").read_text(), "moi")
        self.assertFalse(Path(str(self.target) + ".old").exists())
        self.assertFalse(self.new.exists())

    def test_waits_for_app_to_exit(self):
        app = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3)"])
        p = updater.launch_mac_helper(self.new, self.target, app.pid, self.log)
        with self.assertRaises(subprocess.TimeoutExpired):
            p.wait(timeout=1.5)  # app con chay -> chua duoc thay
        self.assertEqual((self.target / "ver.txt").read_text(), "cu")
        app.wait()
        self.assertEqual(p.wait(timeout=30), 0)
        self.assertEqual((self.target / "ver.txt").read_text(), "moi")

    def test_rollback_when_new_missing(self):
        p = updater.launch_mac_helper(self.new.parent / "khong-co.app", self.target, self.dead_pid, self.log)
        self.assertEqual(p.wait(timeout=30), 1)
        self.assertEqual((self.target / "ver.txt").read_text(), "cu")


if __name__ == "__main__":
    unittest.main()
