import type { MockRole } from '../application/auth/AuthSessionProvider'

/** Los mismos módulos del menú lateral de escritorio, en el mismo orden. */
export const MODULOS = ['Venta', 'Suspendidas', 'Borradores', 'Cotizaciones', 'Pedidos', 'Venta Directa', 'Clientes', 'Productos', 'Inventario', 'Traslados', 'Caja', 'Reportes', 'Comisiones', 'Configuración'] as const
export type Modulo = typeof MODULOS[number]

/** Cuántos módulos van fijos en la barra inferior; el resto queda en "Más". */
export const PESTANAS_MAX = 4

// Prioridad de la barra inferior por rol. El primero es la pantalla de arranque en el celular.
const PRIORIDAD: Partial<Record<MockRole, Modulo[]>> = {
  admin: ['Caja', 'Pedidos', 'Venta', 'Venta Directa'],
  gerente: ['Caja', 'Pedidos', 'Venta', 'Venta Directa'],
  supervisor: ['Caja', 'Pedidos', 'Venta', 'Venta Directa'],
  cajero: ['Venta', 'Venta Directa', 'Caja', 'Traslados'],
  // Reponedor: traslados y pendientes. En la base usa un rol de almacén.
  almacen: ['Traslados', 'Pedidos', 'Inventario', 'Productos'],
  almacenero: ['Traslados', 'Pedidos', 'Inventario', 'Productos'],
  vendedor_mayoreo: ['Cotizaciones', 'Pedidos', 'Clientes', 'Productos'],
}
// Relleno para roles sin prioridad propia, o cuando el rol no puede abrir alguno de su lista.
const RELLENO: Modulo[] = ['Venta', 'Caja', 'Pedidos', 'Venta Directa', 'Traslados', 'Cotizaciones', 'Clientes', 'Productos', 'Inventario', 'Reportes']

export function pestanasPara(role: MockRole | undefined, puedeAbrir: (m: Modulo) => boolean): Modulo[] {
  const lista = [...(role ? PRIORIDAD[role] ?? [] : []), ...RELLENO]
  const vistas = new Set<Modulo>()
  for (const m of lista) {
    if (vistas.size >= PESTANAS_MAX) break
    if (puedeAbrir(m)) vistas.add(m)
  }
  return [...vistas]
}

/** Lo que queda en "Más": los módulos que el rol puede abrir y no están en la barra. */
export function modulosMas(pestanas: Modulo[], puedeAbrir: (m: Modulo) => boolean): Modulo[] {
  return MODULOS.filter((m) => !pestanas.includes(m) && puedeAbrir(m))
}
