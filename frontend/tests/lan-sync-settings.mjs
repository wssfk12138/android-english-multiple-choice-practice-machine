import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

// Normalize CRLF so the fix-line probe below works regardless of the
// checkout's core.autocrlf setting (the working tree is CRLF on Windows).
const source = readFileSync(new URL('../src/platform/android/lan-sync.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

async function checkSettings(code) {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT)')
    const database = {
      rows: async (sql, values = []) => sqlite.prepare(sql).all(...values),
      row: async (sql, values = []) => sqlite.prepare(sql).get(...values),
      run: async (sql, values = []) => sqlite.prepare(sql).run(...values),
    }
    const categories = { exports: {} }
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/lan-categories.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, categories)
    const settingsModule={exports:{},require:()=>database}
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/app-settings.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,settingsModule)
    const context = { exports: {}, require: name => name === './app-settings' ? settingsModule.exports : name === './database' ? database : name === './lan-categories' ? categories.exports : {} }
    vm.runInNewContext(ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context)
    const update = context.exports.updateLanSyncSettings
    const saved = key => sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value
    await update({ lan_sync_passcode: '' })
    assert.equal(saved('lan_sync_passcode'), undefined)
    await update({ lan_sync_passcode: ' QA-original ' })
    assert.equal(saved('lan_sync_passcode'), 'QA-original')
    for (const value of ['', '  ', undefined, null]) {
      await update({ lan_sync_passcode: value, lan_sync_auto: '0' })
      assert.equal(saved('lan_sync_passcode'), 'QA-original', 'blank save must preserve saved credential')
      assert.equal(saved('lan_sync_auto'), '0')
    }
    await update({ lan_sync_auto: '1' })
    assert.equal(saved('lan_sync_passcode'), 'QA-original')
    assert.equal(saved('lan_sync_auto'), '1')
    await update({ lan_sync_passcode: 'QA-rotated' })
    assert.equal(saved('lan_sync_passcode'), 'QA-rotated')
    const status = await context.exports.lanSyncStatus()
    assert.equal(JSON.stringify(status).includes('QA-rotated'), false)
  } finally {
    sqlite.close()
  }
}

await checkSettings(source)
const withoutFix = source.replace("    if (key === 'lan_sync_passcode' && !String(body[key] ?? '').trim()) continue\n", '')
assert.notEqual(withoutFix, source)
await assert.rejects(checkSettings(withoutFix), { name: 'AssertionError' })
console.log('LAN settings: first blank, repeated blank, omitted credential, toggle, rotation and pre-fix regression passed')
