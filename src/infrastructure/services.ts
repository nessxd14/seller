// Backend selector facade: swaps between the mock (localStorage) implementations
// and the Supabase-backed implementations based on featureFlags.supabase, while
// keeping the exact same external shape so feature pages don't need to know which
// backend is active. Defaults to mocks (featureFlags.supabase === false).
import { featureFlags } from '../config/featureFlags'
import * as mockServices from './mock/services'
import * as supabaseServices from './supabase/services'

export const quoteService = featureFlags.supabase ? supabaseServices.quoteService : mockServices.quoteService
export const orderService = featureFlags.supabase ? supabaseServices.orderService : mockServices.orderService
export const customerService = featureFlags.supabase ? supabaseServices.customerService : mockServices.customerService
export const productRepository = featureFlags.supabase ? supabaseServices.productRepository : mockServices.productRepository
export const getStockByProduct = featureFlags.supabase ? supabaseServices.getStockByProduct : mockServices.getStockByProduct

// Idempotency dedupe is a client-side concern independent of the backend.
export const sensitiveOperations = mockServices.sensitiveOperations
export const cashService = mockServices.cashService
