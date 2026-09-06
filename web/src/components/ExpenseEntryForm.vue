<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { ApiClientError } from '../api/http'
import { createExpense, undoCreatedExpense, type ExpenseResponse, type ProductSuggestion } from '../api/expenses'
import { listDictionaryCandidates } from '../api/dictionaries'
import {
  calculateExpenseTotal, decimalToScaledInteger, isDecimalInRange, MONEY_MAX, QUANTITY_MAX,
  scaledIntegerToDecimal, UNIT_PRICE_MAX,
} from '../domain/money'
import { expenseContinuationFields } from '../domain/expense'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import {
  formatShanghaiDateTime, isShanghaiLocalDateTime, shanghaiLocalDateTimeToIso, toShanghaiLocalDateTime,
} from '../domain/businessTime'
import { unicodeCodePointLength } from '../domain/text'
import { useLedgerDraft } from '../composables/useLedgerDraft'
import AppStateBlock from './AppStateBlock.vue'
import AppToast from './AppToast.vue'
import DictionaryPicker from './DictionaryPicker.vue'
import EntrySaveBar from './EntrySaveBar.vue'
import FormField from './FormField.vue'
import FormSection from './FormSection.vue'
import FundingChannelPicker from './FundingChannelPicker.vue'
import LocationLabelPicker from './LocationLabelPicker.vue'
import MoneySummary from './MoneySummary.vue'
import ProductCombobox from './ProductCombobox.vue'

const props = defineProps<{
  accountId?: string
  defaultFundingChannelId?: string | null
}>()

interface ExpenseFormState {
  productId: string
  productName: string
  primaryCategoryId: string
  secondaryCategoryId: string
  unitId: string
  unitPrice: string
  quantity: string
  paidAmount: string
  fundingChannelId: string
  purchaseChannelId: string
  locationLabelId: string
  occurredAt: string
  note: string
}

type FieldName = keyof ExpenseFormState | 'calculatedAmount'
type OptionGroup = 'categories' | 'units' | 'funding' | 'purchase' | 'locations'

interface ExpenseOption {
  id: string
  name: string
  parentId?: string
}

function emptyForm(): ExpenseFormState {
  return {
    productId: '', productName: '', primaryCategoryId: '', secondaryCategoryId: '', unitId: '',
    unitPrice: '', quantity: '1', paidAmount: '', fundingChannelId: props.defaultFundingChannelId ?? '',
    purchaseChannelId: '', locationLabelId: '', occurredAt: toShanghaiLocalDateTime(), note: '',
  }
}

const form = reactive<ExpenseFormState>(emptyForm())
const expenseType = ref<'EXPENSE'>('EXPENSE')
const accountId = computed(() => props.accountId)
const draft = useLedgerDraft(accountId, expenseType)
const optionItems = reactive<Record<OptionGroup, ExpenseOption[]>>({
  categories: [], units: [], funding: [], purchase: [], locations: [],
})
const optionFailures = ref<string[]>([])
const optionsLoading = ref(false)
const errors = reactive<Partial<Record<FieldName, string>>>({})
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
const differenceText = computed(() => {
  if (!isDecimalInRange(form.paidAmount, 2, MONEY_MAX)) return '填写后显示与计算金额的差额'
  const paidCents = decimalToScaledInteger(form.paidAmount, 2)
  const calculatedCents = decimalToScaledInteger(calculatedAmount.value, 2)
  const difference = paidCents - calculatedCents
  if (difference === 0n) return '与计算金额一致'
  const absolute = (difference < 0n ? -difference : difference).toString().padStart(3, '0')
  return `${difference > 0n ? '高于' : '低于'}计算金额 ¥${absolute.slice(0, -2)}.${absolute.slice(-2)}`
})
const summaryItems = computed(() => [
  { key: 'calculated', label: '计算金额', amount: calculatedAmount.value, tone: 'neutral' as const, sign: '' as const },
  { key: 'paid', label: '本次支出', amount: isDecimalInRange(form.paidAmount, 2, MONEY_MAX)
    ? scaledIntegerToDecimal(decimalToScaledInteger(form.paidAmount, 2), 2) : '0.00',
  tone: 'expense' as const, sign: '-' as const },
])

watch(() => draft.restored.value, (restored) => {
  if (!restored) return
  const stored = draft.data.value
  Object.assign(form, emptyForm(), stored)
  paidOverridden.value = Boolean(stored.paidAmount)
})

watch(() => props.defaultFundingChannelId, (value) => {
  if (!form.fundingChannelId && value) form.fundingChannelId = value
})

function persist(): void {
  void draft.replace(Object.fromEntries(Object.entries(form).filter(([, value]) => value)))
}

function clearError(field: FieldName): void {
  delete errors[field]
}

function amountChanged(): void {
  clearError('unitPrice')
  clearError('quantity')
  if (!paidOverridden.value) form.paidAmount = calculatedAmount.value === '0.00' ? '' : calculatedAmount.value
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
  form.unitPrice = product.lastUnitPrice ?? ''
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
  optionsLoading.value = false
}

function validate(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key as FieldName])
  if (!form.productId) errors.productId = '请选择或新增商品。'
  if (!form.primaryCategoryId) errors.primaryCategoryId = '请选择一级分类。'
  if (!form.unitId) errors.unitId = '请选择单位。'
  if (!isDecimalInRange(form.unitPrice, 4, UNIT_PRICE_MAX)) errors.unitPrice = '单价为 0 至 99,999,999.9999，最多 4 位小数。'
  if (!isDecimalInRange(form.quantity, 3, QUANTITY_MAX, true)) errors.quantity = '数量须大于 0，最多 3 位小数。'
  if (!isDecimalInRange(form.paidAmount, 2, MONEY_MAX)) errors.paidAmount = '实付金额为 0 至 999,999,999.99，最多 2 位小数。'
  if (!form.fundingChannelId) errors.fundingChannelId = '请选择支付方式。'
  if (!isShanghaiLocalDateTime(form.occurredAt)) errors.occurredAt = '请选择有效消费时间。'
  if (unicodeCodePointLength(form.note.trim()) > 500) errors.note = '备注最多 500 个字符。'
  try {
    calculateExpenseTotal(form.unitPrice, form.quantity)
  } catch {
    errors.calculatedAmount = '计算金额超出允许范围。'
  }
  return Object.keys(errors).length === 0
}

function requestBody() {
  return {
    productId: form.productId,
    primaryCategoryId: form.primaryCategoryId,
    ...(form.secondaryCategoryId ? { secondaryCategoryId: form.secondaryCategoryId } : {}),
    unitId: form.unitId,
    unitPrice: form.unitPrice,
    quantity: form.quantity,
    paidAmount: form.paidAmount,
    fundingChannelId: form.fundingChannelId,
    ...(form.purchaseChannelId ? { purchaseChannelId: form.purchaseChannelId } : {}),
    ...(form.locationLabelId ? { locationLabelId: form.locationLabelId } : {}),
    occurredAt: shanghaiLocalDateTimeToIso(form.occurredAt),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
  }
}

async function submit(continueEntry: boolean): Promise<void> {
  if (submitting.value || !validate()) return
  const body = requestBody()
  const idempotencyKey = idempotencyAttempt.keyFor(body)
  submitting.value = true
  try {
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
    idempotencyAttempt.reset()
  } catch (error) {
    if (error instanceof ApiClientError && error.body?.fieldErrors) {
      Object.entries(error.body.fieldErrors).forEach(([field, messages]) => {
        errors[field as FieldName] = messages?.[0]
      })
    }
    toastKind.value = 'error'
    toastMessage.value = error instanceof Error ? error.message : '保存失败，请重试。'
    toastOpen.value = true
  } finally {
    submitting.value = false
  }
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
</script>

<template>
  <section
    class="expense-entry-form"
    aria-label="支出填报"
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
    <AppStateBlock
      v-if="draft.storageError.value"
      kind="error"
      title="草稿未保存到此设备"
      :message="draft.storageError.value"
    />

    <form
      class="expense-form"
      @submit.prevent="submit(false)"
    >
      <FormSection
        title="商品信息"
        description="选择商品及其分类和计量单位。"
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
        <div class="form-grid-two">
          <FormField
            field-id="expense-primary-category"
            label="一级分类"
            :error="errors.primaryCategoryId"
          >
            <template #default="{ describedBy }">
              <select
                id="expense-primary-category"
                :value="form.primaryCategoryId"
                :aria-describedby="describedBy"
                :disabled="submitting"
                @change="updatePrimaryCategory(($event.target as HTMLSelectElement).value)"
              >
                <option value="">
                  请选择
                </option>
                <option
                  v-for="item in rootCategories"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.name }}
                </option>
              </select>
            </template>
          </FormField>
          <FormField
            field-id="expense-secondary-category"
            label="二级分类（选填）"
            :error="errors.secondaryCategoryId"
          >
            <template #default="{ describedBy }">
              <select
                id="expense-secondary-category"
                v-model="form.secondaryCategoryId"
                :aria-describedby="describedBy"
                :disabled="submitting || !form.primaryCategoryId"
                @change="clearError('secondaryCategoryId'); persist()"
              >
                <option value="">
                  未选二级
                </option>
                <option
                  v-for="item in secondaryCategories"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.name }}
                </option>
              </select>
            </template>
          </FormField>
        </div>
        <FormField
          field-id="expense-unit"
          label="单位"
          :error="errors.unitId"
        >
          <template #default="{ describedBy }">
            <select
              id="expense-unit"
              v-model="form.unitId"
              :aria-describedby="describedBy"
              :disabled="submitting"
              @change="clearError('unitId'); persist()"
            >
              <option value="">
                请选择
              </option>
              <option
                v-for="item in optionItems.units"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </template>
        </FormField>
      </FormSection>

      <FormSection
        title="金额信息"
        description="系统精确计算金额，实付可单独调整。"
      >
        <div class="form-grid-two">
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
        </div>
        <FormField
          field-id="expense-paid-amount"
          label="实付金额"
          :help="differenceText"
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
        </FormField>
        <MoneySummary
          :items="summaryItems"
          label="本次支出金额"
        />
      </FormSection>

      <FormSection
        title="渠道与场景"
        description="选择付款方式以及可选的购买渠道和地点标签。"
      >
        <div class="field-heading-action">
          <RouterLink to="/me/dictionaries/funding-channel">
            管理支付方式
          </RouterLink>
        </div>
        <FundingChannelPicker
          :items="optionItems.funding"
          :model-value="form.fundingChannelId"
          :disabled="submitting"
          :error="errors.fundingChannelId"
          @update:model-value="form.fundingChannelId = $event; clearError('fundingChannelId'); persist()"
        />
        <div class="field-heading-action">
          <RouterLink to="/me/dictionaries/purchase-channel">
            管理购买渠道
          </RouterLink>
        </div>
        <DictionaryPicker
          label="购买渠道"
          optional
          :items="optionItems.purchase"
          :model-value="form.purchaseChannelId"
          :disabled="submitting"
          :error="errors.purchaseChannelId"
          @update:model-value="form.purchaseChannelId = $event; clearError('purchaseChannelId'); persist()"
        />
        <div class="field-heading-action">
          <RouterLink to="/me/dictionaries/location">
            管理地点标签
          </RouterLink>
        </div>
        <LocationLabelPicker
          :items="optionItems.locations"
          :model-value="form.locationLabelId"
          :disabled="submitting"
          :error="errors.locationLabelId"
          @update:model-value="form.locationLabelId = $event; clearError('locationLabelId'); persist()"
        />
      </FormSection>

      <FormSection
        title="时间与备注"
        description="消费时间由服务端校验，备注仅保存在本条账目。"
      >
        <FormField
          field-id="expense-occurred-at"
          label="消费时间"
          help="客户端时间仅用于填写提示，服务端允许最多向未来偏移 5 分钟。"
          :error="errors.occurredAt"
        >
          <template #default="{ describedBy }">
            <input
              id="expense-occurred-at"
              v-model="form.occurredAt"
              type="datetime-local"
              :aria-describedby="describedBy"
              :disabled="submitting"
              @change="clearError('occurredAt'); persist()"
            >
          </template>
        </FormField>
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
      </FormSection>

      <EntrySaveBar
        :submitting="submitting"
        primary-label="保存支出"
        @continue="submit(true)"
      />
    </form>

    <section
      v-if="saved"
      class="saved-expense"
      aria-labelledby="saved-expense-title"
    >
      <div>
        <p class="eyebrow">
          刚刚保存
        </p>
        <h2 id="saved-expense-title">
          {{ saved.productName }} · −¥{{ saved.paidAmount }}
        </h2>
        <p>{{ saved.primaryCategoryName }}{{ saved.secondaryCategoryName ? ` / ${saved.secondaryCategoryName}` : '' }} · {{ saved.fundingChannelName }}</p>
      </div>
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
        <div><dt>数量与单价</dt><dd>{{ saved.quantity }} {{ saved.unitName }} × ¥{{ saved.unitPrice }}</dd></div>
        <div><dt>计算金额</dt><dd>¥{{ saved.calculatedAmount }}</dd></div>
        <div><dt>购买渠道</dt><dd>{{ saved.purchaseChannelName || '未指定' }}</dd></div>
        <div><dt>地点</dt><dd>{{ saved.locationLabelName || '未指定' }}</dd></div>
        <div><dt>消费时间</dt><dd>{{ formatShanghaiDateTime(saved.occurredAt) }}</dd></div>
        <div><dt>备注</dt><dd>{{ saved.note || '无' }}</dd></div>
      </dl>
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
