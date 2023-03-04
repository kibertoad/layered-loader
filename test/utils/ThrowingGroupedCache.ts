import { GroupedCache } from '../../lib/DataSources'
import { User } from './Types'

export class ThrowingGroupedCache implements GroupedCache<User> {
  name = 'Throwing cache'
  isCache = true

  get(): Promise<User | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  clear(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  delete(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  set(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  deleteGroup(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getFromGroup(): Promise<User | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  setForGroup(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
