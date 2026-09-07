<script setup lang="ts">
import type { ExpenseAdjustmentResponse } from '../api/expenseAdjustments'
import { formatShanghaiDateTime } from '../domain/businessTime'
import MoneySummary from './MoneySummary.vue'

defineProps<{ adjustment: ExpenseAdjustmentResponse, busy?: boolean }>()
defineEmits<{ revoke: [] }>()
</script>

<template>
  <section class="adjustment-detail">
    <div class="adjustment-detail-heading">
      <span class="ledger-type-tag ledger-type-adjustment">{{ adjustment.adjustmentType === 'REFUND' ? '退款' : '报销' }}</span>
      <strong>{{ adjustment.originalExpenseTitle }}</strong>
      <span class="status-text">{{ {
        EFFECTIVE: '已生效', REVOKED: '已撤销', TRASHED: '回收站', SOURCE_FROZEN: '随原支出冻结',
      }[adjustment.status] }}</span>
    </div>
    <MoneySummary
      :items="[
        { key: 'amount', label: '本次调整', amount: adjustment.amount, tone: 'income', sign: '+' },
        { key: 'effective', label: '累计有效调整', amount: adjustment.effectiveAdjustmentAmount, tone: 'income', sign: '+' },
        { key: 'net', label: '当前净支出', amount: adjustment.netExpenseAmount, tone: 'expense', sign: '-' },
      ]"
      label="调整详情金额"
    />
    <dl class="adjustment-metadata">
      <div><dt>调整时间</dt><dd>{{ formatShanghaiDateTime(adjustment.occurredAt) }}</dd></div>
      <div><dt>原支出实付</dt><dd>¥{{ adjustment.originalPaidAmount }}</dd></div>
      <div v-if="adjustment.note">
        <dt>备注</dt><dd>{{ adjustment.note }}</dd>
      </div>
    </dl>
    <p
      v-if="adjustment.fullyAdjusted"
      class="adjustment-full-state"
    >
      原支出已全额退款/报销
    </p>
    <button
      v-if="adjustment.status === 'EFFECTIVE'"
      type="button"
      class="secondary-button danger-text"
      :disabled="busy"
      @click="$emit('revoke')"
    >
      {{ busy ? '正在撤销…' : '撤销这笔调整' }}
    </button>
  </section>
</template>
