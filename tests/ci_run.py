"""Chay mot lenh tren CI; neu loi thi in phan cuoi ket qua thanh chu thich ::error::
de hien ngay tren trang tong ket cua lan chay (khong can mo log).
    python tests/ci_run.py python tests/e2e_app.py
"""
import subprocess
import sys

cmd = sys.argv[1:]
p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                     text=True, encoding="utf-8", errors="replace")
lines = []
for line in p.stdout:
    sys.stdout.write(line)
    sys.stdout.flush()
    lines.append(line.rstrip())
rc = p.wait()
if rc:
    # bo cac dong stack cua Node cho gon
    tail = "\n".join(ln for ln in lines if not ln.startswith("    at "))[-6000:]
    esc = tail.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title={' '.join(cmd)[-90:]} (ma {rc})::{esc}")
sys.exit(rc)
