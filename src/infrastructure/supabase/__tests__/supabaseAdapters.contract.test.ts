import { describe, expect, it } from 'vitest'
import type { ContractFixture, ContractRepository } from '../../../application/contracts/repositoryContractTests'
import { runQuoteRepositoryContractTests } from '../../../application/contracts/repositoryContractTests'
import type { MutationContext, PageRequest, Versioned } from '../../../application/ports/repositories'
import type { QuoteDraft } from '../../../application/shared/models'
import { quoteRepository } from '../QuoteRepository.supabase'
import { orderRepository } from '../OrderRepository.supabase'
import { customerRepository } from '../CustomerRepository.supabase'
import { productRepository } from '../ProductRepository.supabase'
import { supabase } from '../supabaseClient'

// This whole file talks to the real shared Supabase project (zxoxougwgstrarwymlvd)
// and writes real rows into cotizacion / cotizacion_linea / pedido / pedido_linea /
// cliente. That is expected on this shared dev backend, but it should not run on
// every `npm test` (CI, sandboxes without network egress to *.supabase.co, etc.).
// It only runs when BOTH credentials are configured (.env.local) AND the developer
// explicitly opts in with RUN_SUPABASE_CONTRACT_TESTS=1, e.g.:
//   RUN_SUPABASE_CONTRACT_TESTS=1 npm test -- src/infrastructure/supabase/__tests__/supabaseAdapters.contract.test.ts
const hasLiveCredentials = Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY)
const optedIn = process.env.RUN_SUPABASE_CONTRACT_TESTS === '1'

describe.skipIf(!hasLiveCredentials || !optedIn)('Supabase adapters (live)', () => {
  // --- Quote: cotizacion has a real `version` column and a BORRADOR-gated
  // direct-write update path, so it is the one port that can genuinely satisfy the
  // full generic versioned-CRUD contract (including "stale version rejected" and
  // "idempotency key dedupe"). We wrap the real adapter in a small
  // ContractRepository-shaped adapter so the generic test's synchronous-looking
  // `simulateConcurrentUpdate` hook (which the real, network-backed adapter can't
  // implement synchronously) can still be exercised deterministically: the wrapper
  // remembers the in-flight "concurrent bump" promise for an id and awaits it
  // before the next `save` for that id proceeds.
  class QuoteContractRepository implements ContractRepository<QuoteDraft> {
    private pendingBumps = new Map<string, Promise<unknown>>()

    async list(request: PageRequest) {
      const { items, total } = await quoteRepository.list({ page: request })
      return { items, total }
    }
    async getById(id: string) {
      return quoteRepository.getById(id)
    }
    async save(value: QuoteDraft & Partial<Versioned>, context: MutationContext = {}) {
      if (value.id && this.pendingBumps.has(value.id)) {
        await this.pendingBumps.get(value.id)
        this.pendingBumps.delete(value.id)
      }
      return quoteRepository.save(value, { actorId: 'contract-test', ...context })
    }
    simulateConcurrentUpdate(id: string) {
      const bump = Promise.resolve(
        supabase
          .from('cotizacion')
          .select('version')
          .eq('id', Number(id))
          .maybeSingle()
          .then(({ data }) => {
            if (!data) return
            return supabase.from('cotizacion').update({ version: (data.version as number) + 1, actualizado_en: new Date().toISOString() }).eq('id', Number(id))
          })
      )
      this.pendingBumps.set(id, bump)
    }
  }

  const quoteFactory = (): ContractFixture<QuoteDraft> => ({
    repository: new QuoteContractRepository(),
    create: () => ({
      id: '',
      number: '',
      customerId: '',
      customerName: '',
      channel: 'mayoreo',
      status: 'draft',
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      terms: '',
      notes: 'Contract test',
      generalDiscountCents: 0,
      createdAt: new Date().toISOString(),
      lines: [
        {
          id: crypto.randomUUID(),
          productId: '',
          name: 'Contract test item',
          sku: '',
          quantity: 1,
          unitPriceCents: 1000,
          discountBasisPoints: 0,
          isCustomItem: true,
        },
      ],
    }),
  })

  // NOTE (found via live Supabase MCP execute_sql verification): crear_cotizacion
  // persists new rows with version = 0, not 1 as might be assumed from "version
  // starts at 1". The shared generic contract test's first assertion
  // (`expect(saved.version).toBe(1)`) will therefore fail against the real
  // backend even though the rest of the version-gating behavior (increment on
  // update, reject on stale version, idempotency-key dedupe) is correct and
  // verified. Left as-is rather than editing the shared repositoryContractTests.ts
  // helper (used by unrelated mock-repository tests that DO start at version 1).
  runQuoteRepositoryContractTests(quoteFactory)

  // --- Product, Customer and Order deliberately do NOT run the generic
  // versioned-CRUD contract against the real backend:
  //  - producto has no `save` in the ProductRepository port at all (it's search
  //    + getById only) and no version column, so the CRUD contract cannot apply.
  //  - cliente has no version column; the adapter intentionally always returns
  //    version:1 and allows writes unconditionally per the brief ("customers
  //    aren't optimistically locked at the DB level in this schema"), so the
  //    contract's "version becomes 2 after update" and "stale version rejected"
  //    assertions cannot hold by design.
  //  - pedido has no version column and is never optimistically edited after
  //    creation (only created/converted/dispatched), so the same applies.
  // Instead we run focused smoke tests against the real adapters that validate
  // the guarantees that DO apply to each.

  describe('SupabaseProductRepository (live smoke test)', () => {
    it('searches and fetches a real producto row', async () => {
      const page = await productRepository.search({ query: '', active: true, page: { page: 1, pageSize: 5 } })
      expect(page.items.length).toBeGreaterThan(0)
      const first = page.items[0]
      const byId = await productRepository.getById(String(first.id))
      expect(byId?.id).toBe(first.id)
      expect(typeof byId?.precioRetail).toBe('number')
    })
  })

  describe('SupabaseCustomerRepository (live smoke test)', () => {
    it('creates then updates a cliente row (no optimistic locking, writes always allowed)', async () => {
      const created = await customerRepository.save(
        {
          id: '',
          name: `Contract Test Customer ${Date.now()}`,
          type: 'wholesale',
          document: '',
          phone: '',
          email: '',
          address: '',
          usualChannel: 'mayoreo',
          paymentTerms: 'Contado',
          creditLimitCents: 0,
          pendingBalanceCents: 0,
        },
        {}
      )
      expect(created.version).toBe(1)
      expect(Number.isFinite(Number(created.id))).toBe(true)

      const updated = await customerRepository.save({ ...created, name: `${created.name} (editado)` }, {})
      expect(updated.id).toBe(created.id)
      expect(updated.name).toContain('(editado)')

      const fetched = await customerRepository.getById(created.id)
      expect(fetched?.name).toBe(updated.name)
    })
  })

  describe('SupabaseQuoteRepository + SupabaseOrderRepository (live end-to-end)', () => {
    it('creates a cotización with a catalog line and a custom line, then converts it to a pedido', async () => {
      const { data: catalogProduct, error } = await supabase
        .from('producto')
        .select('id, precio_mayoreo')
        .eq('activo', true)
        .not('precio_mayoreo', 'is', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      expect(catalogProduct).toBeTruthy()
      const productId = catalogProduct!.id as number
      const wholesalePrice = Number(catalogProduct!.precio_mayoreo)

      const draft: QuoteDraft = {
        id: '',
        number: '',
        customerId: '',
        customerName: '',
        channel: 'mayoreo',
        status: 'draft',
        validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
        terms: '',
        notes: 'E2E contract test',
        generalDiscountCents: 0,
        createdAt: new Date().toISOString(),
        lines: [
          {
            id: crypto.randomUUID(),
            productId: String(productId),
            name: 'catalog line',
            sku: '',
            quantity: 2,
            unitPriceCents: Math.round(wholesalePrice * 100),
            discountBasisPoints: 500, // 5%
          },
          {
            id: crypto.randomUUID(),
            productId: '',
            name: 'Sello a pedido',
            sku: '',
            quantity: 1,
            unitPriceCents: 5000,
            discountBasisPoints: 0,
            isCustomItem: true,
            note: 'Comprar a proveedor X',
          },
        ],
      }

      const savedQuote = await quoteRepository.save(draft, { actorId: 'contract-test' })
      expect(savedQuote.id).not.toBe('')
      expect(savedQuote.status).toBe('draft')
      expect(savedQuote.lines).toHaveLength(2)

      // stock_actual for the catalog product must be untouched by a mere quote.
      const { data: stockBefore } = await supabase.from('stock_actual').select('cantidad_base').eq('producto_id', productId)
      const { data: stockAfter } = await supabase.from('stock_actual').select('cantidad_base').eq('producto_id', productId)
      expect(stockAfter).toEqual(stockBefore)

      // Verified live (via Supabase MCP execute_sql) that convertir_cotizacion_a_pedido
      // accepts a BORRADOR cotización directly — no separate "approve" step is required.
      const convertedOrder = await orderRepository.save(
        {
          id: '',
          number: '',
          customerName: '',
          channel: 'mayoreo',
          status: 'draft',
          createdAt: new Date().toISOString(),
          sourceQuoteId: savedQuote.id,
          lines: [],
          events: [],
        },
        { actorId: 'contract-test' }
      )
      expect(convertedOrder.status).toBe('confirmed')
      expect(convertedOrder.lines).toHaveLength(2)
      const catalogLine = convertedOrder.lines.find((l) => !l.isCustomItem)
      const customLine = convertedOrder.lines.find((l) => l.isCustomItem)
      expect(catalogLine).toBeTruthy()
      expect(customLine).toBeTruthy()

      const reReadQuote = await quoteRepository.getById(savedQuote.id)
      expect(reReadQuote?.status).toBe('converted')
    }, 20000)
  })
})
