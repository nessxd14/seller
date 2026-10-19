import { listPresentations } from '../infrastructure/services'
import { mensajePresentacionNoDisponible, mensajeSinPresentacion, presentacionInicial, presentacionVendeEnLado, type LadoVenta } from '../domain/pricing/presentacionesPorLado'

type PresentacionCarga = Awaited<ReturnType<typeof listPresentations>>[number]

export type ResultadoAgregar =
  | { ok: true; /** Presentación con la que arranca la línea (la inicial del lado); undefined si no se pudo saber. */ inicial?: PresentacionCarga }
  | { ok: false; mensaje: string }

/**
 * Antes de agregar un producto a una venta de tienda o a un pedido de almacén: ¿hay alguna presentación
 * habilitada para ese lado y, si el código escaneado trae una, está habilitada? Si no se pueden leer las
 * presentaciones no se bloquea: la base de datos rechaza igual la línea (23514) y ese error se muestra tal cual.
 */
export async function presentacionAlAgregar(productId: number, lado: LadoVenta, escaneada?: { id: number; nombre: string }): Promise<ResultadoAgregar> {
  let lista: PresentacionCarga[]
  try { lista = await listPresentations(productId) } catch { return { ok: true } }
  if (!lista.length) return { ok: true }
  const inicial = presentacionInicial(lista, lado)
  if (!inicial) return { ok: false, mensaje: mensajeSinPresentacion(lado) }
  const hallada = escaneada ? lista.find((p) => p.id === escaneada.id) : undefined
  if (hallada && !presentacionVendeEnLado(hallada, lado)) return { ok: false, mensaje: mensajePresentacionNoDisponible(hallada.nombre, lado) }
  return { ok: true, inicial }
}
