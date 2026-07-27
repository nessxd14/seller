import type { CajaSummary, ConfigRepository, EmpresaConfig, SucursalSummary, UserSummary } from '../../application/ports/configRepository'
import { empresaFallback } from '../../config/empresa'
import { mockUsers } from './MockAuthSessionProvider'

const STORAGE_KEY = 'roari-config-empresa-v1'

// Singleton row, mirrored from empresaFallback's current hardcoded values so mock
// mode's Configuración page has something sensible to show/edit. Unlike
// LocalStorageRepository (array-of-records), this is a single object — no
// versioning/contract-test need here, just a plain persisted singleton.
const readEmpresa = (): EmpresaConfig => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try { return JSON.parse(raw) as EmpresaConfig } catch { /* fall through to seed */ }
  }
  const seeded: EmpresaConfig = {
    razonSocial: empresaFallback.razonSocial,
    nit: empresaFallback.nit,
    direccion: empresaFallback.direccion,
    ciudad: empresaFallback.ciudad,
    telefono: empresaFallback.celular,
    email: empresaFallback.correo,
    pieDocumento: '',
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}
const writeEmpresa = (value: EmpresaConfig) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value))

// Well-known fixed values used throughout this codebase since Brief 2 — safe to
// hardcode identically here (mock mode has no real sucursal/caja tables).
const MOCK_SUCURSALES: SucursalSummary[] = [
  { id: 1, nombre: 'Almacén Central', tipo: 'fisica' },
  { id: 2, nombre: 'Tienda', tipo: 'fisica' },
]
const MOCK_CAJAS: CajaSummary[] = [{ id: 1, nombre: 'Caja Tienda', sucursalId: 2, activa: true }]

export class MockConfigRepository implements ConfigRepository {
  async getEmpresaConfig(): Promise<EmpresaConfig> {
    return readEmpresa()
  }

  async saveEmpresaConfig(patch: Partial<EmpresaConfig>): Promise<EmpresaConfig> {
    const updated = { ...readEmpresa(), ...patch }
    writeEmpresa(updated)
    return updated
  }

  // Mock mode has no real `perfil` table — reuse the same roster MockAuthSessionProvider
  // drives (mockUsers), mapped to this port's shape. Mock users don't carry real emails,
  // so a plausible local address is synthesized here for display purposes only.
  async listUsers(): Promise<UserSummary[]> {
    return mockUsers.map((user) => ({ id: user.id, nombre: user.name, email: `${user.id}@cationtdd.local`, rol: user.role, activo: user.active }))
  }

  async listSucursales(): Promise<SucursalSummary[]> {
    return MOCK_SUCURSALES
  }

  async listCajas(): Promise<CajaSummary[]> {
    return MOCK_CAJAS
  }
}

export const configRepository = new MockConfigRepository()
