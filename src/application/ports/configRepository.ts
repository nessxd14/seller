// Small standalone port for Parte 1's Configuración page. Kept out of repositories.ts
// since config_empresa/perfil/sucursal/caja don't fit the generic Versioned/CRUD shape
// used by every other port there (config_empresa is a singleton row, perfil/sucursal/
// caja are read-only for this feature — no create/update/delete UI, per the brief's
// explicit security constraint on user management).
export interface EmpresaConfig {
  razonSocial: string
  nit: string
  direccion: string
  ciudad: string
  telefono: string
  email: string
  pieDocumento: string
  // Brief S11 Bloque A: rutas en Storage (bucket documentos-empresa), no el binario.
  selloUrl: string
  firmaUrl: string
  firmaNombre: string
  firmaCargo: string
}

export interface UserSummary {
  id: string
  nombre: string
  email: string
  rol: string
  activo: boolean
}

export interface SucursalSummary {
  id: number
  nombre: string
  tipo: string
}

export interface CajaSummary {
  id: number
  nombre: string
  sucursalId: number
  activa: boolean
}

export interface ConfigRepository {
  getEmpresaConfig(): Promise<EmpresaConfig>
  saveEmpresaConfig(patch: Partial<EmpresaConfig>): Promise<EmpresaConfig>
  listUsers(): Promise<UserSummary[]>
  listSucursales(): Promise<SucursalSummary[]>
  listCajas(): Promise<CajaSummary[]>
}
