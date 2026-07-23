import { QuoteService } from '../../application/quotations/QuoteService'
import { OrderService } from '../../application/orders/OrderService'
import { CustomerService } from '../../application/customers/CustomerService'
import { CashService } from '../../application/cash/CashService'
import type { CashSessionRecord, CustomerRecord, OrderView, QuoteDraft } from '../../application/shared/models'
import { LocalStorageRepository } from './localStore'
import { cashSeeds, customerSeeds, orderSeeds, quoteSeeds } from './seeds'

export const quoteService = new QuoteService(new LocalStorageRepository<QuoteDraft>('roari-quotes-v1', quoteSeeds))
export const orderService = new OrderService(new LocalStorageRepository<OrderView>('roari-orders-v1', orderSeeds))
export const customerService = new CustomerService(new LocalStorageRepository<CustomerRecord>('roari-customers-v1', customerSeeds))
export const cashService = new CashService(new LocalStorageRepository<CashSessionRecord>('roari-cash-v1', cashSeeds))

