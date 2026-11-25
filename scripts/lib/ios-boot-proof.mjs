/** bootstatus 的成功终态由本次原生命令提供；拒绝错误 UUID、未完成或混合设备日志。 */
export function assertBootStatus(text, simulatorId) {
  if(typeof text!=='string' || Buffer.byteLength(text)>262144)
    throw new Error('原生启动终态日志无效或过大。')
  const headers=[...text.matchAll(/^Monitoring boot status for .+ \(([0-9a-f-]{36})\)\.\r?$/gim)]
  const finished=/Status=4294967295,\s*isTerminal=YES[^\n]*\n\s*Finished\s*$/.test(text)
  const already=/(?:^|\n)Device already booted, nothing to do\.\s*$/.test(text)
  if(headers.length!==1 || headers[0][1].toLowerCase()!==simulatorId.toLowerCase() || (!finished && !already))
    throw new Error('本轮设备尚无原生启动成功终态。')
  return 'Booted'
}

