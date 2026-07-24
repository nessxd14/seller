export type MockRole='admin'|'supervisor'|'cajero'|'vendedor_mayoreo'|'almacen'|'auditor'|'operario'
export type Permission='retail_sale'|'wholesale_sale'|'quotes_write'|'orders_view'|'orders_dispatch'|'cash_own'|'cash_supervise'|'price_override'|'cancel'|'return'|'customers_retail'|'admin'
export interface AuthUser { id:string;name:string;role:MockRole;active:boolean;hasProfile?:boolean }
export interface AuthSession { user:AuthUser;expiresAt:string }
export interface AuthSessionProvider { getSession():Promise<AuthSession|null>;setMockUser(userId:string|null):Promise<void>;subscribe(listener:(session:AuthSession|null)=>void):()=>void }

export const permissionsByRole:Record<MockRole,readonly Permission[]>={
  admin:['admin','retail_sale','wholesale_sale','quotes_write','orders_view','orders_dispatch','cash_own','cash_supervise','price_override','cancel','return','customers_retail'],
  supervisor:['retail_sale','wholesale_sale','quotes_write','orders_view','orders_dispatch','cash_own','cash_supervise','price_override','cancel','return','customers_retail'],
  cajero:['retail_sale','cash_own','customers_retail'],
  vendedor_mayoreo:['wholesale_sale','quotes_write','orders_view'],
  almacen:['orders_view','orders_dispatch'],
  auditor:['orders_view'],
  operario:['orders_view'],
}
export const hasPermission=(session:AuthSession|null,permission:Permission)=>Boolean(session?.user.active&&session.user.hasProfile!==false&&permissionsByRole[session.user.role].includes(permission))
