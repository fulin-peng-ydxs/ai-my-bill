<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { createExpenseAdjustment, type ExpenseAdjustmentResponse, type ExpenseAdjustmentType } from '../api/expenseAdjustments'
import { ApiClientError } from '../api/http'
import type { LedgerItem } from '../api/ledgerEntries'
import { registerUnsavedChanges } from '../composables/unsavedChanges'
import { shanghaiLocalDateTimeToIso, toShanghaiLocalDateTime } from '../domain/businessTime'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import { decimalToScaledInteger, isDecimalInRange, MONEY_MAX, scaledIntegerToDecimal, subtractMoney } from '../domain/money'
import { unicodeCodePointLength } from '../domain/text'
import DateTimeControl from './DateTimeControl.vue'
import EntrySaveBar from './EntrySaveBar.vue'
import FormField from './FormField.vue'
import FormSection from './FormSection.vue'
import MoneySummary from './MoneySummary.vue'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ source: LedgerItem }>()
const emit = defineEmits<{ saved: [value: ExpenseAdjustmentResponse] }>()
const form = reactive({ adjustmentType: 'REFUND' as ExpenseAdjustmentType, amount: '', occurredAt: toShanghaiLocalDateTime(), note: '' })
const errors = reactive<Partial<Record<keyof typeof form, string>>>({})
const submitting = ref(false)
const submitError = ref('')
const attempt = createIdempotencyAttemptTracker()
const initial = JSON.stringify(form)
const dirty = computed(() => JSON.stringify(form) !== initial)
const unregister = registerUnsavedChanges(dirty, () => Object.assign(form, JSON.parse(initial)))
onScopeDispose(unregister)

const paid = computed(() => props.source.amount)
const adjusted = computed(() => props.source.effectiveAdjustmentAmount ?? '0.00')
const remaining = computed(() => subtractMoney(paid.value, adjusted.value))
const preview = computed(() => {
  if (!isDecimalInRange(form.amount, 2, MONEY_MAX, true)) return remaining.value
  return subtractMoney(remaining.value, form.amount)
})
const summary = computed(() => [
  { key: 'paid', label: '原支出实付', amount: paid.value, tone: 'expense' as const, sign: '-' as const },
  { key: 'adjusted', label: '已生效调整', amount: adjusted.value, tone: 'income' as const, sign: '+' as const },
  { key: 'net', label: '本次后净支出', amount: preview.value.startsWith('-') ? '0.00' : preview.value, tone: 'expense' as const, sign: '-' as const },
])

function validate(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key as keyof typeof form])
  if (!isDecimalInRange(form.amount, 2, MONEY_MAX, true)) errors.amount = '请输入大于 0、最多两位小数的金额。'
  else if (decimalToScaledInteger(form.amount, 2) > decimalToScaledInteger(remaining.value, 2)) errors.amount = `当前最多还可调整 ¥${remaining.value}。`
  try { shanghaiLocalDateTimeToIso(form.occurredAt) } catch { errors.occurredAt = '请选择有效的上海时间。' }
  if (unicodeCodePointLength(form.note.trim()) > 500) errors.note = '备注最多 500 个字符。'
  return Object.keys(errors).length === 0
}

async function submit(): Promise<void> {
  if (submitting.value || !validate()) return
  const request = { adjustmentType: form.adjustmentType, amount: scaledIntegerToDecimal(decimalToScaledInteger(form.amount, 2), 2),
    occurredAt: shanghaiLocalDateTimeToIso(form.occurredAt), ...(form.note.trim() ? { note: form.note.trim() } : {}) }
  submitting.value = true; submitError.value = ''
  try {
    const saved = await createExpenseAdjustment(props.source.id, request, attempt.keyFor(request))
    attempt.reset()
    Object.assign(form, JSON.parse(initial))
    emit('saved', saved)
  } catch (error) {
    if (error instanceof ApiClientError && error.body?.fieldErrors) Object.entries(error.body.fieldErrors)
      .forEach(([field, messages]) => { errors[field as keyof typeof form] = messages?.[0] })
    submitError.value = error instanceof Error ? error.message : '调整保存失败，请重试。'
  } finally { submitting.value = false }
}
</script>

<template>
  <form
    class="adjustment-form"
    novalidate
    @submit.prevent="submit"
  >
    <FormSection
      title="原支出"
      description="来源已锁定，调整不会计入收入。"
    >
      <div class="adjustment-source">
        <strong>{{ source.title }}</strong><span>{{ source.categoryName }} · {{ source.fundingChannelName }}</span>
      </div>
      <MoneySummary
        :items="summary"
        label="调整前后金额"
      />
    </FormSection>
    <FormSection title="调整信息">
      <FormField
        field-id="adjustment-type"
        label="调整类型"
      >
        <SegmentedControl
          :model-value="form.adjustmentType"
          label="调整类型"
          :options="[{ value: 'REFUND', label: '退款' }, { value: 'REIMBURSEMENT', label: '报销' }]"
          @update:model-value="form.adjustmentType = $event as ExpenseAdjustmentType"
        />
      </FormField>
      <div class="form-grid-two">
        <FormField
          field-id="adjustment-amount"
          label="调整金额"
          :error="errors.amount"
          :help="`最多还可调整 ¥${remaining}`"
        >
          <input
            id="adjustment-amount"
            v-model="form.amount"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            @input="delete errors.amount"
          >
        </FormField>
        <FormField
          field-id="adjustment-time"
          label="调整时间"
          :error="errors.occurredAt"
        >
          <DateTimeControl
            id="adjustment-time"
            v-model="form.occurredAt"
            @input="delete errors.occurredAt"
          />
        </FormField>
      </div>
      <FormField
        field-id="adjustment-note"
        label="备注"
        :error="errors.note"
        help="选填，最多 500 字"
      >
        <textarea
          id="adjustment-note"
          v-model="form.note"
          rows="3"
          @input="delete errors.note"
        />
      </FormField>
      <p
        v-if="submitError"
        class="field-error"
        role="alert"
      >
        {{ submitError }}
      </p>
    </FormSection>
    <EntrySaveBar
      :submitting="submitting"
      primary-label="保存调整"
      :continue-visible="false"
    />
  </form>
</template>
