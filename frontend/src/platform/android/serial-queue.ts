export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve()

  return async function runSerial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>(resolve => { release = resolve })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
