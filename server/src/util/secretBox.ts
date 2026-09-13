import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * 模型 API Key 静态加密(AES-256-GCM)。
 * 密钥来源:MODEL_KEY_ENCRYPTION_KEY(64 位 hex)优先;未配置时从部署凭据确定性派生
 * (同机重启稳定;若轮换 REDIS_PASSWORD/MYSQL_PASSWORD,旧密文将无法解密,需重新保存 Key)。
 * 存储格式:v1:<iv_b64>:<tag_b64>:<cipher_b64>;无前缀视为历史明文,读取时原样返回,下次保存时自动升级加密。
 */

const ALGO = 'aes-256-gcm'
let warned = false

function encryptionKey(): Buffer {
  const explicit = process.env.MODEL_KEY_ENCRYPTION_KEY?.trim()
  if (explicit && /^[0-9a-fA-F]{64}$/.test(explicit)) {
    return Buffer.from(explicit, 'hex')
  }
  if (!warned) {
    warned = true
    console.warn('[security] MODEL_KEY_ENCRYPTION_KEY 未配置,密钥从部署凭据派生;公网部署建议显式配置 64 位 hex 随机密钥')
  }
  const seed = [process.env.REDIS_PASSWORD, process.env.MYSQL_PASSWORD, 'vibeboard-model-key'].filter(Boolean).join('|')
  return createHash('sha256').update(seed).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

/** 解密;非 v1 前缀 = 历史明文原样返回;解密失败(密钥轮换/数据损坏)返回 null,由调用方按未配置处理 */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith('v1:')) return stored
  const parts = stored.split(':')
  if (parts.length !== 4) return null
  try {
    const decipher = createDecipheriv(ALGO, encryptionKey(), Buffer.from(parts[1], 'base64'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
  } catch {
    console.warn('[security] secret decryption failed (key rotated or data corrupted)')
    return null
  }
}
