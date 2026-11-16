/** Only show a reset action when at least one effective filter differs from its reset value. */
export function hasFilterChanges<T extends object>(filters: T, defaults: T): boolean {
  return Object.entries(filters).some(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === false) return false
    return value !== defaults[key as keyof T]
  })
}
