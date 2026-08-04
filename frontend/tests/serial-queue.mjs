import { createSerialQueue } from '../src/platform/android/serial-queue.ts'

const serial = createSerialQueue()
let active = 0
let peak = 0
const order = []

await Promise.all([1, 2, 3].map(index => serial(async () => {
  active += 1
  peak = Math.max(peak, active)
  order.push(`start-${index}`)
  await new Promise(resolve => setTimeout(resolve, 5))
  order.push(`end-${index}`)
  active -= 1
})))

if (peak !== 1) throw new Error(`Expected one active transaction, got ${peak}`)
if (order.join(',') !== 'start-1,end-1,start-2,end-2,start-3,end-3') {
  throw new Error(`Unexpected transaction order: ${order.join(',')}`)
}

let recovered = false
await serial(async () => { throw new Error('expected') }).catch(() => undefined)
await serial(async () => { recovered = true })
if (!recovered) throw new Error('Queue did not recover after a rejected operation')
