import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const nativeDirectory = fileURLToPath(new URL('../app/ios/App', import.meta.url))
const packageDirectory = join(nativeDirectory, 'CapApp-SPM')

/** 干净检出没有生成目录；先补 CLI 自带骨架，使 sync 选择 SPM，并保留真实 Swift target 源。 */
async function prepare() {
  const require = createRequire(new URL('../app/package.json', import.meta.url))
  const cli = require.resolve('@capacitor/cli/package.json')
  const { extract } = createRequire(cli)('tar')
  const entries = ['Package.swift', 'README.md', '.gitignore', 'Sources/CapApp-SPM/CapApp-SPM.swift']
  if (await realpath(nativeDirectory) !== nativeDirectory) throw new Error('SPM 工程路径不能含符号链接。')
  // 仅恢复缺失的模板文件，不覆盖项目文件或已有生成物，也不写入链接指向的其他目录。
  for (const relative of ['', 'Sources', 'Sources/CapApp-SPM', ...entries]) {
    const file = join(packageDirectory, relative)
    const stat = await lstat(file).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    if (stat?.isSymbolicLink()) throw new Error('SPM 骨架路径不能含符号链接。')
  }
  await extract({ file: join(dirname(cli), 'assets/ios-spm-template.tar.gz'), cwd: nativeDirectory,
    strip: 1, keep: true, filter: entry => entries.some(p => entry === 'App/CapApp-SPM/' + p) })
  await readFile(join(packageDirectory, 'Sources/CapApp-SPM/CapApp-SPM.swift'))
}

if (process.argv.length === 3 && process.argv[2] === '--prepare') {
  await prepare()
} else if (process.argv.length !== 2) {
  throw new Error('用法：normalize-capacitor-spm.mjs [--prepare]')
} else {
  // Capacitor 8.6.2 将 iOS 27 写成 .v27，但生成清单的 tools 仍为 5.9；
  // .v27 需要 PackageDescription 6.4。用等价字符串版本兼容生成器，保持最低 27.0。
  // 只转换这一已核实形态，不维护生成清单副本；CLI 修复后重新评估此适配。
  const path = join(packageDirectory, 'Package.swift')
  const manifest = await readFile(path, 'utf8')
  if (!manifest.startsWith('// swift-tools-version: 5.9') || !manifest.includes('platforms: [.iOS(.v27)],')) {
    throw new Error('Capacitor 生成清单已变化，请重新核实 iOS 27 / SwiftPM 兼容适配。')
  }
  await writeFile(path, manifest.replace('platforms: [.iOS(.v27)],', 'platforms: [.iOS("27.0")],'))
}
