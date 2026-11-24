/** CLI 与落盘共用有界原因链；不输出 Error 对象、堆栈或其他任意属性。 */
export function errorMessage(error) {
  const seen = new Set(), parts = []
  const visit = (value,depth) => {
    if (parts.length >= 32 || depth > 8) { parts.push('[原因链已截断]'); return }
    if (value && typeof value === 'object') {
      if (seen.has(value)) { parts.push('[重复原因]'); return }
      seen.add(value)
    }
    const text = value instanceof Error ? value.message : String(value)
    parts.push(text.length <= 1024 ? text : text.slice(0,1024)+'[单条原因已截断]')
    if (value instanceof AggregateError) for (const nested of value.errors) {
      if (parts.length >= 32) { parts.push('[原因链已截断]'); break }
      visit(nested,depth+1)
    }
    if (value instanceof Error && value.cause !== undefined) visit(value.cause,depth+1)
  }
  visit(error,0)
  const message = parts.join('；原因：')
  return message.length <= 8192 ? message : message.slice(0,8160)+'[原因链已截断]'
}
