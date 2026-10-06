import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { uploadJson } from './upload.ts'

type Listener = (event: { lengthComputable?: boolean; loaded?: number; total?: number }) => void

class FakeUpload {
  private listeners: Listener[] = []
  addEventListener(_name: string, listener: Listener) { this.listeners.push(listener) }
  emit(event: { lengthComputable: boolean; loaded: number; total: number }) {
    this.listeners.forEach(listener => listener(event))
  }
}

class FakeXHR {
  static instances: FakeXHR[] = []
  readonly upload = new FakeUpload()
  responseType = ''
  responseText = ''
  status = 0
  timeout = 0
  private listeners = new Map<string, Listener[]>()

  constructor() { FakeXHR.instances.push(this) }
  open(_method: string, _url: string, _async: boolean) {}
  setRequestHeader(_name: string, _value: string) {}
  addEventListener(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener])
  }
  send(_payload: Blob) {
    this.upload.emit({ lengthComputable: true, loaded: 25, total: 100 })
    this.upload.emit({ lengthComputable: true, loaded: 100, total: 100 })
    this.status = 200
    this.responseText = JSON.stringify({ status: 'ok', data: { validated: true } })
    this.listeners.get('load')?.forEach(listener => listener({}))
  }
  abort() {}
}

const globalObject = globalThis as unknown as { XMLHttpRequest?: typeof FakeXHR }
const originalXHR = globalObject.XMLHttpRequest
afterEach(() => {
  globalObject.XMLHttpRequest = originalXHR
  FakeXHR.instances = []
})

void test('OTA upload reports determinate browser upload progress', async () => {
  globalObject.XMLHttpRequest = FakeXHR
  const progress: number[] = []
  const result = await uploadJson<{ status: string }>('/ota/upload', new Blob(['ota']), {
    onProgress: value => progress.push(value),
  })
  assert.deepEqual(result, { status: 'ok', data: { validated: true } })
  assert.deepEqual(progress, [0, 25, 100, 100])
  assert.equal(FakeXHR.instances.length, 1)
})
