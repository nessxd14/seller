import { supabase } from './supabaseClient'

// Brief S11 Bloque A: bucket `documentos-empresa` — público para lectura, escritura solo
// admin (política RLS `app_es_admin()`, verificada contra la base). Se guarda solo la
// RUTA en config_empresa.sello_url/firma_url, nunca el binario — este módulo solo sube el
// archivo y devuelve la URL pública para que ConfigPage la persista con saveEmpresaConfig.
const BUCKET = 'documentos-empresa'

export async function uploadDocumentoEmpresa(file: File, kind: 'sello' | 'firma'): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
  const path = `${kind}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  // Cache-bust: el nombre de archivo es fijo (sello.png/firma.png), así que sin esto el
  // navegador podría seguir mostrando la imagen vieja después de reemplazarla.
  return `${data.publicUrl}?v=${Date.now()}`
}
