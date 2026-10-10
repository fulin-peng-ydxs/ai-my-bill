<script setup lang="ts">
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { NotebookPen, ReceiptText, ShoppingBag, WalletCards } from 'lucide-vue-next'

import { ApiClientError } from '../api/http'
import type { DailyTemplateSelection } from '../api/dailyTemplates'
import {
  createExpense, getExpense, undoCreatedExpense, updateExpense, type ExpenseResponse, type ProductSuggestion,
} from '../api/expenses'
import { listDictionaryCandidates } from '../api/dictionaries'
import {
  calculateExpenseTotal, decimalToScaledInteger, formatCny, formatDecimalDisplay, scaledIntegerToDecimal, isDecimalInRange, MONEY_MAX,
} from '../domain/money'
import { expenseContinuationFields } from '../domain/expense'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import { formatShanghaiDateTime, toShanghaiLocalDateTime } from '../domain/businessTime'
import {
  emptyExpenseForm, expenseFormFromResponse, expenseRequestFromForm, validateExpenseForm,
  validateExpensePaidMinimum,
  type ExpenseField, type ExpenseFormState,
} from '../domain/ledgerEntryForm'
import { useLedgerDraft } from '../composables/useLedgerDraft'
import DraftBackupNotice from './DraftBackupNotice.vue'
import { registerUnsavedChanges } from '../composables/unsavedChanges'
import AppStateBlock from './AppStateBlock.vue'
import AppToast from './AppToast.vue'
import SavedEntrySummary from './SavedEntrySummary.vue'
import DailyTemplateFallbackNotice from './DailyTemplateFallbackNotice.vue'
import DateTimeControl from './DateTimeControl.vue'
import DictionaryPicker from './DictionaryPicker.vue'
import DictionaryCombobox, { type DictionaryChoice } from './DictionaryCombobox.vue'
import EntrySaveBar from './EntrySaveBar.vue'
import FormField from './FormField.vue'
import FormSection from './FormSection.vue'
import FundingChannelPicker from './FundingChannelPicker.vue'
import LocationLabelPicker from './LocationLabelPicker.vue'
import FormDisclosure from './FormDisclosure.vue'
import ProductCombobox from './ProductCombobox.vue'

const props = defineProps<{
  accountId?: string
  defaultFundingChannelId?: string | null
  templateSelection?: DailyTemplateSelection
  templateRevision?: number
  editEntry?: ExpenseResponse
}>()
const emit = defineEmits<{ 'templateConsumed': [], saved: [value: ExpenseResponse] }>()

type OptionGroup = 'categories' | 'units' | 'funding' | 'purchase' | 'locations'

interface ExpenseOption {
  id: string
  name: string
  parentId?: string
}

const emptyForm = () => emptyExpenseForm(props.defaultFundingChannelId)
const form = reactive<ExpenseFormState>(emptyForm())
const editMode = computed(() => Boolean(props.editEntry))
const expenseType = ref<'EXPENSE'>('EXPENSE')
const accountId = computed(() => props.accountId)
const draft = useLedgerDraft(accountId, expenseType, computed(() => !editMode.value))
const optionItems = reactive<Record<OptionGroup, ExpenseOption[]>>({
  categories: [], units: [], funding: [], purchase: [], locations: [],
})
const optionFailures = ref<string[]>([])
const optionsLoading = ref(false)
const errors = reactive<Partial<Record<ExpenseField, string>>>({})
const submitting = ref(false)
const undoing = ref(false)
const saved = ref<ExpenseResponse>()
const savedIdempotencyKey = ref('')
const detailOpen = ref(false)
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const paidOverridden = ref(false)
const productCombobox = ref<{ reset: () => void }>()
const idempotencyAttempt = createIdempotencyAttemptTracker()
const appliedTemplateRevision = ref(props.templateRevision ?? 0)
const editVersion = ref(0)
const editBaseline = ref('')
const versionConflict = ref(false)
const templateUnavailableFields = ref<DailyTemplateSelection['unavailableFields']>(
  props.templateSelection?.entryType === 'EXPENSE' ? props.templateSelection.unavailableFields : [],
)

const rootCategories = computed(() => optionItems.categories.filter((item) => !item.parentId))
const secondaryCategories = computed(() => optionItems.categories
  .filter((item) => item.parentId === form.primaryCategoryId))
const calculatedAmount = computed(() => {
  try {
    return calculateExpenseTotal(form.unitPrice, form.quantity)
  } catch {
    return '0.00'
  }
})
const effectiveAdjustmentMinimum = computed(() => props.editEntry?.effectiveAdjustmentAmount ?? '0.00')
const differenceText = computed(() => {
  if (editMode.value && decimalToScaledInteger(effectiveAdjustmentMinimum.value, 2) > 0n) {
    return `已生效退款/报销合计 ${formatCny(effectiveAdjustmentMinimum.value)}，实付金额不得低于此金额`
  }
  if (!isDecimalInRange(form.paidAmount, 2, MONEY_MAX)) return '填写后显示与计算金额的差额'
  const paidCents = decimalToScaledInteger(form.paidAmount, 2)
  const calculatedCents = decimalToScaledInteger(calculatedAmount.value, 2)
  const difference = paidCents - calculatedCents
  if (difference === 0n) return '与计算金额一致'
  const absolute = scaledIntegerToDecimal(difference < 0n ? -difference : difference, 2)
  return `${difference > 0n ? '高于' : '低于'}计算金额 ${formatCny(absolute)}`
})
const supplementSummary = computed(() => [
  optionItems.purchase.find((item) => item.id === form.purchaseChannelId)?.name,
  optionItems.locations.find((item) => item.id === form.locationLabelId)?.name,
  form.note.trim(),
].filter(Boolean).join(' · ') || '购买渠道、地点、备注（选填）')
const editDirty = computed(() => editMode.value && editBaseline.value !== JSON.stringify(form))

function applyEditEntry(value: ExpenseResponse): void {
  Object.assign(form, expenseFormFromResponse(value))
  editVersion.value = value.version
  editBaseline.value = JSON.stringify(form)
  versionConflict.value = false
  paidOverridden.value = true
  ensureEditOptions(value)
  Object.keys(errors).forEach((key) => delete errors[key as ExpenseField])
  idempotencyAttempt.reset()
}

function ensureEditOptions(value: ExpenseResponse): void {
  ensureOption('categories', value.primaryCategoryId, value.primaryCategoryName)
  ensureOption('categories', value.secondaryCategoryId, value.secondaryCategoryName, value.primaryCategoryId)
  ensureOption('units', value.unitId, value.unitName)
  ensureOption('funding', value.fundingChannelId, value.fundingChannelName)
  ensureOption('purchase', value.purchaseChannelId, value.purchaseChannelName)
  ensureOption('locations', value.locationLabelId, value.locationLabelName)
}

watch(() => props.editEntry, (value) => { if (value) applyEditEntry(value) }, { immediate: true })

watch(() => draft.restored.value, (restored) => {
  if (!restored || editMode.value) return
  const stored = draft.data.value
  Object.assign(form, emptyForm(), stored, {
    unitPrice: formatDecimalDisplay(stored.unitPrice ?? ''),
    quantity: formatDecimalDisplay(stored.quantity ?? '1'),
    paidAmount: formatDecimalDisplay(stored.paidAmount ?? ''),
  })
  paidOverridden.value = Boolean(stored.paidAmount)
})

watch([() => draft.restored.value, () => props.templateRevision], ([restored, revision]) => {
  const selection = props.templateSelection
  if (editMode.value || !restored || !revision || revision === appliedTemplateRevision.value || selection?.entryType !== 'EXPENSE') return
  ensureOption('categories', selection.primaryCategoryId, selection.primaryCategoryName)
  ensureOption('categories', selection.secondaryCategoryId, selection.secondaryCategoryName,
    selection.primaryCategoryId ?? undefined)
  ensureOption('units', selection.unitId, selection.unitName)
  ensureOption('funding', selection.fundingChannelId, selection.fundingChannelName)
  ensureOption('purchase', selection.purchaseChannelId, selection.purchaseChannelName)
  ensureOption('locations', selection.locationLabelId, selection.locationLabelName)
  Object.assign(form, emptyForm(), {
    productId: selection.productId ?? '', productName: selection.productName ?? '',
    primaryCategoryId: selection.primaryCategoryId ?? '', secondaryCategoryId: selection.secondaryCategoryId ?? '',
    unitId: selection.unitId ?? '', unitPrice: formatDecimalDisplay(selection.unitPrice ?? ''), quantity: formatDecimalDisplay(selection.quantity ?? ''),
    paidAmount: formatDecimalDisplay(selection.paidAmount ?? ''), fundingChannelId: selection.fundingChannelId ?? '',
    purchaseChannelId: selection.purchaseChannelId ?? '', locationLabelId: selection.locationLabelId ?? '',
    occurredAt: toShanghaiLocalDateTime(), note: '',
  })
  Object.keys(errors).forEach((key) => delete errors[key as ExpenseField])
  paidOverridden.value = true
  saved.value = undefined
  templateUnavailableFields.value = selection.unavailableFields
  appliedTemplateRevision.value = revision
  idempotencyAttempt.reset()
  persist()
})

watch(() => props.defaultFundingChannelId, (value) => {
  if (!editMode.value && !form.fundingChannelId && value) form.fundingChannelId = value
})

const unregisterEditGuard = registerUnsavedChanges(editDirty, () => {
  if (props.editEntry) applyEditEntry(props.editEntry)
})
onScopeDispose(unregisterEditGuard)

function persist(): void {
  void draft.replace(Object.fromEntries(Object.entries(form).filter(([, value]) => value)))
}

function clearError(field: ExpenseField): void {
  delete errors[field]
}

function amountChanged(): void {
  clearError('unitPrice')
  clearError('quantity')
  if (!paidOverridden.value) form.paidAmount = calculatedAmount.value === '0.00' ? '' : formatDecimalDisplay(calculatedAmount.value)
  persist()
}

function paidChanged(): void {
  paidOverridden.value = true
  clearError('paidAmount')
  persist()
}

function ensureOption(key: OptionGroup, id?: string | null, name?: string | null, parentId?: string): void {
  if (!id || !name || optionItems[key].some((item) => item.id === id)) return
  optionItems[key] = [...optionItems[key], { id, name, ...(parentId ? { parentId } : {}) }]
}

function selectProduct(product: ProductSuggestion): void {
  ensureOption('categories', product.primaryCategoryId, product.primaryCategoryName)
  ensureOption('categories', product.secondaryCategoryId, product.secondaryCategoryName,
    product.primaryCategoryId ?? undefined)
  ensureOption('units', product.unitId, product.unitName)
  ensureOption('funding', product.fundingChannelId, product.fundingChannelName)
  ensureOption('purchase', product.purchaseChannelId, product.purchaseChannelName)
  form.productId = product.id
  form.productName = product.name
  form.primaryCategoryId = product.primaryCategoryId ?? ''
  form.secondaryCategoryId = product.secondaryCategoryId ?? ''
  form.unitId = product.unitId ?? ''
  form.unitPrice = formatDecimalDisplay(product.lastUnitPrice ?? '')
  form.fundingChannelId = product.fundingChannelId ?? form.fundingChannelId
  form.purchaseChannelId = product.purchaseChannelId ?? ''
  clearError('productId')
  paidOverridden.value = false
  amountChanged()
}

function clearProduct(): void {
  form.productId = ''
  form.productName = ''
  clearError('productId')
  persist()
}

function updatePrimaryCategory(value: string): void {
  form.primaryCategoryId = value
  if (!secondaryCategories.value.some((item) => item.id === form.secondaryCategoryId)) {
    form.secondaryCategoryId = ''
  }
  clearError('primaryCategoryId')
  persist()
}

function selectCategory(item: DictionaryChoice, level: 'primary' | 'secondary'): void {
  ensureOption('categories', item.id, item.name, item.parentId)
  if (level === 'primary') updatePrimaryCategory(item.id)
  else {
    form.secondaryCategoryId = item.id
    clearError('secondaryCategoryId')
    persist()
  }
}

async function loadOptions(): Promise<void> {
  optionsLoading.value = true
  optionFailures.value = []
  const requests = [
    ['categories', '支出分类', 'expense-category'],
    ['units', '单位', 'unit'],
    ['funding', '支付方式', 'funding-channel'],
    ['purchase', '购买渠道', 'purchase-channel'],
    ['locations', '地点标签', 'location'],
  ] as const
  const results = await Promise.allSettled(requests.map(([, , type]) => listDictionaryCandidates(type)))
  results.forEach((result, index) => {
    const [key, label] = requests[index]
    if (result.status === 'fulfilled') optionItems[key] = result.value.items
    else optionFailures.value.push(label)
  })
  if (props.editEntry) ensureEditOptions(props.editEntry)
  optionsLoading.value = false
}

function validate(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key as ExpenseField])
  Object.assign(errors, validateExpenseForm(form))
  if (!errors.paidAmount && editMode.value) {
    errors.paidAmount = validateExpensePaidMinimum(form.paidAmount, effectiveAdjustmentMinimum.value)
    if (!errors.paidAmount) delete errors.paidAmount
  }
  return Object.keys(errors).length === 0
}

async function submit(continueEntry: boolean): Promise<void> {
  if (submitting.value || !validate()) return
  submitting.value = true
  try {
    const body = expenseRequestFromForm(form)
    const idempotencyKey = idempotencyAttempt.keyFor(body)
    if (props.editEntry) {
      saved.value = await updateExpense(props.editEntry.id, { version: editVersion.value, entry: body }, idempotencyKey)
      applyEditEntry(saved.value)
      emit('saved', saved.value)
      return
    }
    saved.value = await createExpense(body, idempotencyKey)
    savedIdempotencyKey.value = idempotencyKey
    detailOpen.value = false
    toastKind.value = 'success'
    toastMessage.value = '支出已保存，可撤销本次保存。'
    toastOpen.value = true
    await draft.clear()
    const retained = continueEntry ? expenseContinuationFields(form) : {}
    Object.assign(form, emptyForm(), retained)
    productCombobox.value?.reset()
    if (continueEntry) form.quantity = ''
    paidOverridden.value = false
    templateUnavailableFields.value = []
    emit('templateConsumed')
    idempotencyAttempt.reset()
  } catch (error) {
    if (error instanceof ApiClientError && error.body?.fieldErrors) {
      Object.entries(error.body.fieldErrors).forEach(([field, messages]) => {
        errors[field as ExpenseField] = messages?.[0]
      })
    }
    versionConflict.value = error instanceof ApiClientError && error.body?.code === 'LEDGER_VERSION_CONFLICT'
    toastKind.value = 'error'
    toastMessage.value = error instanceof Error ? error.message : '保存失败，请重试。'
    toastOpen.value = true
  } finally {
    submitting.value = false
  }
}

async function resolveConflict(overwrite: boolean): Promise<void> {
  if (!props.editEntry || submitting.value) return
  submitting.value = true
  try {
    const latest = await getExpense(props.editEntry.id)
    if (overwrite) applyEditEntry(latest)
    else {
      editVersion.value = latest.version
      versionConflict.value = false
      idempotencyAttempt.reset()
      toastKind.value = 'success'
      toastMessage.value = '已同步最新版本；你的输入仍保留，请确认后再次保存。'
      toastOpen.value = true
    }
  } catch (error) {
    toastKind.value = 'error'
    toastMessage.value = error instanceof Error ? error.message : '加载最新支出失败。'
    toastOpen.value = true
  } finally { submitting.value = false }
}

async function undo(): Promise<void> {
  if (!saved.value || !savedIdempotencyKey.value || undoing.value) return
  undoing.value = true
  try {
    await undoCreatedExpense(saved.value.id, savedIdempotencyKey.value)
    saved.value = undefined
    savedIdempotencyKey.value = ''
    detailOpen.value = false
    toastKind.value = 'success'
    toastMessage.value = '本次保存已撤销。'
    toastOpen.value = true
  } catch (error) {
    toastKind.value = 'error'
    toastMessage.value = error instanceof Error ? error.message : '撤销失败，请稍后重试。'
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
    class="entry-form"
    :aria-label="editMode ? '编辑支出' : '支出填报'"
  >
    <AppStateBlock
      v-if="optionsLoading"
      kind="loading"
      title="正在加载填报选项"
      message="商品搜索和已加载字段仍可继续填写。"
    />
    <AppStateBlock
      v-else-if="optionFailures.length"
      kind="error"
      title="部分选项暂未加载"
      :message="`${optionFailures.join('、')}加载失败，其他字段不受影响。`"
      action-label="重试"
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
      <strong>这条支出已在其他窗口更新</strong>
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
      class="entry-form task-entry-form"
      @submit.prevent="submit(false)"
    >
      <div class="entry-form-surface">
        <FormSection
          title="买了什么"
          :icon="ShoppingBag"
        >
          <ProductCombobox
            ref="productCombobox"
            :model-value="form.productId"
            :model-name="form.productName"
            :disabled="submitting"
            :error="errors.productId"
            @select="selectProduct"
            @clear="clearProduct"
          />
          <div class="form-grid-two entry-short-fields">
            <DictionaryCombobox
              input-id="expense-primary-category"
              type="expense-category"
              label="一级分类"
              :items="rootCategories"
              :model-value="form.primaryCategoryId"
              :disabled="submitting || optionsLoading"
              :error="errors.primaryCategoryId"
              @select="selectCategory($event, 'primary')"
              @clear="updatePrimaryCategory('')"
            />
            <DictionaryCombobox
              input-id="expense-secondary-category"
              type="expense-category"
              label="二级分类"
              optional
              :items="secondaryCategories"
              :model-value="form.secondaryCategoryId"
              :parent-id="form.primaryCategoryId"
              :disabled="submitting || optionsLoading || !form.primaryCategoryId"
              :error="errors.secondaryCategoryId"
              @select="selectCategory($event, 'secondary')"
              @clear="form.secondaryCategoryId = ''; clearError('secondaryCategoryId'); persist()"
            />
          </div>
        </FormSection>

        <FormSection
          title="花了多少"
          :icon="ReceiptText"
        >
          <div class="entry-amount-fields">
            <FormField
              field-id="expense-unit-price"
              label="单位价格"
              :error="errors.unitPrice"
            >
              <template #default="{ describedBy }">
                <input
                  id="expense-unit-price"
                  v-model="form.unitPrice"
                  inputmode="decimal"
                  :aria-describedby="describedBy"
                  :disabled="submitting"
                  @input="amountChanged"
                >
              </template>
            </FormField>
            <FormField
              field-id="expense-quantity"
              label="数量"
              :error="errors.quantity"
            >
              <template #default="{ describedBy }">
                <input
                  id="expense-quantity"
                  v-model="form.quantity"
                  inputmode="decimal"
                  :aria-describedby="describedBy"
                  :disabled="submitting"
                  @input="amountChanged"
                >
              </template>
            </FormField>
            <DictionaryCombobox
              input-id="expense-unit"
              type="unit"
              label="单位"
              :items="optionItems.units"
              :model-value="form.unitId"
              :disabled="submitting"
              :error="errors.unitId"
              @select="ensureOption('units', $event.id, $event.name); form.unitId = $event.id; clearError('unitId'); persist()"
              @clear="form.unitId = ''; clearError('unitId'); persist()"
            />
          </div>
          <FormField
            field-id="expense-paid-amount"
            class="entry-total-field money-expense"
            label="实付金额（¥）"
            :error="errors.paidAmount || errors.calculatedAmount"
          >
            <template #default="{ describedBy }">
              <input
                id="expense-paid-amount"
                v-model="form.paidAmount"
                inputmode="decimal"
                :aria-describedby="describedBy"
                :disabled="submitting"
                @input="paidChanged"
              >
            </template>
            <template #help>
              {{ differenceText }}
              <span class="field-help-detail">计算金额 {{ formatCny(calculatedAmount) }}</span>
            </template>
          </FormField>
        </FormSection>

        <FormSection
          title="如何付款"
          :icon="WalletCards"
        >
          <FundingChannelPicker
            class="entry-setting-field"
            :items="optionItems.funding"
            :loading="optionsLoading"
            :model-value="form.fundingChannelId"
            :disabled="submitting"
            :error="errors.fundingChannelId"
            @selected="ensureOption('funding', $event.id, $event.name)"
            @update:model-value="form.fundingChannelId = $event; clearError('fundingChannelId'); persist()"
          />

          <FormField
            field-id="expense-occurred-at"
            class="entry-setting-field"
            label="消费时间"
            :error="errors.occurredAt"
          >
            <template #default="{ describedBy }">
              <DateTimeControl
                id="expense-occurred-at"
                v-model="form.occurredAt"
                :aria-describedby="describedBy"
                :disabled="submitting"
                @change="clearError('occurredAt'); persist()"
              />
            </template>
          </FormField>
        </FormSection>

        <FormDisclosure
          :icon="NotebookPen"
          title="补充信息"
          :summary="supplementSummary"
          :invalid="Boolean(errors.purchaseChannelId || errors.locationLabelId || errors.note)"
        >
          <DictionaryPicker
            type="purchase-channel"
            input-id="expense-purchase-channel"
            label="购买渠道"
            optional
            :items="optionItems.purchase"
            :model-value="form.purchaseChannelId"
            :disabled="submitting"
            :error="errors.purchaseChannelId"
            @selected="ensureOption('purchase', $event.id, $event.name)"
            @update:model-value="form.purchaseChannelId = $event; clearError('purchaseChannelId'); persist()"
          />
          <LocationLabelPicker
            :items="optionItems.locations"
            :model-value="form.locationLabelId"
            :disabled="submitting"
            :error="errors.locationLabelId"
            @selected="ensureOption('locations', $event.id, $event.name)"
            @update:model-value="form.locationLabelId = $event; clearError('locationLabelId'); persist()"
          />
          <FormField
            field-id="expense-note"
            label="备注（选填）"
            help="最多 500 个字符。"
            :error="errors.note"
          >
            <template #default="{ describedBy }">
              <textarea
                id="expense-note"
                v-model="form.note"
                :aria-describedby="describedBy"
                :disabled="submitting"
                @input="clearError('note'); persist()"
              />
            </template>
          </FormField>
        </FormDisclosure>
      </div>

      <SavedEntrySummary
        v-if="saved && !editMode"
        :title="`${saved.productName} · −${formatCny(saved.paidAmount)}`"
        :description="`${saved.primaryCategoryName}${saved.secondaryCategoryName ? ` / ${saved.secondaryCategoryName}` : ''} · ${saved.fundingChannelName}`"
        tone="expense"
        :undoing="undoing"
        @undo="undo"
      >
        <button
          type="button"
          class="text-action"
          @click="detailOpen = !detailOpen"
        >
          {{ detailOpen ? '收起明细' : '查看本次明细' }}
        </button>
        <dl
          v-if="detailOpen"
          class="saved-expense-details"
        >
          <div><dt>数量与单价</dt><dd>{{ formatDecimalDisplay(saved.quantity) }} {{ saved.unitName }} × {{ formatCny(saved.unitPrice, 4) }}</dd></div>
          <div><dt>计算金额</dt><dd>{{ formatCny(saved.calculatedAmount) }}</dd></div>
          <div><dt>购买渠道</dt><dd>{{ saved.purchaseChannelName || '未指定' }}</dd></div>
          <div><dt>地点</dt><dd>{{ saved.locationLabelName || '未指定' }}</dd></div>
          <div><dt>消费时间</dt><dd>{{ formatShanghaiDateTime(saved.occurredAt) }}</dd></div>
          <div><dt>备注</dt><dd>{{ saved.note || '无' }}</dd></div>
        </dl>
      </SavedEntrySummary>

      <EntrySaveBar
        :submitting="submitting"
        :viewport-pinned="!editMode"
        :continue-visible="!editMode"
        :primary-label="editMode ? '保存修改' : '保存支出'"
        @continue="submit(true)"
      />
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
