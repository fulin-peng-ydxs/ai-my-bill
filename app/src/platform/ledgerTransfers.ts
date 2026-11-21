import { registerPlugin } from '@capacitor/core'

export interface BackupManifest {
  backupFormatVersion: 1
  schemaVersion: number
  datasetId: string
  initialized: 1
  seedVersion: number
  historyStart: string
  createdAt: string
  tables: Record<string, number>
}

/** 原生文件只交换受管能力标识；页面、备份和测试均不能指定任意沙盒路径。 */
export interface LedgerTransfers {
  createTransfer(options: { kind: 'csv' | 'backup' }): Promise<{ id: string }>
  appendTransfer(options: { id: string; text: string }): Promise<void>
  exportBackup(options: { id: string; name: string; password: string; manifest: BackupManifest }): Promise<{ id: string }>
  saveTransfer(options: { id: string; filename: string }): Promise<{ saved: boolean }>
  pickBackup(): Promise<{ id?: string; cancelled: boolean }>
  prepareRestore(options: { id: string; password: string }): Promise<{ name: string; manifest: BackupManifest }>
  discardTransfer(options: { id: string }): Promise<void>
  cancelTransfer(options: { id: string }): Promise<void>
  hashDatabase(options: { name: string }): Promise<{ sha256: string }>
  replaceLedger(options: { name: string; prepared: string; operationId: string; clear: boolean; sha256: string }): Promise<void>
  discardDatabase(options: { name: string }): Promise<void>
  dataStatus(): Promise<{ snapshots: number; lastResult: string }>
  recordDataResult(options: { result: 'restore-ready' | 'data-running' | 'data-failed' | 'data-cancelled' }): Promise<void>
}

export const ledgerTransfers = registerPlugin<LedgerTransfers>('LedgerFiles')
