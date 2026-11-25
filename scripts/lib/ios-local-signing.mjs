import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto'

const account = 'ios-local-evidence'

/** The private key is sent over stdin to macOS Keychain, never argv, Git, or diagnostic output. */
export function createSigner() {
  if (process.platform !== 'darwin') throw new Error('本机回执签名配置需要 macOS 钥匙串。')
  const pair = generateKeyPairSync('ed25519')
  const service = 'com.mybill.local-evidence.' + randomUUID()
  const secret = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
  try {
    execFileSync('/usr/bin/security', ['-i'], {
      input: `add-generic-password -a ${account} -s ${service} -w ${secret}\n`,
      timeout: 30000, stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch { throw new Error('本机签名密钥写入钥匙串失败；未登记公钥。') }
  const signer = { keyId: randomUUID(), service, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }
  // security -i can return success for a failed subcommand. Read back before accepting setup.
  const key = loadSigner(signer)
  if (createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== signer.publicKey)
    throw new Error('钥匙串签名密钥回读不符。')
  return signer
}

export function loadSigner(signer) {
  if (process.platform !== 'darwin' || !/^com\.mybill\.local-evidence\.[a-f0-9-]{36}$/.test(signer.service ?? ''))
    throw new Error('本机签名配置无效。')
  try {
    const encoded = execFileSync('/usr/bin/security', ['find-generic-password', '-a', account, '-s', signer.service, '-w'], {
      encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    return createPrivateKey({ key: Buffer.from(encoded, 'base64'), type: 'pkcs8', format: 'der' })
  } catch { throw new Error('无法读取本机签名密钥；保留失败，不签发成功回执。') }
}
