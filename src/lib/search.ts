/** Case-insensitive literal substring search across the fields a section exposes. */
export function matchesSearch(query: string, values: readonly (string | null | undefined)[]) {
  const term = query.trim().toLowerCase();
  return !term || values.some((value) => value?.toLowerCase().includes(term));
}
