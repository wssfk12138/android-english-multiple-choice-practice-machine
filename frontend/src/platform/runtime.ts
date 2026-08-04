import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { PlatformKind, PlatformRuntime } from './types'

const kind: PlatformKind = Capacitor.getPlatform() === 'android' ? 'android' : 'web'

export const platformRuntime: PlatformRuntime = {
  kind,
  isNative: Capacitor.isNativePlatform(),
  isAndroid: kind === 'android',
  async ready() {
    if (!Capacitor.isNativePlatform()) return
    await App.getInfo()
  },
}

export function platformKind(): PlatformKind {
  return kind
}
