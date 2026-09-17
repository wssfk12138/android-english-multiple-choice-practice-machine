import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
const manifestPath = new URL('./public/content-remediation.json', import.meta.url)
const manifestText = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
const manifest = manifestText ? JSON.parse(manifestText) : null
const remediationHeader = manifest ? { revision: manifest.revision, units: manifest.units.map((u: any) => ({ unitKey:u.unitKey })), digest:createHash('sha256').update(manifestText).digest('hex') } : null

export default defineConfig({
  plugins: [vue()],
  define: { __CONTENT_REMEDIATION_HEADER__: JSON.stringify(remediationHeader) },
  server: {
    port: 5173,
  },
})
