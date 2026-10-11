// 开发模式（npm start）下运行的是 node_modules 里的 Electron.app，
// macOS 菜单栏名称、「关于」里的版本、Dock 图标都取自它的 Info.plist。
// 这里把它改成 iTypora，使开发时的外观与打包后一致。可重复执行。
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.platform !== 'darwin') process.exit(0)

const contents = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents')
const plist = path.join(contents, 'Info.plist')
if (!fs.existsSync(plist)) process.exit(0)

const version = require('../package.json').version
const set = (key, value) => execFileSync('plutil', ['-replace', key, '-string', value, plist])
try {
  set('CFBundleName', 'iTypora')
  set('CFBundleDisplayName', 'iTypora')
  set('CFBundleShortVersionString', version)
  set('CFBundleVersion', version)
  const icon = path.join(__dirname, '../build/icon.icns')
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(contents, 'Resources/electron.icns'))
} catch (err) {
  console.warn('dev-bundle: 修改开发用 Electron.app 失败（不影响运行）：', err.message)
}
