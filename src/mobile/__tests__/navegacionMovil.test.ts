import { describe, expect, it } from 'vitest'
import { permissionsByRole, type MockRole } from '../../application/auth/AuthSessionProvider'
import { MODULOS, modulosMas, pestanasPara, PESTANAS_MAX, type Modulo } from '../navegacionMovil'

// Réplica de los permisos por módulo de PosPage (PERMISOS_MODULO): lo que no figura allí queda abierto.
const puede = (role: MockRole) => (m: Modulo) => {
  const p = permissionsByRole[role]
  const tiene = (x: string) => (p as readonly string[]).includes(x)
  switch (m) {
    case 'Venta': return tiene('retail_sale') || tiene('wholesale_sale')
    case 'Cotizaciones': return tiene('quotes_write') || role === 'auditor'
    case 'Pedidos': return tiene('orders_view')
    case 'Caja': return tiene('cash_own') || tiene('cash_supervise')
    case 'Traslados': return tiene('orders_dispatch') || tiene('retail_sale')
    case 'Venta Directa': return tiene('retail_sale')
    case 'Configuración': return tiene('admin')
    default: return true
  }
}

describe('navegación del celular', () => {
  it('cada rol arranca en su pantalla principal', () => {
    expect(pestanasPara('cajero', puede('cajero'))).toEqual(['Venta', 'Venta Directa', 'Caja', 'Traslados'])
    expect(pestanasPara('gerente', puede('gerente'))).toEqual(['Caja', 'Pedidos', 'Venta', 'Venta Directa'])
    expect(pestanasPara('admin', puede('admin'))[0]).toBe('Caja')
    expect(pestanasPara('almacen', puede('almacen'))).toEqual(['Traslados', 'Pedidos', 'Inventario', 'Productos'])
    expect(pestanasPara('vendedor_mayoreo', puede('vendedor_mayoreo'))[0]).toBe('Cotizaciones')
  })

  it('nunca muestra un módulo que el rol no puede abrir', () => {
    for (const role of Object.keys(permissionsByRole) as MockRole[]) {
      const p = puede(role)
      const tabs = pestanasPara(role, p)
      expect(tabs.length).toBeLessThanOrEqual(PESTANAS_MAX)
      for (const m of [...tabs, ...modulosMas(tabs, p)]) expect(p(m)).toBe(true)
    }
  })

  it('barra + "Más" cubren todos los módulos permitidos, sin repetir', () => {
    for (const role of Object.keys(permissionsByRole) as MockRole[]) {
      const p = puede(role)
      const tabs = pestanasPara(role, p)
      const mas = modulosMas(tabs, p)
      expect(new Set([...tabs, ...mas]).size).toBe(tabs.length + mas.length)
      expect([...tabs, ...mas].sort()).toEqual(MODULOS.filter(p).sort())
    }
  })

  it('sin rol (sesión aún cargando) usa el orden general', () => {
    expect(pestanasPara(undefined, () => true)).toEqual(['Venta', 'Caja', 'Pedidos', 'Venta Directa'])
  })
})
