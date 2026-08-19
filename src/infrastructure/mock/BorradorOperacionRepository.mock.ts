import type { BorradorOperacionRecord, BorradorOperacionTipo } from '../../application/shared/models'
import { LocalStorageRepository } from './localStore'

interface StoredBorrador extends BorradorOperacionRecord { usuarioId: string }

const store = new LocalStorageRepository<StoredBorrador>('roari-borradores-operacion-v1', [])
const now = () => new Date().toISOString()
const en24h = () => new Date(Date.now() + 24 * 3600000).toISOString()

/** Espejo mínimo de fn_borrador_touch()/RLS para que la demo se comporte igual: cada
 * guardado renueva 24 h, y cada usuario mock solo ve los suyos. */
export const borradorOperacionMockRepository = {
  async list(usuarioId: string): Promise<BorradorOperacionRecord[]> {
    const all = await store.list()
    return all.filter((b) => b.usuarioId === usuarioId).sort((a, b) => new Date(b.actualizadoEn).getTime() - new Date(a.actualizadoEn).getTime())
  },
  async getById(id: string): Promise<BorradorOperacionRecord | null> {
    return store.get(id)
  },
  async save(input: { id?: string; tipo: BorradorOperacionTipo; sucursalId?: number; titulo?: string; contenido: unknown }, usuarioId: string): Promise<BorradorOperacionRecord> {
    const existing = input.id ? await store.get(input.id) : null
    const record: StoredBorrador = {
      id: input.id ?? crypto.randomUUID(),
      usuarioId,
      tipo: input.tipo,
      sucursalId: input.sucursalId,
      titulo: input.titulo,
      contenido: input.contenido,
      creadoEn: existing?.creadoEn ?? now(),
      actualizadoEn: now(),
      expiraEn: en24h(),
    }
    return store.save(record)
  },
  async remove(id: string): Promise<void> {
    return store.remove(id)
  },
}
