import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { ref } from 'vue'

const source = await readFile(new URL('../src/views/AndroidUpdatesView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const ast = ts.createSourceFile('view.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
const names = ['openCatalogDestination', 'installSelectedPackages']
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
assert.equal(functions.length, names.length)
const script = ts.transpileModule(functions.map(node => node.getText(ast)).join(String.fromCharCode(10)), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const calls = []
const routes = []
const packages = ['one', 'two'].map(packageId => ({ packageId, contentVersion: '1', title: packageId }))
const context = vm.createContext({
  busy: ref(''), error: ref(''), notice: ref(''), destinationOpen: ref(false),
  destinationError: ref(''), destinations: ref([]), packageResults: ref({}),
  questionBankCatalog: ref({ packages }), selectedPackages: ref(['one@1', 'two@1']),
  questionBankProfilesState: { items: [{ id: 7, name: 'Original' }] },
  packageKey: item => item.packageId + '@' + item.contentVersion,
  loadQuestionBankProfiles: async () => {}, refreshLogs: async () => {},
  post: async (path, body) => {
    calls.push({ path, ...body })
    if (body.package_id === 'one') throw new Error('QA network failure')
    return { id: 42 }
  },
  router: { push: async route => routes.push(route) },
})
vm.runInContext(script, context)
await context.openCatalogDestination()
assert.equal(context.destinationOpen.value, true)
assert.equal(calls.length, 0)
assert.deepEqual(Array.from(context.destinations.value, target => target.mode), ['new', 'new'])
assert.deepEqual(Array.from(context.destinations.value, target => target.profileId), [0, 0])
assert.match(descriptor.template.content, /@click="destinationOpen = false">取消/)
context.destinationOpen.value = false
await context.installSelectedPackages()
assert.equal(calls.length, 0)
await context.openCatalogDestination()
context.destinations.value[1].name = ' ONE '
await context.installSelectedPackages()
assert.equal(calls.length, 0)
assert.ok(context.destinationError.value)
context.destinations.value[1].mode = 'existing'
await context.installSelectedPackages()
assert.equal(calls.length, 0)
context.destinations.value[1].profileId = 7
context.selectedPackages.value = []
await context.installSelectedPackages()
assert.equal(calls.length, 2, 'selection changes after opening must not change the target snapshot')
assert.equal(calls[0].new_profile_name, 'one')
assert.equal(calls[0].profile_id, undefined)
assert.equal(calls[1].profile_id, 7)
assert.equal(calls[1].new_profile_name, undefined)
assert.equal(context.packageResults.value['one@1'].status, 'failed')
assert.equal(context.packageResults.value['two@1'].status, 'success')
assert.equal(context.busy.value, '')
assert.equal(routes[0].query.esqImportId, '42')
assert.equal(context.questionBankProfilesState.items.length, 1)
console.log('Remote destination UI: defaults, cancel, duplicate/invalid guards and mixed batch failure isolation passed')
