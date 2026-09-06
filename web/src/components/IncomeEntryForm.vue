<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { createDictionaryItem, listDictionaryCandidates, type DictionaryItem } from '../api/dictionaries'
import { ApiClientError } from '../api/http'
import { createIncome, listRecentIncomeNames, undoCreatedIncome, type IncomeResponse } from '../api/incomes'
import { useLedgerDraft } from '../composables/useLedgerDraft'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import { isShanghaiLocalDateTime, shanghaiLocalDateTimeToIso, toShanghaiLocalDateTime } from '../domain/businessTime'
import { isDecimalInRange, MONEY_MAX, scaledIntegerToDecimal, decimalToScaledInteger } from '../domain/money'
import { normalizeDictionaryName } from '../domain/dictionaries'
import { unicodeCodePointLength } from '../domain/text'
import AppStateBlock from './AppStateBlock.vue'
import AppToast from './AppToast.vue'
import DictionaryPicker from './DictionaryPicker.vue'
import EntrySaveBar from './EntrySaveBar.vue'
import FormField from './FormField.vue'
import FormSection from './FormSection.vue'
import FundingChannelPicker from './FundingChannelPicker.vue'
import MoneySummary from './MoneySummary.vue'

const props = defineProps<{ accountId?: string, defaultFundingChannelId?: string | null }>()
type Field = 'incomeName' | 'payerId' | 'incomeCategoryId' | 'amount' | 'fundingChannelId' | 'occurredAt' | 'note'
interface State { incomeName: string, payerId: string, payerName: string, incomeCategoryId: string,
  amount: string, fundingChannelId: string, occurredAt: string, note: string }
function empty(): State {
  return { incomeName: '', payerId: '', payerName: '', incomeCategoryId: '', amount: '',
    fundingChannelId: props.defaultFundingChannelId ?? '', occurredAt: toShanghaiLocalDateTime(), note: '' }
}

const form = reactive<State>(empty())
const accountId = computed(() => props.accountId)
const type = ref<'INCOME'>('INCOME')
const draft = useLedgerDraft(accountId, type)
const payers = ref<DictionaryItem[]>([])
const categories = ref<DictionaryItem[]>([])
const funding = ref<DictionaryItem[]>([])
const recentNames = ref<string[]>([])
const loading = ref(true)
const loadError = ref('')
const errors = reactive<Partial<Record<Field, string>>>({})
const submitting = ref(false)
const addingPayer = ref(false)
const undoing = ref(false)
const saved = ref<IncomeResponse>()
const savedKey = ref('')
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const attempt = createIdempotencyAttemptTracker()
const summary = computed(() => [{ key: 'income', label: '本次收入',
  amount: isDecimalInRange(form.amount, 2, MONEY_MAX, true)
    ? scaledIntegerToDecimal(decimalToScaledInteger(form.amount, 2), 2) : '0.00',
  tone: 'income' as const, sign: '+' as const }])

watch(() => draft.restored.value, (ready) => { if (ready) Object.assign(form, empty(), draft.data.value) })
watch(() => props.defaultFundingChannelId, (value) => { if (!form.fundingChannelId && value) form.fundingChannelId = value })

function persist(): void { void draft.replace(Object.fromEntries(Object.entries(form).filter(([, value]) => value))) }
function clear(field: Field): void { delete errors[field]; persist() }

async function loadOptions(): Promise<void> {
  loading.value = true; loadError.value = ''
  try {
    const [payerPage, categoryPage, fundingPage, names] = await Promise.all([
      listDictionaryCandidates('payer'), listDictionaryCandidates('income-category'),
      listDictionaryCandidates('funding-channel'), listRecentIncomeNames(''),
    ])
    payers.value = payerPage.items; categories.value = categoryPage.items; funding.value = fundingPage.items
    recentNames.value = names.items
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
  Object.keys(errors).forEach((key) => delete errors[key as Field])
  if (!form.incomeName.trim()) errors.incomeName = '请输入收入名称。'
  else if (unicodeCodePointLength(form.incomeName.trim()) > 200) errors.incomeName = '收入名称最多 200 个字符。'
  if (!form.payerId) errors.payerId = '请选择或新增付款方。'
  if (!form.incomeCategoryId) errors.incomeCategoryId = '请选择收入分类。'
  if (!isDecimalInRange(form.amount, 2, MONEY_MAX, true)) errors.amount = '收入金额须大于 0，最多 2 位小数。'
  if (!form.fundingChannelId) errors.fundingChannelId = '请选择收款方式。'
  if (!isShanghaiLocalDateTime(form.occurredAt)) errors.occurredAt = '请选择有效收入时间。'
  if (unicodeCodePointLength(form.note.trim()) > 500) errors.note = '备注最多 500 个字符。'
  return Object.keys(errors).length === 0
}

async function submit(continueEntry: boolean): Promise<void> {
  if (submitting.value || !validate()) return
  const body = { incomeName: form.incomeName.trim(), payerId: form.payerId,
    incomeCategoryId: form.incomeCategoryId, amount: form.amount, fundingChannelId: form.fundingChannelId,
    occurredAt: shanghaiLocalDateTimeToIso(form.occurredAt), ...(form.note.trim() ? { note: form.note.trim() } : {}) }
  const key = attempt.keyFor(body); submitting.value = true
  try {
    saved.value = await createIncome(body, key); savedKey.value = key
    toastKind.value = 'success'; toastMessage.value = '收入已保存，可撤销本次保存。'; toastOpen.value = true
    const retained = continueEntry ? { occurredAt: form.occurredAt, incomeCategoryId: form.incomeCategoryId,
      fundingChannelId: form.fundingChannelId } : {}
    await draft.clear(); Object.assign(form, empty(), retained); attempt.reset()
    if (!recentNames.value.includes(saved.value.incomeName)) recentNames.value.unshift(saved.value.incomeName)
  } catch (error) {
    if (error instanceof ApiClientError && error.body?.fieldErrors) Object.entries(error.body.fieldErrors)
      .forEach(([field, messages]) => { errors[field as Field] = messages?.[0] })
    toastKind.value = 'error'; toastMessage.value = error instanceof Error ? error.message : '保存失败，请重试。'; toastOpen.value = true
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
    aria-label="收入填报"
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
      v-if="draft.storageError.value"
      kind="error"
      title="草稿未保存到此设备"
      :message="draft.storageError.value"
    />
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
        primary-label="保存收入"
        @continue="submit(true)"
      />
    </form>
    <section
      v-if="saved"
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
      :action-label="saved && toastKind === 'success' ? '撤销' : undefined"
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
