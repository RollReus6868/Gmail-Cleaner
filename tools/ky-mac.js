// Ky "ad-hoc" cho ban macOS ngay sau khi dong goi .app.
// Mac chip Apple tu choi chay app khong co chu ky; electron-builder doi ten file
// chay nen chu ky goc cua Electron hong ("app bi hong"). Ky ad-hoc khong can
// chung chi Apple: lan mo dau van phai cho phep trong Privacy & Security.
const path = require('path')
const { execFileSync } = require('child_process')

exports.default = async function kyMac(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') throw new Error('Ban macOS phai dong goi tren may Mac (GitHub Actions).')
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ky ad-hoc  app=${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
