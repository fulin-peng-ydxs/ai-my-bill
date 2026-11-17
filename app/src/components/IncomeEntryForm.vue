<script setup lang="ts">
import { Clock3, NotebookPen, UserRound } from 'lucide-vue-next'
import { formatDecimalDisplay } from '../domain/money'
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { useLatestRequest } from '../composables/useLatestRequest'
import { computed, inject, onScopeDispose, reactive, ref, useId, watch } from 'vue'

import type { DailyTemplateSelection } from '../api/dailyTemplates'
import { listDictionaryCandidates, type DictionaryItem } from '../api/dictionaries'
import { LocalError } from '../domain/localError'
import {
  createIncome, getIncome, listRecentIncomeNames, undoCreatedIncome, updateIncome, type IncomeResponse,
} from '../api/incomes'
import { useLedgerDraft } from '../composables/useLedgerDraft'
import DraftBackupNotice from './DraftBackupNotice.vue'
import { registerUnsavedChanges, unsavedChangeScope } from '../composables/unsavedChanges'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import { toShanghaiLocalDateTime } from '../domain/businessTime'
import {
  emptyIncomeForm, incomeFormFromResponse, incomeRequestFromForm, validateIncomeForm,
  type IncomeField, type IncomeFormState,
} from '../domain/ledgerEntryForm'
import AppStatusNotice from './AppStatusNotice.vue'
import AppLoadingHint from './AppLoadingHint.vue'
import { canRetryRequest, isAccessDenied, normalizeRequestError, type RequestError } from '../api/errors'
import AppToast from './AppToast.vue'
import SavedEntrySummary from './SavedEntrySummary.vue'
import DailyTemplateFallbackNotice from './DailyTemplateFallbackNotice.vue'
import DateTimeControl from './DateTimeControl.vue'
import DictionaryPicker from './DictionaryPicker.vue'
import DictionaryCombobox, { type DictionaryChoice } from './DictionaryCombobox.vue'
import EntrySaveBar from './EntrySaveBar.vue'
import FormField from './FormField.vue'
import EntryReceipt from './EntryReceipt.vue'
import AmountField from './AmountField.vue'
import NameSuggestionCombobox from './NameSuggestionCombobox.vue'
import FundingChannelPicker from './FundingChannelPicker.vue'
import FormDisclosure from './FormDisclosure.vue'

const formId = useId()

const props = defineProps<{ defaultFundingChannelId?: string | null,
  templateSelection?: DailyTemplateSelection, templateRevision?: number, editEntry?: IncomeResponse }>()
const emit = defineEmits<{ 'templateConsumed': [], saved: [value: IncomeResponse], busyChange: [value: boolean] }>()
const empty = () => emptyIncomeForm(props.defaultFundingChannelId)

const form = reactive<IncomeFormState>(empty())
const editMode = computed(() => Boolean(props.editEntry))
const type = ref<'INCOME'>('INCOME')
const draft = useLedgerDraft(type, computed(() => !editMode.value))
const payers = ref<DictionaryItem[]>([])
const categories = ref<DictionaryItem[]>([])
const funding = ref<DictionaryItem[]>([])
const recentNames = ref<string[]>([])
const optionsRequest = useLatestRequest<Awaited<ReturnType<typeof readOptions>>>()
const loading = computed(() => optionsRequest.status.value === 'loading' || optionsRequest.refreshing.value)
const initialLoading = computed(() => optionsRequest.status.value === 'loading')
const optionFailures = ref<{ label: string, error: RequestError }[]>([])
const errors = reactive<Partial<Record<IncomeField, string>>>({})
const submitting = ref(false)
watch(submitting, value => emit('busyChange', value), { flush: 'sync' })
onScopeDispose(() => emit('busyChange', false))
const undoing = ref(false)
const saved = ref<IncomeResponse>()
const savedKey = ref('')
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const attempt = createIdempotencyAttemptTracker()
const editVersion = ref(0)
const editBaseline = ref('')
const versionConflict = ref(false)
const appliedTemplateRevision = ref(props.templateRevision ?? 0)
const templateUnavailableFields = ref<DailyTemplateSelection['unavailableFields']>(
  props.templateSelection?.entryType === 'INCOME' ? props.templateSelection.unavailableFields : [],
)
const categorySummary = computed(() => categories.value.find((item) => item.id === form.incomeCategoryId)?.name
  || (form.incomeCategoryId ? '已选分类' : '请选择分类'))
const editDirty = computed(() => editMode.value && editBaseline.value !== JSON.stringify(form))

function applyEditEntry(value: IncomeResponse): void {
  Object.assign(form, incomeFormFromResponse(value))
  editVersion.value = value.version
  editBaseline.value = JSON.stringify(form)
  versionConflict.value = false
  ensureEditOptions(value)
  Object.keys(errors).forEach((key) => delete errors[key as IncomeField])
  attempt.reset()
}

function ensureEditOptions(value: IncomeResponse): void {
  ensureItem(payers, 'payer', value.payerId, value.payerName)
  ensureItem(categories, 'income-category', value.incomeCategoryId, value.incomeCategoryName)
  ensureItem(funding, 'funding-channel', value.fundingChannelId, value.fundingChannelName)
}

watch(() => props.editEntry, (value) => { if (value) applyEditEntry(value) }, { immediate: true })

watch(() => draft.restored.value, (ready) => {
  if (!ready || editMode.value) return
  Object.assign(form, empty(), draft.data.value, { amount: formatDecimalDisplay(draft.data.value.amount ?? '') })
})
watch([() => draft.restored.value, () => props.templateRevision], ([ready, revision]) => {
  const selection = props.templateSelection
  if (editMode.value || !ready || !revision || revision === appliedTemplateRevision.value || selection?.entryType !== 'INCOME') return
  ensureItem(payers, 'payer', selection.payerId, selection.payerName)
  ensureItem(categories, 'income-category', selection.incomeCategoryId, selection.incomeCategoryName)
  ensureItem(funding, 'funding-channel', selection.fundingChannelId, selection.fundingChannelName)
  Object.assign(form, empty(), {
    incomeName: selection.incomeName ?? selection.displayName,
    payerId: selection.payerId ?? '', payerName: selection.payerName ?? '',
    incomeCategoryId: selection.incomeCategoryId ?? '', amount: formatDecimalDisplay(selection.incomeAmount ?? ''),
    fundingChannelId: selection.fundingChannelId ?? '', occurredAt: toShanghaiLocalDateTime(), note: '',
  })
  Object.keys(errors).forEach((key) => delete errors[key as IncomeField])
  saved.value = undefined
  templateUnavailableFields.value = selection.unavailableFields
  appliedTemplateRevision.value = revision
  attempt.reset()
  persist()
})
watch(() => props.defaultFundingChannelId, (value) => { if (!editMode.value && !form.fundingChannelId && value) form.fundingChannelId = value })

const unregisterEditGuard = registerUnsavedChanges(editDirty, () => {
  if (props.editEntry) applyEditEntry(props.editEntry)
}, inject(unsavedChangeScope, undefined))
onScopeDispose(unregisterEditGuard)

function persist(): void { void draft.replace(Object.fromEntries(Object.entries(form).filter(([, value]) => value))) }
function clear(field: IncomeField): void { delete errors[field]; persist() }
function ensureItem(target: typeof payers, itemType: DictionaryItem['type'], id?: string | null, name?: string | null): void {
  if (!id || !name || target.value.some((item) => item.id === id)) return
  target.value = [...target.value, { id, type: itemType, name, status: 'ACTIVE', sortOrder: 0, referenced: true }]
}

async function readOptions(signal: globalThis.AbortSignal) {
  const [payerResult, categoryResult, fundingResult, namesResult] = await Promise.allSettled([
    listDictionaryCandidates('payer', '', signal),
    listDictionaryCandidates('income-category', '', signal),
    listDictionaryCandidates('funding-channel', '', signal),
    listRecentIncomeNames('', signal),
  ])
  return { payerResult, categoryResult, fundingResult, namesResult }
}

async function loadOptions(): Promise<void> {
  optionFailures.value = []
  const results = await optionsRequest.execute(readOptions, { intent: 'silent' })
  if (!results) return
  // 批次通过请求代次检查后再更新字段，旧批次不能覆盖切回页面后的新结果。
  function apply<T>(label: string, result: PromiseSettledResult<{ items: T[] }>, target: { value: T[] }): void {
    if (result.status === 'fulfilled') target.value = result.value.items
    else {
      const error = normalizeRequestError(result.reason)
      if (isAccessDenied(error)) target.value = []
      optionFailures.value.push({ label, error })
    }
  }
  apply('付款方', results.payerResult, payers)
  apply('收入分类', results.categoryResult, categories)
  apply('收款方式', results.fundingResult, funding)
  apply('最近名称', results.namesResult, recentNames)
  if (props.editEntry) ensureEditOptions(props.editEntry)
}

function selectPayer(item: DictionaryChoice): void {
  ensureItem(payers, 'payer', item.id, item.name)
  form.payerId = item.id
  form.payerName = item.name
  clear('payerId')
}

function selectIncomeCategory(item: DictionaryChoice): void {
  ensureItem(categories, 'income-category', item.id, item.name)
}

function selectFundingItem(item: DictionaryChoice): void {
  ensureItem(funding, 'funding-channel', item.id, item.name)
}

function validate(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key as IncomeField])
  Object.assign(errors, validateIncomeForm(form))
  return Object.keys(errors).length === 0
}

async function submit(continueEntry: boolean): Promise<void> {
  if (submitting.value || !validate()) {
    return
  }
  submitting.value = true
  try {
    const body = incomeRequestFromForm(form)
    const key = attempt.keyFor(props.editEntry ? { id: props.editEntry.id, version: editVersion.value, entry: body } : body)
    if (props.editEntry) {
      saved.value = await updateIncome(props.editEntry.id, { version: editVersion.value, entry: body }, key)
      applyEditEntry(saved.value)
      emit('saved', saved.value)
      return
    }
    saved.value = await createIncome(body, key)
    savedKey.value = key
    toastKind.value = 'success'
    toastMessage.value = '收入已保存，可撤销本次保存。'
    toastOpen.value = true
    const retained = continueEntry ? { occurredAt: form.occurredAt, incomeCategoryId: form.incomeCategoryId,
      fundingChannelId: form.fundingChannelId } : {}
    await draft.clear()
    Object.assign(form, empty(), retained)
    attempt.reset()
    templateUnavailableFields.value = []
    emit('templateConsumed')
    if (!recentNames.value.includes(saved.value.incomeName)) {
      recentNames.value.unshift(saved.value.incomeName)
    }
  } catch (error) {
    const failure = normalizeRequestError(error)
    Object.entries(failure.fieldErrors).forEach(([field, messages]) => {
      errors[field as IncomeField] = messages[0]
    })
    versionConflict.value = error instanceof LocalError && error.code === 'LEDGER_VERSION_CONFLICT'
    toastKind.value = 'error'
    toastMessage.value = failure.message
    toastOpen.value = true
  } finally {
    submitting.value = false
  }
}

async function resolveConflict(overwrite: boolean): Promise<void> {
  if (!props.editEntry || submitting.value) {
    return
  }
  submitting.value = true
  try {
    const latest = await getIncome(props.editEntry.id)
    if (overwrite) {
      applyEditEntry(latest)
    } else {
      editVersion.value = latest.version
      versionConflict.value = false
      attempt.reset()
      toastKind.value = 'success'
      toastMessage.value = '已同步最新版本；你的输入仍保留，请确认后再次保存。'
      toastOpen.value = true
    }
  } catch (error) {
    toastKind.value = 'error'
    toastMessage.value = error instanceof Error ? error.message : '加载最新收入失败。'
    toastOpen.value = true
  } finally {
    submitting.value = false
  }
}

async function undo(): Promise<void> {
  if (!saved.value || !savedKey.value || undoing.value) {
    return
  }
  undoing.value = true
  try {
    await undoCreatedIncome(saved.value.id, savedKey.value)
    saved.value = undefined
    savedKey.value = ''
    toastKind.value = 'success'
    toastMessage.value = '本次保存已撤销。'
    toastOpen.value = true
  } catch (error) {
    toastKind.value = 'error'
    toastMessage.value = error instanceof Error ? error.message : '撤销失败。'
    toastOpen.value = true
  } finally {
    undoing.value = false
  }
}
void loadOptions()
useRefreshOnReturn(() => loadOptions())
</script>

<template>
  <section
    class="entry-form workspace-grow"
    :aria-busy="loading"
    :aria-label="editMode ? '编辑收入' : '收入填报'"
  >
    <AppLoadingHint
      :pending="loading"
      :page="!editMode"
      :reserve-space="!editMode"
      label="读取选项…"
    />
    <AppStatusNotice
      v-if="!loading && optionFailures.length"
      title="部分选项读取失败"
      :message="optionFailures.map(({ label, error }) => `${label}：${error.message}`).join('；')"
      :action-label="optionFailures.every(({ error }) => canRetryRequest(error)) ? '重试' : undefined"
      @action="loadOptions"
    />
    <DraftBackupNotice
      v-if="!editMode"
      :message="draft.storageError.value"
      :retry="draft.retryBackup"
    />
    <DailyTemplateFallbackNotice
      v-if="!editMode"
      :fields="templateUnavailableFields"
    />
    <section
      v-if="versionConflict"
      class="edit-conflict"
      role="alert"
    >
      <strong>这条收入已在其他窗口更新</strong>
      <p>你的输入仍然保留。可以加载最新内容，或保留当前输入并同步最新版本后再次确认保存。</p>
      <div>
        <button
          type="button"
          class="secondary-button"
          :disabled="submitting"
          @click="resolveConflict(true)"
        >
          加载最新内容
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="submitting"
          @click="resolveConflict(false)"
        >
          保留输入并重新确认
        </button>
      </div>
    </section>
    <form
      :id="formId"
      class="entry-form task-entry-form workspace-grow"
      @submit.prevent="submit(false)"
    >
      <EntryReceipt>
        <template #subject>
          <NameSuggestionCombobox
            v-model="form.incomeName"
            input-id="income-name"
            label="收入名称"
            :suggestions="recentNames"
            :load-suggestions="(query, signal) => listRecentIncomeNames(query, signal).then((response) => response.items)"
            :error="errors.incomeName"
            :disabled="submitting"
            @update:model-value="clear('incomeName')"
          />
          <FormDisclosure
            class="entry-category-picker"
            title="分类"
            :summary="categorySummary"
            :invalid="Boolean(errors.incomeCategoryId)"
            compact
          >
            <DictionaryPicker
              type="income-category"
              input-id="income-category"
              label="收入分类"
              :items="categories"
              :model-value="form.incomeCategoryId"
              :disabled="submitting"
              :error="errors.incomeCategoryId"
              @selected="selectIncomeCategory"
              @resolved="selectIncomeCategory"
              @update:model-value="form.incomeCategoryId = $event; clear('incomeCategoryId')"
            />
          </FormDisclosure>
        </template>
        <template #amount>
          <AmountField
            v-model="form.amount"
            field-id="income-amount"
            label="收入金额"
            tone="income"
            :disabled="submitting"
            :error="errors.amount"
            @update:model-value="clear('amount')"
          />
        </template>
        <template #context>
          <DictionaryCombobox
            class="entry-setting-field"
            input-id="income-payer-name"
            type="payer"
            label="付款方"
            :label-icon="UserRound"
            :items="payers"
            :model-value="form.payerId"
            :disabled="submitting"
            :error="errors.payerId"
            @select="selectPayer"
            @clear="form.payerId = ''; form.payerName = ''; clear('payerId')"
          />
          <FundingChannelPicker
            class="entry-setting-field"
            label="收款方式"
            :items="funding"
            :loading="initialLoading"
            :model-value="form.fundingChannelId"
            :disabled="submitting"
            :error="errors.fundingChannelId"
            @selected="selectFundingItem"
            @update:model-value="form.fundingChannelId = $event; clear('fundingChannelId')"
          />

          <FormField
            field-id="income-occurred-at"
            class="entry-setting-field"
            label="收入时间"
            :label-icon="Clock3"
            :error="errors.occurredAt"
          >
            <template #default="{ describedBy }">
              <DateTimeControl
                id="income-occurred-at"
                v-model="form.occurredAt"
                indicator
                :aria-describedby="describedBy"
                :disabled="submitting"
                @change="clear('occurredAt')"
              />
            </template>
          </FormField>
        </template>
        <FormDisclosure
          compact
          title="补充信息"
          :icon="NotebookPen"
          :summary="form.note.trim() || '备注（选填）'"
          :invalid="Boolean(errors.note)"
        >
          <FormField
            field-id="income-note"
            label="备注（选填）"
            help="最多 500 个字符。"
            :error="errors.note"
          >
            <template #default="{ describedBy }">
              <textarea
                id="income-note"
                v-model="form.note"
                :aria-describedby="describedBy"
                :disabled="submitting"
                @input="clear('note')"
              />
            </template>
          </FormField>
        </FormDisclosure>
      </EntryReceipt>

      <SavedEntrySummary
        v-if="saved && !editMode"
        :title="saved.incomeName"
        :amount="saved.amount"
        :description="`${saved.payerName} · ${saved.incomeCategoryName} · ${saved.fundingChannelName}`"
        tone="income"
        :undoing="undoing"
        @undo="undo"
      />

      <EntrySaveBar
        :form-id="formId"
        :submitting="submitting"
        viewport-pinned
        :continue-visible="!editMode"
        :primary-label="editMode ? '保存修改' : '保存收入'"
        @continue="submit(true)"
      >
        <template
          v-if="$slots.actions"
          #secondary
        >
          <slot
            name="actions"
            :submitting="submitting"
          />
        </template>
      </EntrySaveBar>
    </form>
    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
      :notification-key="saved?.id"
      :action-label="saved && !editMode && toastKind === 'success' ? '撤销' : undefined"
      :action-disabled="undoing"
      @action="undo"
    />
  </section>
</template>
