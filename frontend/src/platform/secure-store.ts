import { registerPlugin } from '@capacitor/core'
import { platformRuntime } from './runtime'
import type { SecureStore } from './types'

interface SecureStorePlugin {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  remove(options: { key: string }): Promise<void>
}

const NativeSecureStore = registerPlugin<SecureStorePlugin>('SecureStore')

const nativeStore: SecureStore = {
  async get(key) {
    const result = await NativeSecureStore.get({ key })
    return result.value
  },
  async set(key, value) {
    await NativeSecureStore.set({ key, value })
  },
  async remove(key) {
    await NativeSecureStore.remove({ key })
  },
}

const unavailableStore: SecureStore = {
  async get() {
    throw new Error('Android SecureStore 原生桥接尚未安装')
  },
  async set() {
    throw new Error('Android SecureStore 原生桥接尚未安装')
  },
  async remove() {
    throw new Error('Android SecureStore 原生桥接尚未安装')
  },
}

export const secureStore: SecureStore = platformRuntime.isAndroid ? nativeStore : unavailableStore
