import type { LedgerContracts } from '../../domain/ledgerContracts'

export type CreateExpenseRequest = LedgerContracts['CreateExpenseRequest']
export type ExpenseResponse = LedgerContracts['ExpenseResponse']
export type UpdateExpenseRequest = LedgerContracts['UpdateExpenseRequest']
export type CreateIncomeRequest = LedgerContracts['CreateIncomeRequest']
export type IncomeResponse = LedgerContracts['IncomeResponse']
export type UpdateIncomeRequest = LedgerContracts['UpdateIncomeRequest']
export type EntryType = 'EXPENSE' | 'INCOME'
