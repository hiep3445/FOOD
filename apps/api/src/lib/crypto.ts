const encoder = new TextEncoder()

export function createTrackingToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomId() {
  return crypto.randomUUID()
}

export function createOrderCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(token))
  const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex(iv)}:${hex(new Uint8Array(encrypted))}`
}

export async function decryptToken(value: string, secret: string) {
  const [ivHex, ciphertextHex] = value.split(':')
  if (!/^[a-f0-9]{24}$/.test(ivHex) || !/^[a-f0-9]{128,}$/.test(ciphertextHex)) throw new Error('Stored tracking token is invalid')
  const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(ivHex) }, await encryptionKey(secret), bytes(ciphertextHex))
  return new TextDecoder().decode(plaintext)
}