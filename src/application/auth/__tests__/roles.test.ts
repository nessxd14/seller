import { describe,expect,it } from 'vitest'
import { hasPermission,permissionsByRole,type AuthSession } from '../AuthSessionProvider'
import { userMessageForError } from '../../errors/userMessages'
import { ConflictError, SessionExpiredError, UnauthorizedError } from '../../errors/AppError'

const session=(role:keyof typeof permissionsByRole,active=true):AuthSession=>({user:{id:role,name:role,role,active},expiresAt:'2099-01-01'})
describe('roles y errores de aplicación',()=>{
  it('limita cajero, almacén y auditor',()=>{expect(hasPermission(session('cajero'),'orders_dispatch')).toBe(false);expect(hasPermission(session('almacen'),'orders_dispatch')).toBe(true);expect(hasPermission(session('auditor'),'quotes_write')).toBe(false)})
  it('bloquea usuarios inactivos',()=>expect(hasPermission(session('admin',false),'admin')).toBe(false))
  it('traduce errores sin detalles técnicos',()=>{expect(userMessageForError(new ConflictError('db code 123'))).toContain('Otra persona');expect(userMessageForError(new UnauthorizedError('policy'))).toContain('permiso');expect(userMessageForError(new SessionExpiredError('jwt'))).toContain('sesión')})
})

