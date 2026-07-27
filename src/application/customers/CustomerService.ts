import type { LocalRepository } from '../../infrastructure/mock/localStore'
import type { CustomerRecord } from '../shared/models'

export class CustomerService {
  constructor(private readonly repository: LocalRepository<CustomerRecord>) {}

  // TAREA 4: the inline customer picker needs to search (nombre/documento) and paginate
  // against the same call shape as the Supabase adapter (`customerService.list({ query, page })`).
  // The mock backend has no server-side query, so this filters/paginates client-side over the
  // full localStorage list. Params stay optional so existing no-arg callers (DraftOrderEditor)
  // keep working unchanged.
  async list(input?: { query?: string; page?: { page: number; pageSize: number } }): Promise<CustomerRecord[]> {
    const all = await this.repository.list()
    const query = input?.query?.trim().toLowerCase()
    const filtered = query
      ? all.filter((customer) => customer.name.toLowerCase().includes(query) || customer.document.toLowerCase().includes(query))
      : all
    if (!input?.page) return filtered
    const { page, pageSize } = input.page
    const from = (page - 1) * pageSize
    return filtered.slice(from, from + pageSize)
  }

  save(customer: CustomerRecord) { return this.repository.save(customer) }
}
