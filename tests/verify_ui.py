"""Kiem tra giao dien: chup anh sang/toi o 3 be rong, bat loi console, tran ngang.
Chay sau `npx vite preview --port 4173` trong thu muc ui/:
    GC_BROWSER=/duong/dan/chrome python tests/verify_ui.py
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
OUT = Path(__file__).resolve().parent / "screenshots"
OUT.mkdir(exist_ok=True)
problems = []

OVERFLOW_JS = """() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('trang tran ngang');
  for (const el of document.querySelectorAll('button, input, h1, h2, [role=switch]')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > innerWidth + 1 || r.left < -1))
      bad.push('bi cat: ' + (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30));
  }
  return bad;
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("GC_BROWSER"))
    for mode in ("light", "dark"):
        for width in (1280, 760, 400):
            ctx = browser.new_context(viewport={"width": width, "height": 780})
            ctx.add_init_script(f"localStorage.setItem('gmail-cleaner-mode', '{mode}')")
            page = ctx.new_page()
            page.on("console", lambda m: m.type == "error" and problems.append(f"console: {m.text}"))
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.on("requestfailed", lambda r: problems.append(f"request: {r.url}"))
            tag = f"{mode}-{width}"
            for name, query in (("trong", ""), ("demo", "?demo")):
                page.goto(URL + query)
                page.wait_for_timeout(400)
                assert ("dark" in page.evaluate("document.documentElement.className")) == (mode == "dark")
                problems += [f"{tag} {name}: {b}" for b in page.evaluate(OVERFLOW_JS)]
                page.screenshot(path=OUT / f"{name}-{tag}.png")
            # trang cap nhat (du lieu mau: co ban moi 1.1.0)
            page.get_by_role("button", name="Có bản mới 1.1.0").click()
            page.get_by_role("button", name="Tải và cài bản 1.1.0").wait_for()
            problems += [f"{tag} update: {b}" for b in page.evaluate(OVERFLOW_JS)]
            page.screenshot(path=OUT / f"update-{tag}.png")
            # hop thoai xac nhan
            page.goto(URL)
            page.get_by_role("button", name="Bắt đầu xóa").click()
            assert page.get_by_role("dialog").is_visible()
            problems += [f"{tag} dialog: {b}" for b in page.evaluate(OVERFLOW_JS)]
            page.screenshot(path=OUT / f"dialog-{tag}.png")
            page.keyboard.press("Escape")
            assert page.get_by_role("dialog").count() == 0
            # tuy chon duoc luu lai
            page.get_by_role("button", name="Diễn đàn").click()
            page.reload()
            assert page.get_by_role("button", name="Diễn đàn").get_attribute("aria-pressed") == "true"
            # trang cai dat + doi chu de + luu lai sau khi tai lai
            page.get_by_role("button", name="Cài đặt").click()
            page.locator('[data-theme="sunset"]').click()
            page.wait_for_timeout(200)
            problems += [f"{tag} settings: {b}" for b in page.evaluate(OVERFLOW_JS)]
            page.screenshot(path=OUT / f"settings-{tag}.png")
            page.reload()
            primary = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary')")
            assert primary.strip().startswith(("25 ", "30 ")), primary
            # thanh ben mo rong / thu gon
            aside = page.locator("aside")
            before = aside.bounding_box()["width"]
            page.get_by_role("button", name="Mở rộng" if before < 100 else "Thu gọn").click()
            page.wait_for_timeout(300)
            assert aside.bounding_box()["width"] != before
            ctx.close()
    browser.close()

if problems:
    print("\n".join(problems))
    sys.exit(1)
print("ALL CHECKS PASSED")
