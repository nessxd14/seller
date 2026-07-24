import type { AuthSession, AuthSessionProvider, AuthUser, MockRole } from '../../application/auth/AuthSessionProvider'

export const mockUsers:Array<AuthUser&{label:string}>=[
  {id:'admin',name:'Andrea Admin',role:'admin',active:true,label:'Admin'},
  {id:'supervisor',name:'Sergio Supervisor',role:'supervisor',active:true,label:'Supervisor'},
  {id:'cajero',name:'Natalia Cajera',role:'cajero',active:true,label:'Cajero'},
  {id:'vendedor',name:'Mario Mayorista',role:'vendedor_mayoreo',active:true,label:'Vendedor mayoreo'},
  {id:'almacen',name:'Alma Almacén',role:'almacen',active:true,label:'Almacén'},
  {id:'auditor',name:'Alicia Auditoría',role:'auditor',active:true,label:'Auditor'},
  {id:'operario',name:'Oscar Operario',role:'operario',active:true,label:'Operario legado'},
  {id:'inactive',name:'Usuario inactivo',role:'cajero' as MockRole,active:false,label:'Usuario inactivo'},
  {id:'no-profile',name:'Usuario sin perfil',role:'operario' as MockRole,active:true,hasProfile:false,label:'Usuario sin perfil'},
]
export class MockAuthSessionProvider implements AuthSessionProvider {
  private listeners=new Set<(session:AuthSession|null)=>void>()
  private session:AuthSession|null={user:mockUsers[0],expiresAt:new Date(Date.now()+8*3600000).toISOString()}
  async getSession(){return this.session}
  async setMockUser(userId:string|null){const user=mockUsers.find((candidate)=>candidate.id===userId);this.session=user?{user,expiresAt:new Date(Date.now()+8*3600000).toISOString()}:null;this.listeners.forEach((listener)=>listener(this.session))}
  subscribe(listener:(session:AuthSession|null)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  expire(){if(this.session)this.session={...this.session,expiresAt:new Date(0).toISOString()};this.listeners.forEach((listener)=>listener(this.session))}
}
export const mockAuthSessionProvider=new MockAuthSessionProvider()
