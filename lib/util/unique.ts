export const unique = <T>(arr: T[]): T[] => {
  if (arr.length <= 1) {
    return arr
  }
  const set = new Set(arr)
  return set.size === arr.length ? arr : Array.from(set)
}
