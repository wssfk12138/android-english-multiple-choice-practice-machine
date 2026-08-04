export type PlatformKind = 'web' | 'android'

export interface PlatformRuntime {
  kind: PlatformKind
  isNative: boolean
  isAndroid: boolean
  ready(): Promise<void>
}

export interface SecureStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface UpdateManifest {
  schemaVersion: 1
  channel: 'stable' | 'beta' | 'alpha' | 'debug'
  versionName: string
  versionCode: number
  minimumVersionCode?: number
  publishedAt?: string
  apkUrl: string
  apkSha256: string
  apkSize?: number
  releaseNotes?: string
  manifestSignature?: string
}

export interface QuestionBankRemotePackage {
  packageId: string
  title: string
  contentVersion: string
  fileName: string
  downloadUrl: string
  sha256: string
  size?: number
  license?: string
  years?: number[]
}

export interface QuestionBankRemoteCatalog {
  catalogVersion: number
  updatedAt: string
  packages: QuestionBankRemotePackage[]
}
