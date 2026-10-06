// Chay mot lenh tren CI; neu loi thi in phan cuoi ket qua thanh chu thich ::error::
// de hien ngay tren trang tong ket cua lan chay (khong can mo log).
//   node tests/ci-run.js node tests/e2e-app.js
const { spawn } = require('child_process')

const cmd = process.argv.slice(2)
const p = spawn(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' })
let text = ''
for (const s of [p.stdout, p.stderr]) {
  s.on('data', (d) => { process.stdout.write(d); text += d })
}
p.on('close', (rc) => {
  if (rc) {
    const esc = text.slice(-6000).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.log(`::error title=${cmd.join(' ').slice(-90)} (ma ${rc})::${esc}`)
  }
  process.exit(rc === null ? 1 : rc)
})
