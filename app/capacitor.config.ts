import type { CapacitorConfig } from '@capacitor/cli'

// 固定随包资源；开发与验收均不指向旧 Web 或任何远程热重载服务。
const config: CapacitorConfig = {
  appId: 'com.mybill.offline',
  appName: '我的账单',
  webDir: 'dist',
  loggingBehavior: 'debug',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    CapacitorSQLite: {
      // App 私有 Library 目录；插件为此目录设置系统备份排除标记。
      iosDatabaseLocation: 'Library/OfflineLedger',
    },
  },
}

export default config
