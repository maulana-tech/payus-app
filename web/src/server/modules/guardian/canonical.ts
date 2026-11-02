/**
 * The exact bytes a proposal hashes to. Keys are sorted at every depth, so
 * the same proposal written in a different order is the same proposal — and
 * a proposal with one digit changed is not.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
    .join(",")}}`;
}
