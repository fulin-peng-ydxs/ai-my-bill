<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import AppDrawer from './AppDrawer.vue'
import AppDialog from './AppDialog.vue'
import FormField from './FormField.vue'
import AppRequestError from './AppRequestError.vue'
import AppStatusNotice from './AppStatusNotice.vue'
import { dataManagement, type PreparedRestore } from '../data/management/dataManagement'
import { ledgerTransfers } from '../platform/ledgerTransfers'
import { flushDrafts } from '../platform/draftLifecycle'
import { backupStatus } from '../platform/backupLifecycle'
import { dataManagementState } from '../platform/dataManagementState'
import { useBootstrapStore } from '../stores/bootstrap'
import { localOperation } from '../data/localOperation'
import { normalizeRequestError, type RequestError } from '../api/errors'
import { formatShanghaiBusinessDate, formatShanghaiDateTime } from '../domain/businessTime'

const bootstrap = useBootstrapStore()
const mode = ref<'backup' | 'restore' | 'status'>('backup')
const open = ref(false), confirmRestore = ref(false), confirmClear = ref(false), busy = ref(false)
const password = ref(''), error = ref<RequestError>(), notice = ref('')
const prepared = ref<PreparedRestore>(), incoming = ref<string>(), exported = ref<string>()
const snapshots = ref(0), lastResult = ref('暂无恢复或清空记录')
let controller: AbortController | undefined
let switching = false
let clearDataset = ''
const rows = computed(() => [
  { key: 'backup',label: '创建完整备份',value: '密码加密' },
  { key: 'restore',label: '从文件恢复',value: '整库替换' },
  { key: 'status',label: '最近数据管理结果',value: lastResult.value },
  { key: 'clear',label: '清空本机数据',value: '删除内部数据' },
] as const)
const title = computed(() => mode.value === 'backup' ? '创建完整备份' : mode.value === 'restore' ? '从文件恢复' : '最近数据管理结果')

async function refresh() {
  try {
    const status = await localOperation(() => ledgerTransfers.dataStatus())
    snapshots.value = status.snapshots
    lastResult.value = status.lastResult
  } catch (cause) { error.value = normalizeRequestError(cause) }
}
async function run(task: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = undefined
  dataManagementState.operationError = undefined
  controller = new AbortController()
  try {
    await localOperation(() => ledgerTransfers.recordDataResult({ result: 'data-running' }))
    await localOperation(() => task(controller!.signal))
  } catch (cause) {
    error.value = normalizeRequestError(cause)
    dataManagementState.operationError = error.value
    await ledgerTransfers.recordDataResult({ result: controller?.signal.aborted ? 'data-cancelled' : 'data-failed' }).catch(() => {})
  }
  finally { busy.value = false; password.value = ''; controller = undefined; void refresh() }
}
async function releasePrepared() {
  const candidate = prepared.value
  prepared.value = undefined
  if (candidate) await ledgerTransfers.discardDatabase({ name: candidate.name })
}
async function releaseFiles() {
  const ids = [incoming.value,exported.value].filter((id): id is string => Boolean(id))
  incoming.value = undefined
  exported.value = undefined
  await releasePrepared()
  for (const id of ids) await ledgerTransfers.discardTransfer({ id })
}
async function select(key: string) {
  error.value = undefined
  notice.value = ''
  if (key === 'clear') {
    clearDataset = bootstrap.datasetId
    confirmClear.value = true
    return
  }
  mode.value = key as typeof mode.value
  open.value = true
  if (key === 'status') await refresh()
}
function backup() {
  void run(async signal => {
    await flushDrafts(true)
    const result = await dataManagement.backup(password.value,signal)
    exported.value = result.id
    const { saved } = await ledgerTransfers.saveTransfer({ id: result.id,filename: `我的账单-${formatShanghaiBusinessDate()}.mybill` })
    notice.value = saved ? '完整备份已保存，请保管备份文件及密码。' : '已取消保存，可以重新保存；账本未改变。'
  })
}
function saveAgain() {
  void run(async () => {
    const result = await ledgerTransfers.saveTransfer({ id: exported.value!,filename: `我的账单-${formatShanghaiBusinessDate()}.mybill` })
    notice.value = result.saved ? '完整备份已保存。' : '已取消保存，账本未改变。'
  })
}
function choose() {
  void run(async () => {
    await releasePrepared()
    if (incoming.value) await ledgerTransfers.discardTransfer({ id: incoming.value })
    incoming.value = undefined
    const selection = await ledgerTransfers.pickBackup()
    if (!selection.cancelled) incoming.value = selection.id
  })
}
function verify() {
  void run(async signal => {
    await releasePrepared()
    prepared.value = await dataManagement.prepare(incoming.value!,password.value,signal)
    notice.value = '备份已校验。确认后将替换当前账本。'
  })
}
function restore() {
  void run(async signal => {
    await flushDrafts(true)
    const candidate = prepared.value!
    let failure: unknown
    switching = true
    try { await bootstrap.replaceDataset(() => dataManagement.restore(candidate,signal)) }
    catch (cause) { failure = cause; throw cause }
    finally {
      switching = false
      try { await releaseFiles() }
      catch (cleanup) {
        if (failure) throw new AggregateError([failure,cleanup],'恢复失败且临时文件清理未完成。')
        throw cleanup
      }
    }
  })
}
function clear() {
  void run(async signal => {
    switching = true
    try { await bootstrap.replaceDataset(() => dataManagement.clear(clearDataset,signal)) }
    finally { switching = false }
  })
}
async function drawerClosed() {
  if (open.value || switching || busy.value) return
  const cancelledRestore = Boolean(incoming.value)
  try {
    await releaseFiles()
    if (cancelledRestore) await ledgerTransfers.recordDataResult({ result: 'data-cancelled' })
    await refresh()
  } catch (cause) {
    error.value = normalizeRequestError(cause)
    dataManagementState.operationError = error.value
  }
}
// 密码立即清除；能力/预览等正文状态等原生 close 事件再释放，退场期间保持原内容。
watch(open, value => { if (!value && !switching) password.value = '' })
watch(() => dataManagementState.operationError, value => { if (value) error.value = value })
onMounted(refresh)
onBeforeUnmount(() => {
  if (!switching) {
    controller?.abort()
    void releaseFiles().catch(cause => { dataManagementState.operationError = normalizeRequestError(cause) })
  }
})
</script>

<template>
  <li v-for="row in rows" :key="row.key">
    <button type="button" :disabled="busy" :class="{ 'danger-text': row.key === 'clear' }" @click="select(row.key)">
      <span>{{ row.label }}</span><span class="disclosure-value">{{ row.value }}</span><ChevronRight :size="18" aria-hidden="true" />
    </button>
  </li>
  <li v-if="backupStatus.error">
    <AppStatusNotice title="内部快照尚未完成" :error="backupStatus.error" message="账本仍可使用，请重新打开 App 后查看或创建外部备份。" />
  </li>
  <li v-if="dataManagementState.operationError">
    <AppStatusNotice title="数据管理未完成" :error="dataManagementState.operationError" message="请先查看最近数据管理结果，再选择重试；不要卸载 App。" />
  </li>
  <Teleport to="body">
    <AppDrawer id="data-management" v-model:open="open" :title="title" :busy="busy" @close="drawerClosed">
      <div class="drawer-setting-content">
        <template v-if="mode === 'backup'">
          <p class="field-help">包含账目、字典、模板、偏好、草稿和回收站。请保管密码，忘记后无法恢复该文件。</p>
          <FormField v-if="!exported" field-id="backup-password" label="备份密码" help="至少 8 个字符；密码仅用于备份文件。">
            <input id="backup-password" v-model="password" type="password" autocomplete="new-password" :disabled="busy" maxlength="1024">
          </FormField>
          <button v-if="!exported" type="button" class="primary-button" :disabled="busy || !password" @click="backup">{{ busy ? '正在创建备份' : '创建并保存备份' }}</button>
          <button v-else type="button" class="primary-button" :disabled="busy" @click="saveAgain">重新保存备份</button>
        </template>
        <template v-else-if="mode === 'restore'">
          <p class="field-help">先选择备份并输入密码。校验成功后显示范围，由你确认整库替换；不合并数据。</p>
          <button type="button" class="secondary-button" :disabled="busy" @click="choose">{{ incoming ? '重新选择备份文件' : '选择备份文件' }}</button>
          <FormField v-if="incoming && !prepared" field-id="restore-password" label="备份密码">
            <input id="restore-password" v-model="password" type="password" autocomplete="current-password" :disabled="busy" maxlength="1024">
          </FormField>
          <button v-if="incoming && !prepared" type="button" class="primary-button" :disabled="busy || !password" @click="verify">{{ busy ? '正在校验备份' : '校验备份' }}</button>
          <template v-if="prepared">
            <p>备份时间：{{ formatShanghaiDateTime(prepared.manifest.createdAt) }}</p>
            <p>账目 {{ prepared.manifest.tables.ledger_entry ?? 0 }} 笔，调整 {{ prepared.manifest.tables.expense_adjustment ?? 0 }} 笔，草稿 {{ prepared.manifest.tables.ledger_draft ?? 0 }} 份。</p>
            <button type="button" class="primary-button" :disabled="busy" @click="confirmRestore = true">确认恢复范围</button>
          </template>
        </template>
        <template v-else>
          <p>{{ lastResult }}</p><p class="field-help">内部快照 {{ snapshots }} 份，合计保留最近 7 份。内部快照随 App 清空或卸载删除，请另存外部备份。</p>
          <button type="button" class="secondary-button" :disabled="busy" @click="refresh">刷新结果</button>
        </template>
        <p v-if="notice" role="status">{{ notice }}</p>
        <button v-if="busy && !switching" type="button" class="text-action" @click="controller?.abort()">取消当前操作</button>
        <AppRequestError v-if="error" title="数据操作未完成" :error="error" :show-retry="false" />
      </div>
    </AppDrawer>
    <AppDialog id="restore-ledger-confirm" v-model:open="confirmRestore" title="用备份替换当前账本？" description="当前数据会先生成本机保护快照，再整体替换为选定备份。备份后的新增或修改不会合并保留。" confirm-label="确认恢复" danger :busy="busy" @confirm="restore">
      <AppRequestError v-if="error" title="恢复未完成" :error="error" :show-retry="false" />
    </AppDialog>
    <AppDialog id="clear-ledger-confirm" v-model:open="confirmClear" title="清空本机全部数据？" description="删除本机账目、字典修改、模板、偏好、草稿、回收站及全部内部快照，重新开始空账本。已保存到“文件”的外部备份不会删除。" confirm-label="确认清空" danger :busy="busy" @confirm="clear">
      <AppRequestError v-if="error" title="清空未完成" :error="error" :show-retry="false" />
    </AppDialog>
  </Teleport>
</template>
