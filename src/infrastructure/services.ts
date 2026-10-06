// Backend selector facade: swaps between the mock (localStorage) implementations
// and the Supabase-backed implementations based on featureFlags.supabase, while
// keeping the exact same external shape so feature pages don't need to know which
// backend is active. Defaults to mocks (featureFlags.supabase === false).
import { featureFlags } from '../config/featureFlags'
import * as mockServices from './mock/services'
import * as supabaseServices from './supabase/services'
import { mockAuthSessionProvider } from './mock/MockAuthSessionProvider'
import { supabaseAuthSessionProvider } from './supabase/SupabaseAuthSessionProvider'

export const authSessionProvider = featureFlags.supabase ? supabaseAuthSessionProvider : mockAuthSessionProvider

export const quoteService = featureFlags.supabase ? supabaseServices.quoteService : mockServices.quoteService
export const orderService = featureFlags.supabase ? supabaseServices.orderService : mockServices.orderService
export const customerService = featureFlags.supabase ? supabaseServices.customerService : mockServices.customerService
export const productRepository = featureFlags.supabase ? supabaseServices.productRepository : mockServices.productRepository
export const getStockByProduct = featureFlags.supabase ? supabaseServices.getStockByProduct : mockServices.getStockByProduct
export const getStockBySucursalBatch = featureFlags.supabase ? supabaseServices.getStockBySucursalBatch : mockServices.getStockBySucursalBatch
export const listPresentations = featureFlags.supabase ? supabaseServices.listPresentations : mockServices.listPresentations
export const listLineIdentifiers = featureFlags.supabase ? supabaseServices.listLineIdentifiers : mockServices.listLineIdentifiers
export const listBrands = featureFlags.supabase ? supabaseServices.listBrands : mockServices.listBrands
export const listFrecuentes = featureFlags.supabase ? supabaseServices.listFrecuentes : mockServices.listFrecuentes

// Idempotency dedupe is a client-side concern independent of the backend.
export const sensitiveOperations = mockServices.sensitiveOperations
export const cashService = featureFlags.supabase ? supabaseServices.cashService : mockServices.cashService
export const saleService = featureFlags.supabase ? supabaseServices.saleService : mockServices.saleService
export const transferService = featureFlags.supabase ? supabaseServices.transferService : mockServices.transferService
export const ventaDirectaService = featureFlags.supabase ? supabaseServices.ventaDirectaService : mockServices.ventaDirectaService
export const borradorOperacionService = featureFlags.supabase ? supabaseServices.borradorOperacionService : mockServices.borradorOperacionService
export const configService = featureFlags.supabase ? supabaseServices.configService : mockServices.configService
export const reportsService = featureFlags.supabase ? supabaseServices.reportsService : mockServices.reportsService
export const comisionesService = featureFlags.supabase ? supabaseServices.comisionesService : mockServices.comisionesService

// Brief Caja-1: solo tiene implementación Supabase — el modo mock sigue con el flujo
// simple de abrir/cerrar caja de siempre (ver CashPage.tsx), así que nunca debería
// llegar a llamar nada de acá; el throw es la señal clara si algún día lo hace.
export const turnoService = featureFlags.supabase ? supabaseServices.turnoService : new Proxy({} as typeof supabaseServices.turnoService, {
  get() { return () => { throw new Error('turnoService no está disponible en modo mock — CashPage.tsx debe usar el flujo mock de siempre.') } },
})

// Piso: solo tiene implementación Supabase (las RPC viven en la base); en modo mock la pantalla
// /piso no puede usarse y el throw es la señal clara.
export const pedidoVendedorService = featureFlags.supabase ? supabaseServices.pedidoVendedorService : new Proxy({} as typeof supabaseServices.pedidoVendedorService, {
  get() { return () => { throw new Error('pedidoVendedorService no está disponible en modo mock.') } },
})
