import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runBarcodeScan } from '../src/platform/android/barcode-scan-session.ts'

function fixture(overrides = {}) {
  const controller = new AbortController()
  const events = {}
  const removed = []
  let stops = 0
  const runtime = {
    prepare: async () => {},
    ...Object.fromEntries(['Scan', 'Error', 'Background', 'Back'].map(name => [
      'listen' + name, async callback => {
        events[name] = callback
        return { remove: async () => { removed.push(name) } }
      },
    ])),
    start: async () => { events.Scan('first'); events.Scan('second') },
    stop: async () => { stops++ },
    ...overrides,
  }
  return { controller, events, removed, runtime, stops: () => stops,
    run: (preview = async () => {}, started) => runBarcodeScan(runtime, controller.signal, preview, started) }
}

test('first scan wins and all listeners are removed', async () => {
  const f = fixture()
  assert.equal(await f.run(), 'first')
  assert.equal(f.stops(), 1)
  assert.deepEqual(f.removed.sort(), ['Back', 'Background', 'Error', 'Scan'])
})

test('abort before prepare never opens the camera', async () => {
  const f = fixture({ prepare: async () => assert.fail('prepare called') })
  f.controller.abort()
  await assert.rejects(f.run(), { name: 'AbortError' })
  assert.equal(f.stops(), 0)
})

test('abort during permission request does not start camera', async () => {
  const f = fixture({ prepare: async () => f.controller.abort() })
  await assert.rejects(f.run(), { name: 'AbortError' })
  assert.equal(f.stops(), 0)
})

test('late listener handle after cancellation is removed', async () => {
  const f = fixture({ listenBack: async () => {
    f.controller.abort()
    return { remove: async () => f.removed.push('LateBack') }
  } })
  await assert.rejects(f.run(), { name: 'AbortError' })
  assert.deepEqual(f.removed, ['Background', 'LateBack'])
})

for (const event of ['Background', 'Back']) {
  test(event + ' cancels and stops the camera', async () => {
    const f = fixture({ start: async () => f.events[event]() })
    await assert.rejects(f.run(), { name: 'AbortError' })
    assert.equal(f.stops(), 2)
    assert.equal(f.removed.length, 4)
  })
}

test('scan error releases camera and listeners', async () => {
  const f = fixture({ start: async () => f.events.Error() })
  await assert.rejects(f.run(), /扫描失败/)
  assert.equal(f.stops(), 1)
  assert.equal(f.removed.length, 4)
})

test('native start failure still stops and releases listeners', async () => {
  const f = fixture({ start: async () => { throw new Error('start failed') } })
  await assert.rejects(f.run(), /start failed/)
  assert.equal(f.stops(), 1)
  assert.equal(f.removed.length, 4)
})

test('delayed start after abort is stopped again and never reports ready', async () => {
  const f = fixture({ start: async () => {
    f.controller.abort()
    await new Promise(resolve => setTimeout(resolve, 5))
  } })
  await assert.rejects(f.run(undefined, () => assert.fail('ready after abort')), { name: 'AbortError' })
  assert.equal(f.stops(), 2)
})

test('stop failure still releases all listener handles', async () => {
  const f = fixture({ stop: async () => { throw new Error('stop failed') } })
  await assert.rejects(f.run(), /stop failed/)
  assert.equal(f.removed.length, 4)
})

test('one failing listener removal does not skip remaining handles', async () => {
  const f = fixture({ listenBackground: async () => ({ remove: async () => { throw new Error('remove failed') } }) })
  assert.equal(await f.run(), 'first')
  assert.equal(f.removed.length, 3)
})

test('preview failure never starts camera and releases listeners', async () => {
  const f = fixture()
  await assert.rejects(f.run(async () => { throw new Error('preview failed') }), /preview failed/)
  assert.equal(f.stops(), 0)
  assert.equal(f.removed.length, 4)
})
