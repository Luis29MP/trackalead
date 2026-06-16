// Cifrado simétrico AES-GCM para las API keys de IA.
// La clave se deriva (SHA-256) de la frase secreta AI_KEYS_KEK.
// Formato almacenado: base64( iv[12] || ciphertext ).

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(passphrase))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encryptSecret(plain: string, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)))
  const combined = new Uint8Array(iv.length + ct.length)
  combined.set(iv, 0)
  combined.set(ct, iv.length)
  return toBase64(combined)
}

export async function decryptSecret(payload: string, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase)
  const data = fromBase64(payload)
  const iv = data.slice(0, 12)
  const ct = data.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return decoder.decode(pt)
}
