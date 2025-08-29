export class TickTickClient {
  constructor(private token: string) {}

  async me() {
    /* GET profile as a quick ping */
  }

  async listChanges(since: number) {
    // Replace with real TickTick delta endpoint or fallback strategy:
    // e.g., list tasks updated after `since`.
    const url = `https://api.ticktick.com/.../tasks?updated_after=${since}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) throw new Error(`ticktick ${res.status}`)
    return res.json()
  }
}
