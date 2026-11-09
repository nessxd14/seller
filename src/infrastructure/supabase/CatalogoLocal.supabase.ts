import { supabase } from './supabaseClient'
import { leerTodo } from './paginacion'
import { PRODUCT_COLUMNS } from './productoColumnas'
import { construirIndice, type FilaIdentificador, type FilaPresentacionCatalogo, type IndiceCatalogo } from '../../domain/catalog/catalogoLocal'
import type { ProductoRow } from '../../domain/catalog/mapeoProducto'

// Catálogo activo en memoria (≈1.660 productos, 2.740 presentaciones, 2.300 identificadores).
// Se carga una vez por sesión y responde búsqueda, presentaciones, identificadores y códigos
// sin ida y vuelta a la red. Stock, reservas y precios sugeridos NO pasan por acá.
// Si no está cargado o falla, el repositorio sigue usando la red como siempre.

export const REINTENTO_CARGA_MS = 60_000
export const VENTANA_REFRESCO_MS = 30_000
export const EDAD_MAXIMA_SIN_VERSION_MS = 15 * 60_000
const CODIGO_FUNCION_INEXISTENTE = 'PGRST202'

const PRESENTACION_COLUMNS = 'presentacion_id,producto_id,nombre,factor_unidad_base,es_base,activo,precio_retail,precio_mayoreo,precio_institucion,precio_corporativo,tiene_precio_propio,vende_tienda,vende_almacen'

/** `null` = no se pudo leer (función inexistente u otro error): la carga sigue sin versión. */
const leerVersion = async (): Promise<number | null> => {
  const { data, error } = await supabase.rpc('catalogo_version')
  if (error || data == null) return null
  return Number(data)
}

const hayUsuarioAutenticado = async (): Promise<boolean> => {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}

class CatalogoLocal {
  private indiceActual: IndiceCatalogo | null = null
  private enCurso: Promise<void> | null = null
  private versionCargada: number | null = null
  private cargadoEn = 0
  private ultimoFallo = Number.NEGATIVE_INFINITY
  private ultimoRefresco = Number.NEGATIVE_INFINITY
  /** Cambia en cada invalidar(): una carga que termina después de cerrar sesión no instala nada. */
  private generacion = 0

  listo(): boolean {
    return this.indiceActual !== null
  }

  indice(): IndiceCatalogo | null {
    return this.indiceActual
  }

  /** Carga una vez; los llamadores concurrentes comparten la misma promesa. Nunca rechaza. */
  asegurarCarga(): Promise<void> {
    if (this.indiceActual) return Promise.resolve()
    if (this.enCurso) return this.enCurso
    if (Date.now() - this.ultimoFallo < REINTENTO_CARGA_MS) return Promise.resolve()
    return this.iniciarCarga()
  }

  async refrescarSiCambio(): Promise<void> {
    if (!this.indiceActual) return this.asegurarCarga()
    if (this.enCurso) return
    const ahora = Date.now()
    if (ahora - this.ultimoRefresco < VENTANA_REFRESCO_MS) return
    this.ultimoRefresco = ahora
    const generacion = this.generacion
    try {
      const { data, error } = await supabase.rpc('catalogo_version')
      if (generacion !== this.generacion || this.enCurso) return
      if (error) {
        // Sin la migración la función no existe: se refresca por edad, sin tratarlo como error.
        if ((error as { code?: string }).code === CODIGO_FUNCION_INEXISTENTE && Date.now() - this.cargadoEn > EDAD_MAXIMA_SIN_VERSION_MS) await this.iniciarCarga()
        return
      }
      if (data != null && Number(data) !== this.versionCargada) await this.iniciarCarga()
    } catch {
      // Cualquier otro error: se conserva el índice actual y se reintenta en el próximo disparo.
    }
  }

  invalidar(): void {
    this.generacion += 1
    this.indiceActual = null
    this.enCurso = null
    this.versionCargada = null
    this.cargadoEn = 0
    this.ultimoFallo = Number.NEGATIVE_INFINITY
    this.ultimoRefresco = Number.NEGATIVE_INFINITY
  }

  private iniciarCarga(): Promise<void> {
    const generacion = this.generacion
    const promesa = this.cargar(generacion).finally(() => {
      if (this.enCurso === promesa) this.enCurso = null
    })
    this.enCurso = promesa
    return promesa
  }

  private async cargar(generacion: number): Promise<void> {
    try {
      // RLS: sin sesión las lecturas volverían vacías y el índice quedaría mudo. No cuenta como fallo.
      if (!(await hayUsuarioAutenticado())) return
      // La versión se registra antes de leer: si cambia durante la carga, el próximo refresco recarga.
      const [version, productos, presentaciones, identificadores] = await Promise.all([
        leerVersion().catch(() => null),
        leerTodo<ProductoRow>((desde, hasta) => supabase.from('producto').select(PRODUCT_COLUMNS).eq('activo', true).order('id', { ascending: true }).range(desde, hasta) as unknown as PromiseLike<{ data: ProductoRow[] | null; error: unknown }>),
        leerTodo<FilaPresentacionCatalogo>((desde, hasta) => supabase.from('v_presentacion_precio').select(PRESENTACION_COLUMNS).order('presentacion_id', { ascending: true }).range(desde, hasta) as unknown as PromiseLike<{ data: FilaPresentacionCatalogo[] | null; error: unknown }>),
        leerTodo<FilaIdentificador>((desde, hasta) => supabase.from('identificador').select('id,presentacion_id,tipo,valor,es_principal').eq('activo', true).order('id', { ascending: true }).range(desde, hasta) as unknown as PromiseLike<{ data: FilaIdentificador[] | null; error: unknown }>),
      ])
      if (generacion !== this.generacion) return
      // Un solo intercambio: las búsquedas en curso siguen con el índice anterior.
      this.indiceActual = construirIndice({ productos, presentaciones, identificadores })
      this.versionCargada = version
      this.cargadoEn = Date.now()
    } catch {
      // El índice anterior (o null) se conserva y todo sigue por la red; se reintenta tras un minuto.
      if (generacion === this.generacion) this.ultimoFallo = Date.now()
    }
  }
}

export const catalogoLocal = new CatalogoLocal()
