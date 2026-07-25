import { money, type Money } from '../common/money'
import type { EntityId, ISODateTime, SalesChannel } from '../common/types'
import type { CustomerSpecialPrice, PriceList, ProductPrice } from './entities'

export interface PriceResolutionRequest { productId: EntityId; variantId?: EntityId; channel: SalesChannel; customerId?: EntityId; at: ISODateTime; quantity: number }
export interface PriceResolution { priceListId: EntityId; basePrice: Money; specialPrice?: Money; discountBasisPoints: number; suggestedPrice: Money; source: 'price_list' | 'customer_special' }

const activeAt = (from: ISODateTime, until: ISODateTime | undefined, at: ISODateTime) => from <= at && (!until || until >= at)

export const resolvePrice = (request: PriceResolutionRequest, lists: PriceList[], prices: ProductPrice[], specials: CustomerSpecialPrice[] = []): PriceResolution => {
  if (!Number.isInteger(request.quantity) || request.quantity < 1) throw new Error('Cantidad inválida para resolver precio')
  const list = lists.find((candidate) => candidate.active && candidate.channel === request.channel && activeAt(candidate.validFrom, candidate.validUntil, request.at))
  if (!list) throw new Error(`No existe lista de precios activa para ${request.channel}`)
  const base = prices.filter((candidate) => candidate.priceListId === list.id && candidate.productId === request.productId && candidate.variantId === request.variantId && (candidate.minimumQuantity ?? 1) <= request.quantity).sort((a, b) => (b.minimumQuantity ?? 1) - (a.minimumQuantity ?? 1))[0]
  if (!base) throw new Error('El producto no tiene precio en la lista seleccionada')
  const special = request.customerId ? specials.filter((candidate) => candidate.customerId === request.customerId && candidate.productId === request.productId && candidate.variantId === request.variantId && activeAt(candidate.validFrom, candidate.validUntil, request.at) && (candidate.minimumQuantity ?? 1) <= request.quantity).sort((a, b) => (b.minimumQuantity ?? 1) - (a.minimumQuantity ?? 1))[0] : undefined
  return { priceListId: list.id, basePrice: base.price, specialPrice: special?.price, discountBasisPoints: 0, suggestedPrice: special?.price ?? base.price, source: special ? 'customer_special' : 'price_list' }
}

export const resolveMockChannelPrice = (channel: SalesChannel, prices: { retailCents: number; wholesaleCents: number; institutionalCents: number; municipalCents: number }): Money =>
  money(channel === 'retail' ? prices.retailCents : channel === 'mayoreo' ? prices.wholesaleCents : channel === 'institucional' ? prices.institutionalCents : prices.municipalCents)
