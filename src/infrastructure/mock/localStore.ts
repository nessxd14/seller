export interface LocalRepository<T extends { id: string }> {
  list(): Promise<T[]>
  get(id: string): Promise<T | null>
  save(value: T): Promise<T>
  remove(id: string): Promise<void>
}

export class LocalStorageRepository<T extends { id: string }> implements LocalRepository<T> {
  constructor(private readonly key: string, private readonly seed: T[]) {}
  private read(): T[] {
    const raw = localStorage.getItem(this.key)
    if (!raw) { this.write(this.seed); return structuredClone(this.seed) }
    try { return JSON.parse(raw) as T[] } catch { return structuredClone(this.seed) }
  }
  private write(values: T[]) { localStorage.setItem(this.key, JSON.stringify(values)) }
  async list() { return this.read() }
  async get(id: string) { return this.read().find((item) => item.id === id) ?? null }
  async save(value: T) {
    const values = this.read()
    const index = values.findIndex((item) => item.id === value.id)
    if (index >= 0) values[index] = structuredClone(value)
    else values.unshift(structuredClone(value))
    this.write(values)
    return value
  }
  async remove(id: string) { this.write(this.read().filter((item) => item.id !== id)) }
}

