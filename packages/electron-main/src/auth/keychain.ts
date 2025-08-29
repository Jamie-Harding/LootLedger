import keytar from 'keytar'
const SERVICE = 'LootLedger:TickTickOAuth'

export type Tokens = {
  access_token: string
  refresh_token: string
  expires_at: number
}

export async function saveTokens(account: string, tokens: Tokens) {
  await keytar.setPassword(SERVICE, account, JSON.stringify(tokens))
}
export async function loadTokens(account: string): Promise<Tokens | null> {
  const raw = await keytar.getPassword(SERVICE, account)
  return raw ? JSON.parse(raw) : null
}
export async function clearTokens(account: string) {
  await keytar.deletePassword(SERVICE, account)
}
