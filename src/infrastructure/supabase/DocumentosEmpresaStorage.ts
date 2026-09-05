import { supabase } from './supabaseClient'

// Brief: bucket `documentos-empresa` — privado, lectura y escritura requieren sesión
// autenticada (políticas RLS: lectura para `authenticated`, escritura solo admin vía
// `app_es_admin()`, verificado contra la base). Se guarda solo la RUTA del objeto en
// config_empresa.sello_url/firma_url (ej. "sello.png"), nunca el binario ni una URL
// pública — este módulo sube el archivo y devuelve esa ruta para que ConfigPage la
// persista con saveEmpresaConfig; la ruta se resuelve a una URL firmada recién al
// momento de renderizar (ver getDocumentoEmpresaSignedUrl).
const BUCKET = 'documentos-empresa'

export async function uploadDocumentoEmpresa(file: File, kind: 'sello' | 'firma'): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
  const path = `${kind}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
  if (error) throw error
  return path
}

// Resuelve una ruta de config_empresa.sello_url/firma_url a una URL firmada válida por
// 1 hora. Cada llamada genera un token distinto, así que no hace falta cache-busting: una
// imagen reemplazada nunca se sirve desde caché con la URL vieja.
export async function getDocumentoEmpresaSignedUrl(path: string): Promise<string> {
  if (!path) return ''
  // Ya es una URL completa (valor legado sin migrar todavía, o modo mock) — pasa tal cual.
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) return ''
  return data?.signedUrl ?? ''
}
