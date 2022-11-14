const clone = require('rfdc')

const cloner = clone()

export function cloneDeep<T>(source: T): T {
  return cloner(source)
}
