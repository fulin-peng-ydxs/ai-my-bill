/** “保存并继续”只保留经产品确认的场景字段，其余字段由表单恢复为空值。 */
export function expenseContinuationFields(source: {
  occurredAt: string
  fundingChannelId: string
  purchaseChannelId: string
  locationLabelId: string
}): Record<string, string> {
  return {
    occurredAt: source.occurredAt,
    fundingChannelId: source.fundingChannelId,
    purchaseChannelId: source.purchaseChannelId,
    locationLabelId: source.locationLabelId,
  }
}
