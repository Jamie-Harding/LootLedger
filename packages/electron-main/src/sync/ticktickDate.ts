/**
 * Normalizes TickTick timestamps like "2025-10-23T01:00:00.000+0000" to have a colon in the offset,
 * returns epoch millis. Returns null if input is absent or not parseable.
 * Keep this pure and side-effect free.
 */
export function parseTickTickDate(
  input: string | number | null | undefined,
): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null

  // Normalize "+HHMM" to "+HH:MM"
  const fixed = input.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const ms = Date.parse(fixed)
  return Number.isNaN(ms) ? null : ms
}
