export const unique = <T>(arr: T[]): T[] => {
  const set = new Set(arr)
  return set.size === arr.length ? arr : Array.from(set)
}
