import type { LocalRepository } from '../../infrastructure/mock/localStore'
import type { CustomerRecord } from '../shared/models'
export class CustomerService {
  constructor(private readonly repository: LocalRepository<CustomerRecord>) {}
  list() { return this.repository.list() }
  save(customer: CustomerRecord) { return this.repository.save(customer) }
}

