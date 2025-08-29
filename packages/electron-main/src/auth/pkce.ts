import crypto from 'crypto'

export function generateVerifier(length = 64) {
  const buf = crypto.randomBytes(length)
  return buf.toString('base64url').replace(/=/g, '')
}

export async function challengeFromVerifier(verifier: string) {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return hash.toString('base64url').replace(/=/g, '')
}
