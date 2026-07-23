import { useEffect, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import { mockAuthSessionProvider, mockUsers } from '../../infrastructure/mock/MockAuthSessionProvider'

export function AuthDevSelector({onChange}:{onChange:(session:AuthSession|null)=>void}){
  const[session,setSession]=useState<AuthSession|null>(null)
  useEffect(()=>{void mockAuthSessionProvider.getSession().then((value)=>{setSession(value);onChange(value)});return mockAuthSessionProvider.subscribe((value)=>{setSession(value);onChange(value)})},[onChange])
  const select=async(value:string)=>{if(value==='expired'){mockAuthSessionProvider.expire();return}await mockAuthSessionProvider.setMockUser(value==='none'?null:value)}
  return <div className="auth-dev-selector"><label><span>SESIÓN MOCK</span><select aria-label="Sesión mock" value={session&&new Date(session.expiresAt).getTime()<=0?'expired':session?.user.id??'none'} onChange={(event)=>void select(event.target.value)}><option value="none">Sin sesión</option><option value="expired">Sesión expirada</option>{mockUsers.map((user)=><option value={user.id} key={user.id}>{user.label}</option>)}</select></label><button onClick={()=>window.dispatchEvent(new CustomEvent('roari:conflict-demo'))}>Simular conflicto</button></div>
}
