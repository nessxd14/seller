import { describe,expect,it } from 'vitest'
import { hasPermission,permissionsByRole,type AuthSession } from '../AuthSessionProvider'
import { userMessageForError } from '../../errors/userMessages'
import { ConflictError, InactiveUserError, SessionExpiredError, TimeoutError, UnauthorizedError } from '../../errors/AppError'

const session=(role:keyof typeof permissionsByRole,active=true):AuthSession=>({user:{id:role,name:role,role,active},expiresAt:'2099-01-01'})
describe('roles y errores de aplicación',()=>{
  it('limita cajero, almacén y auditor',()=>{expect(hasPermission(session('cajero'),'orders_dispatch')).toBe(false);expect(hasPermission(session('almacen'),'orders_dispatch')).toBe(true);expect(hasPermission(session('auditor'),'quotes_write')).toBe(false)})
  it('floor_order (pantalla Piso): admin, gerente, cajero y vendedor; nadie más',()=>{
    for(const role of ['admin','gerente','cajero','vendedor'] as const) expect(hasPermission(session(role),'floor_order')).toBe(true)
    for(const role of ['supervisor','vendedor_mayoreo','almacen','almacenero','auditor','operario'] as const) expect(hasPermission(session(role),'floor_order')).toBe(false)
    expect(hasPermission(session('vendedor',false),'floor_order')).toBe(false)
  })
  it('el vendedor no tiene permisos de venta de mostrador ni de caja',()=>{
    for(const permission of ['retail_sale','wholesale_sale','cash_own','cash_supervise'] as const) expect(hasPermission(session('vendedor'),permission)).toBe(false)
  })
  it('bloquea usuarios inactivos',()=>expect(hasPermission(session('admin',false),'admin')).toBe(false))
  it('bloquea usuarios sin perfil',()=>expect(hasPermission({...session('admin'),user:{...session('admin').user,hasProfile:false}},'admin')).toBe(false))
  it('traduce errores sin detalles técnicos',()=>{expect(userMessageForError(new ConflictError('db code 123'))).toContain('Otra persona');expect(userMessageForError(new UnauthorizedError('policy'))).toContain('permiso');expect(userMessageForError(new SessionExpiredError('jwt'))).toContain('sesión');expect(userMessageForError(new InactiveUserError('policy'))).toContain('inactivo');expect(userMessageForError(new TimeoutError('gateway'))).toContain('reintentar')})
})
