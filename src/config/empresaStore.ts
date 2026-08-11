import { empresaFallback } from './empresa'
import { configService } from '../infrastructure/services'

// Synchronously-readable, mutable store for the company letterhead data used by
// print-time components (DocumentoExportable, TicketPreviewModal, PosSidebar,
// LoginScreen). Those components render synchronously and can't await a fetch, so
// this module exports a plain mutable object seeded from `empresaFallback` and a
// `loadEmpresaConfig()` async function that mutates it in place once
// `configService.getEmpresaConfig()` resolves — "con los valores actuales como
// fallback si la consulta falla" per the brief: on fetch failure the fallback values
// are simply left in place forever, no error surfaced to the caller.
//
// `loadEmpresaConfig()` is triggered once near app startup (PosPage.tsx's PosContent)
// so real data has had a chance to load before a user opens a print preview; in mock
// mode the mock ConfigRepository's seeded values ARE the "real" values, so this isn't
// a degraded state there, just a different backend.
export const empresaStore: {
  razonSocial: string
  direccion: string
  ciudad: string
  celular: string
  correo: string
  nit: string
  pieDocumento: string
  readonly logoSrc: string
  // Brief S11 Bloque A: sello y firma de la empresa, para el pie de cotización/pedido/
  // nota de entrega. Vacío = no cargado (DocumentoExportable decide qué mostrar en ese caso).
  selloUrl: string
  firmaUrl: string
  firmaNombre: string
  firmaCargo: string
} = {
  razonSocial: empresaFallback.razonSocial,
  direccion: empresaFallback.direccion,
  ciudad: empresaFallback.ciudad,
  celular: empresaFallback.celular,
  correo: empresaFallback.correo,
  nit: empresaFallback.nit,
  pieDocumento: '',
  // logoSrc is never sourced from config_empresa (no such column) — always the
  // imported asset, kept readonly here so nothing accidentally overwrites it.
  logoSrc: empresaFallback.logoSrc,
  selloUrl: '',
  firmaUrl: '',
  firmaNombre: '',
  firmaCargo: '',
}

export async function loadEmpresaConfig(): Promise<void> {
  try {
    const config = await configService.getEmpresaConfig()
    empresaStore.razonSocial = config.razonSocial || empresaFallback.razonSocial
    empresaStore.direccion = config.direccion || empresaFallback.direccion
    empresaStore.ciudad = config.ciudad || empresaFallback.ciudad
    empresaStore.celular = config.telefono || empresaFallback.celular
    empresaStore.correo = config.email || empresaFallback.correo
    empresaStore.nit = config.nit || empresaFallback.nit
    empresaStore.pieDocumento = config.pieDocumento || ''
    empresaStore.selloUrl = config.selloUrl || ''
    empresaStore.firmaUrl = config.firmaUrl || ''
    empresaStore.firmaNombre = config.firmaNombre || ''
    empresaStore.firmaCargo = config.firmaCargo || ''
  } catch {
    // Fetch failed: keep whatever values are currently in the store (fallback on
    // first load, or the last successfully loaded values on a later refresh).
  }
}
