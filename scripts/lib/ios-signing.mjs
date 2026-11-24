const fail = message => { throw new Error('签名授权不匹配：'+message) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** 描述文件仅允许尾部通配；逐字比较前缀，不能把其他 App 或中间通配当成授权。 */
function allowed(actual,grant) {
  if (typeof actual === 'boolean' && typeof grant === 'boolean') return !actual || grant
  if (typeof grant === 'string') {
    if (typeof actual !== 'string') return false
    const star = grant.indexOf('*')
    return star === -1 ? actual === grant : star === grant.length-1 && actual.startsWith(grant.slice(0,-1))
  }
  if (Array.isArray(actual)) return Array.isArray(grant) && actual.every(x => grant.some(y => allowed(x,y)))
  if (object(actual)) return object(grant) && Object.entries(actual).every(([k,v]) => Object.hasOwn(grant,k) && allowed(v,grant[k]))
  return actual === grant
}

/** 核对实际签名、profile 授权及叶证书；App ID prefix 可以与 Team ID 不同。 */
export function signingAuthorization(candidate,evidence) {
  const signed = evidence?.signedEntitlements, grants = evidence?.profileEntitlements
  if (!object(signed) || !object(grants) || !candidate?.appId || !candidate.teamId ||
      !Array.isArray(evidence.profileTeamIds) || !evidence.profileTeamIds.includes(candidate.teamId) ||
      signed['com.apple.developer.team-identifier'] !== candidate.teamId) fail('缺失或错误 Team')
  const identifier = signed['application-identifier']
  if (typeof identifier !== 'string' || !Array.isArray(evidence.appIdPrefixes) ||
      !evidence.appIdPrefixes.some(prefix => typeof prefix === 'string' && prefix && identifier === prefix+'.'+candidate.appId))
    fail('App ID 或 prefix')
  if (!digest(evidence.signingCertificateSHA256) || !Array.isArray(evidence.profileCertificatesSHA256) ||
      !evidence.profileCertificatesSHA256.length || evidence.profileCertificatesSHA256.some(x => !digest(x)) ||
      !evidence.profileCertificatesSHA256.includes(evidence.signingCertificateSHA256)) fail('签名证书未获 profile 授权')
  for (const [key,value] of Object.entries(signed))
    if (!Object.hasOwn(grants,key) || !allowed(value,grants[key])) fail('entitlement '+key)
  return evidence
}
