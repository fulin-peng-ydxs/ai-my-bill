import type { components } from '../../api/generated/schema'

export type CreateExpenseRequest = components['schemas']['CreateExpenseRequest']
export type ExpenseResponse = components['schemas']['ExpenseResponse']
export type UpdateExpenseRequest = components['schemas']['UpdateExpenseRequest']
export type CreateIncomeRequest = components['schemas']['CreateIncomeRequest']
export type IncomeResponse = components['schemas']['IncomeResponse']
export type UpdateIncomeRequest = components['schemas']['UpdateIncomeRequest']
export type EntryType = 'EXPENSE' | 'INCOME'
