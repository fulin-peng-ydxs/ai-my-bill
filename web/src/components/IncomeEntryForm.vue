<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import type { DailyTemplateSelection } from '../api/dailyTemplates'
import { createDictionaryItem, listDictionaryCandidates, type DictionaryItem } from '../api/dictionaries'
import { ApiClientError } from '../api/http'
import {
  createIncome, getIncome, listRecentIncomeNames, undoCreatedIncome, updateIncome, type IncomeResponse,
} from '../api/incomes'
import { useLedgerDraft } from '../composables/useLedgerDraft'
import { registerUnsavedChanges } from '../composables/unsavedChanges'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import { toShanghaiLocalDateTime } from '../domain/businessTime'
import { isDecimalInRange, MONEY_MAX, scaledIntegerToDecimal, decimalToScaledInteger } from '../domain/money'
import { normalizeDictionaryName } from '../domain/dictionaries'
import {
  emptyIncomeForm, incomeFormFromResponse, incomeRequestFromForm, validateIncomeForm,
  type IncomeField, type IncomeFormState,
} from '../domain/ledgerEntryForm'
import AppStateBlock from './AppStateBlock.vue'
import AppToast from './AppToast.vue'
import DailyTemplateFallbackNotice from './DailyTemplateFallbackNotice.vue'
import DictionaryPicker from './DictionaryPicker.vue'
import EntrySaveBar from './EntrySaveBar.vue'
import FormField from './FormField.vue'
import FormSection from './FormSection.vue'
import FundingChannelPicker from './FundingChannelPicker.vue'
import MoneySummary from './MoneySummary.vue'

const props = defineProps<{ accountId?: string, defaultFundingChannelId?: string | null,
  templateSelection?: DailyTemplateSelection, templateRevision?: number, editEntry?: IncomeResponse }>()
const emit = defineEmits<{ 'templateConsumed': [], saved: [value: IncomeResponse] }>()
const empty = () => emptyIncomeForm(props.defaultFundingChannelId)

const form = reactive<IncomeFormState>(empty())
const editMode = computed(() => Boolean(props.editEntry))
const accountId = computed(() => props.accountId)
const type = ref<'INCOME'>('INCOME')
const draft = useLedgerDraft(accountId, type, computed(() => !editMode.value))
const payers = ref<DictionaryItem[]>([])
const categories = ref<DictionaryItem[]>([])
const funding = ref<DictionaryItem[]>([])
const recentNames = ref<string[]>([])
const loading = ref(true)
const loadError = ref('')
const errors = reactive<Partial<Record<IncomeField, string>>>({})
const submitting = ref(false)
const addingPayer = ref(false)
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
const summary = computed(() => [{ key: 'income', label: '本次收入',
  amount: isDecimalInRange(form.amount, 2, MONEY_MAX, true)
    ? scaledIntegerToDecimal(decimalToScaledInteger(form.amount, 2), 2) : '0.00',
  tone: 'income' as const, sign: '+' as const }])
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

watch(() => draft.restored.value, (ready) => { if (ready && !editMode.value) Object.assign(form, empty(), draft.data.value) })
watch([() => draft.restored.value, () => props.templateRevision], ([ready, revision]) => {
  const selection = props.templateSelection
  if (editMode.value || !ready || !revision || revision === appliedTemplateRevision.value || selection?.entryType !== 'INCOME') return
  ensureItem(payers, 'payer', selection.payerId, selection.payerName)
  ensureItem(categories, 'income-category', selection.incomeCategoryId, selection.incomeCategoryName)
  ensureItem(funding, 'funding-channel', selection.fundingChannelId, selection.fundingChannelName)
  Object.assign(form, empty(), {
    incomeName: selection.incomeName ?? selection.displayName,
    payerId: selection.payerId ?? '', payerName: selection.payerName ?? '',
    incomeCategoryId: selection.incomeCategoryId ?? '', amount: selection.incomeAmount ?? '',
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
})
onScopeDispose(unregisterEditGuard)

function persist(): void { void draft.replace(Object.fromEntries(Object.entries(form).filter(([, value]) => value))) }
function clear(field: IncomeField): void { delete errors[field]; persist() }
function ensureItem(target: typeof payers, itemType: DictionaryItem['type'], id?: string | null, name?: string | null): void {
  if (!id || !name || target.value.some((item) => item.id === id)) return
  target.value = [...target.value, { id, type: itemType, name, status: 'ACTIVE', sortOrder: 0, referenced: true }]
}

async function loadOptions(): Promise<void> {
  loading.value = true; loadError.value = ''
  try {
    const [payerPage, categoryPage, fundingPage, names] = await Promise.all([
      listDictionaryCandidates('payer'), listDictionaryCandidates('income-category'),
      listDictionaryCandidates('funding-channel'), listRecentIncomeNames(''),
    ])
    payers.value = payerPage.items; categories.value = categoryPage.items; funding.value = fundingPage.items
    recentNames.value = names.items
    if (props.editEntry) ensureEditOptions(props.editEntry)
  } catch { loadError.value = '收入填报选项暂未完整加载。' }
  finally { loading.value = false }
}

function selectPayer(id: string): void {
  form.payerId = id
  form.payerName = payers.value.find((item) => item.id === id)?.name ?? ''
  clear('payerId')
}

async function addPayer(): Promise<void> {
  const name = form.payerName.trim()
  if (!name) { errors.payerId = '请输入付款方名称后新增。'; return }
  const existing = payers.value.find((item) => normalizeDictionaryName(item.name) === normalizeDictionaryName(name))
  if (existing) { selectPayer(existing.id); return }
  addingPayer.value = true
  try {
    const created = await createDictionaryItem('payer', name)
    payers.value = [created, ...payers.value]
    selectPayer(created.id)
  } catch (error) { errors.payerId = error instanceof Error ? error.message : '新增付款方失败。' }
  finally { addingPayer.value = false }
}

function validate(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key as IncomeField])
  Object.assign(errors, validateIncomeForm(form))
  return Object.keys(errors).length === 0
}

async function submit(continueEntry: boolean): Promise<void> {
  if (submitting.value || !validate()) return
  const body = incomeRequestFromForm(form)
  const key = attempt.keyFor(body); submitting.value = true
  try {
    if (props.editEntry) {
      saved.value = await updateIncome(props.editEntry.id, { version: editVersion.value, entry: body }, key)
      applyEditEntry(saved.value)
      emit('saved', saved.value)
      return
    }
    saved.value = await createIncome(body, key); savedKey.value = key
    toastKind.value = 'success'; toastMessage.value = '收入已保存，可撤销本次保存。'; toastOpen.value = true
    const retained = continueEntry ? { occurredAt: form.occurredAt, incomeCategoryId: form.incomeCategoryId,
      fundingChannelId: form.fundingChannelId } : {}
    await draft.clear(); Object.assign(form, empty(), retained); attempt.reset()
    templateUnavailableFields.value = []; emit('templateConsumed')
    if (!recentNames.value.includes(saved.value.incomeName)) recentNames.value.unshift(saved.value.incomeName)
  } catch (error) {
    if (error instanceof ApiClientError && error.body?.fieldErrors) Object.entries(error.body.fieldErrors)
      .forEach(([field, messages]) => { errors[field as IncomeField] = messages?.[0] })
    versionConflict.value = error instanceof ApiClientError && error.body?.code === 'LEDGER_VERSION_CONFLICT'
    toastKind.value = 'error'; toastMessage.value = error instanceof Error ? error.message : '保存失败，请重试。'; toastOpen.value = true
  } finally { submitting.value = false }
}

async function resolveConflict(overwrite: boolean): Promise<void> {
  if (!props.editEntry || submitting.value) return
  submitting.value = true
  try {
    const latest = await getIncome(props.editEntry.id)
    if (overwrite) applyEditEntry(latest)
    else {
      editVersion.value = latest.version
      versionConflict.value = false
      attempt.reset()
      toastKind.value = 'success'; toastMessage.value = '已同步最新版本；你的输入仍保留，请确认后再次保存。'; toastOpen.value = true
    }
  } catch (error) {
    toastKind.value = 'error'; toastMessage.value = error instanceof Error ? error.message : '加载最新收入失败。'; toastOpen.value = true
  } finally { submitting.value = false }
}

async function undo(): Promise<void> {
  if (!saved.value || !savedKey.value || undoing.value) return
  undoing.value = true
  try { await undoCreatedIncome(saved.value.id, savedKey.value); saved.value = undefined; savedKey.value = ''
    toastKind.value = 'success'; toastMessage.value = '本次保存已撤销。'; toastOpen.value = true }
  catch (error) { toastKind.value = 'error'; toastMessage.value = error instanceof Error ? error.message : '撤销失败。'; toastOpen.value = true }
  finally { undoing.value = false }
}
void loadOptions()
</script>

<template>
  <section
    class="income-entry-form"
    :aria-label="editMode ? '编辑收入' : '收入填报'"
  >
    <AppStateBlock
      v-if="loading"
      kind="loading"
      title="正在加载收入选项"
      message="草稿仍会保存在当前设备。"
    />
    <AppStateBlock
      v-else-if="loadError"
      kind="error"
      title="部分选项暂未加载"
      :message="loadError"
      action-label="重试"
      @action="loadOptions"
    />
    <AppStateBlock
      v-if="!editMode && draft.storageError.value"
      kind="error"
      title="草稿未保存到此设备"
      :message="draft.storageError.value"
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
      class="income-form"
      @submit.prevent="submit(false)"
    >
      <FormSection
        title="收入信息"
        description="收入名称可以重复，最近使用名称会优先提示。"
      >
        <FormField
          field-id="income-name"
          label="收入名称"
          :error="errors.incomeName"
        >
          <template #default="{ describedBy }">
            <input
              id="income-name"
              v-model="form.incomeName"
              list="recent-income-names"
              :aria-describedby="describedBy"
              :disabled="submitting"
              @input="clear('incomeName')"
            ><datalist id="recent-income-names">
              <option
                v-for="name in recentNames"
                :key="name"
                :value="name"
              />
            </datalist>
          </template>
        </FormField>
        <FormField
          field-id="income-payer-name"
          label="付款方"
          help="可选择已有付款方，或输入名称后快速新增。"
          :error="errors.payerId"
        >
          <template #default="{ describedBy }">
            <div class="payer-row">
              <input
                id="income-payer-name"
                v-model="form.payerName"
                :aria-describedby="describedBy"
                :disabled="submitting || addingPayer"
                @input="form.payerId = ''; clear('payerId')"
              ><button
                type="button"
                class="secondary-button"
                :disabled="submitting || addingPayer"
                @click="addPayer"
              >
                {{ addingPayer ? '新增中…' : '新增' }}
              </button>
            </div>
            <select
              :value="form.payerId"
              aria-label="已有付款方"
              :disabled="submitting"
              @change="selectPayer(($event.target as HTMLSelectElement).value)"
            >
              <option value="">
                选择已有付款方
              </option><option
                v-for="item in payers"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </template>
        </FormField>
        <DictionaryPicker
          label="收入分类"
          :items="categories"
          :model-value="form.incomeCategoryId"
          :disabled="submitting"
          :error="errors.incomeCategoryId"
          @update:model-value="form.incomeCategoryId = $event; clear('incomeCategoryId')"
        />
      </FormSection>
      <FormSection
        title="金额与收款"
        description="金额使用十进制精确保存，收款方式来自个人字典。"
      >
        <FormField
          field-id="income-amount"
          label="收入金额"
          :error="errors.amount"
        >
          <template #default="{ describedBy }">
            <input
              id="income-amount"
              v-model="form.amount"
              inputmode="decimal"
              :aria-describedby="describedBy"
              :disabled="submitting"
              @input="clear('amount')"
            >
          </template>
        </FormField>
        <MoneySummary
          :items="summary"
          label="本次收入金额"
        />
        <FundingChannelPicker
          label="收款方式"
          :items="funding"
          :model-value="form.fundingChannelId"
          :disabled="submitting"
          :error="errors.fundingChannelId"
          @update:model-value="form.fundingChannelId = $event; clear('fundingChannelId')"
        />
      </FormSection>
      <FormSection
        title="时间与备注"
        description="服务端按上海时区确定业务日期。"
      >
        <FormField
          field-id="income-occurred-at"
          label="收入时间"
          help="服务端允许最多向未来偏移 5 分钟。"
          :error="errors.occurredAt"
        >
          <template #default="{ describedBy }">
            <input
              id="income-occurred-at"
              v-model="form.occurredAt"
              type="datetime-local"
              :aria-describedby="describedBy"
              :disabled="submitting"
              @change="clear('occurredAt')"
            >
          </template>
        </FormField>
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
      </FormSection>
      <EntrySaveBar
        :submitting="submitting"
        :continue-visible="!editMode"
        :primary-label="editMode ? '保存修改' : '保存收入'"
        @continue="submit(true)"
      />
    </form>
    <section
      v-if="saved && !editMode"
      class="saved-income"
    >
      <p class="eyebrow">
        刚刚保存
      </p><h2>{{ saved.incomeName }} · +¥{{ saved.amount }}</h2><p>{{ saved.payerName }} · {{ saved.incomeCategoryName }} · {{ saved.fundingChannelName }}</p>
    </section>
    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
      :action-label="saved && !editMode && toastKind === 'success' ? '撤销' : undefined"
      :action-disabled="undoing"
      @action="undo"
    />
  </section>
</template>

<style scoped>
.income-entry-form,.income-form{display:grid;gap:var(--space-5)}
.payer-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-2)}
.saved-income{padding:var(--space-5);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.saved-income h2{margin:var(--space-1) 0;color:var(--color-income-text)}
@media(max-width:640px){.payer-row{grid-template-columns:1fr}.payer-row button{width:100%}}
</style>
