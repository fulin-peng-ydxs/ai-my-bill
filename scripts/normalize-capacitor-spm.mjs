import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Capacitor 8.6.2 将 iOS 27 写成 .v27，但生成清单的 tools 仍为 5.9；
// .v27 需要 PackageDescription 6.4。用等价字符串版本兼容生成器，保持最低 27.0。
// 只转换这一已核实形态，不维护生成清单副本；CLI 修复后重新评估此适配。
const path = fileURLToPath(new URL('../app/ios/App/CapApp-SPM/Package.swift', import.meta.url))
const manifest = await readFile(path, 'utf8')
if (!manifest.startsWith('// swift-tools-version: 5.9') || !manifest.includes('platforms: [.iOS(.v27)],')) {
  throw new Error('Capacitor 生成清单已变化，请重新核实 iOS 27 / SwiftPM 兼容适配。')
}
await writeFile(path, manifest.replace('platforms: [.iOS(.v27)],', 'platforms: [.iOS("27.0")],'))
