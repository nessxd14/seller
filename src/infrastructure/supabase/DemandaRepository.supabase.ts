import type { AnotarDemandaInput, AnotarDemandaResultado, DemandaPrevia, DemandaRepository } from '../../application/ports/demandaRepository'
import { toError } from './postgrestError'
import { supabase } from './supabaseClient'

const BUCKET = 'demanda_fotos'
const LADO_MAXIMO = 1280
const CALIDAD_INICIAL = 0.8
const CALIDAD_REINTENTO = 0.6
const MAX_BYTES = 1024 * 1024

interface PreviaRow { idea_id?: number | null; titulo?: string | null; estado?: DemandaPrevia['estado']; via?: DemandaPrevia['via']; veces_semana?: number | string | null; veces_total?: number | string | null }
interface AnotarRow extends PreviaRow { demanda_id: number | string }

const aPrevia = (row: PreviaRow | null): DemandaPrevia => ({
  ideaId: row?.idea_id ?? null,
  titulo: row?.titulo ?? null,
  estado: row?.estado ?? null,
  via: row?.via ?? null,
  vecesSemana: Number(row?.veces_semana ?? 0),
  vecesTotal: Number(row?.veces_total ?? 0),
})

interface ImagenCargada { fuente: CanvasImageSource; ancho: number; alto: number; liberar: () => void }

const cargarImagen = async (file: File): Promise<ImagenCargada> => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { fuente: bitmap, ancho: bitmap.width, alto: bitmap.height, liberar: () => bitmap.close() }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) })
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la foto.')) }
    img.src = url
  })
}

const aBlob = (canvas: HTMLCanvasElement, calidad: number): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la foto.'))), 'image/jpeg', calidad))

/** Lado mayor ≤ 1280 px, JPEG a calidad 0,8; si sigue pesando más de 1 MB, reintenta a 0,6. */
export const comprimirFoto = async (file: File): Promise<Blob> => {
  const { fuente, ancho, alto, liberar } = await cargarImagen(file)
  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(ancho * escala))
    canvas.height = Math.max(1, Math.round(alto * escala))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo comprimir la foto.')
    ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height)
    const primero = await aBlob(canvas, CALIDAD_INICIAL)
    return primero.size > MAX_BYTES ? aBlob(canvas, CALIDAD_REINTENTO) : primero
  } finally { liberar() }
}

export const demandaRepository: DemandaRepository = {
  async previa(productoId, descripcion) {
    const { data, error } = await supabase.rpc('demanda_previa', { p_producto_id: productoId, p_descripcion: descripcion })
    if (error) throw toError(error)
    return aPrevia(data as PreviaRow | null)
  },

  async anotar(input: AnotarDemandaInput): Promise<AnotarDemandaResultado> {
    const { data, error } = await supabase.rpc('anotar_demanda', {
      p_producto_id: input.productoId,
      p_descripcion: input.descripcion,
      p_canal: input.canal,
      p_cantidad_aprox: input.cantidadAprox,
      p_unidad: input.unidad,
      p_contacto_nombre: input.contactoNombre,
      p_contacto_tel: input.contactoTel,
      p_quiere_aviso: input.quiereAviso,
      p_foto_path: input.fotoPath,
    })
    if (error) throw toError(error)
    const row = data as AnotarRow
    return { demandaId: Number(row.demanda_id), ...aPrevia(row) }
  },

  async subirFoto(file) {
    const blob = await comprimirFoto(file)
    const { data: sesion, error: errorSesion } = await supabase.auth.getUser()
    if (errorSesion) throw toError(errorSesion)
    const uid = sesion.user?.id
    if (!uid) throw new Error('Sesión vencida. Vuelve a entrar.')
    const path = `${uid}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) throw toError(error)
    return path
  },
}
