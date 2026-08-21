/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_UPDATE_MANIFEST_URL?: string
  readonly VITE_QUESTION_BANK_CATALOG_URL?: string
  readonly VITE_DIAGNOSTIC_RECEIVER_URL?: string
  readonly VITE_BUNDLED_QUESTION_BANK?: string
  readonly VITE_BUNDLED_QUESTION_BANKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
