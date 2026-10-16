import '../src/styles.css'
import '../src/phase11.css'
import '../src/workflows.css'
import '../src/print.css'
import '../src/integration-readiness.css'
import '../src/pos-ajustes.css'
import '../src/pos-ajustes-r2.css'
import '../src/pos-ajustes-r3.css'
import '../src/pos-ajustes-r4.css'
import '../src/pos-select-skin.css'
import '../src/pos-resumen-carrito.css'
import '../src/pos-impresion.css'
import '../src/pos-mascara-nombres.css'
import '../src/pos-detalle-pedido.css'
import '../src/pos-borrador.css'
import '../src/styles/pos-modo-traslado.css'
import '../src/styles/pos-modo-venta-directa.css'
import '../src/styles/pos-venta-directa-bandeja.css'
import '../src/styles/pos-borradores-operacion.css'
import '../src/styles/pos-busqueda-fluida.css'
import '../src/styles/pos-detalle-rutas.css'
import '../src/styles/pos-traslados-bandeja.css'
import '../src/styles/pos-saldo-hermes.css'
import '../src/styles/pos-saldo-deudor.css'
import '../src/styles/pos-clientes-saldo.css'
import '../src/pos-carrito-tanda4.css'
import '../src/pos-editor-linea-modal.css'
import '../src/pos-cliente-duplicados.css'
import '../src/pos-numero-documentos.css'
import '../src/pos-reparto-pago.css'
import '../src/pos-pedidos-segmento.css'
import '../src/styles/pos-solicitante.css'
import '../src/styles/pos-documentos-diferenciados.css'
import '../src/pos-glassmorphism.css'
import '../src/styles/pos-caja-turno.css'
import '../src/styles/pos-caja-cobro-vtd.css'
import '../src/styles/pos-caja-cobro-obligatorio.css'
import '../src/pos-hotkeys.css'
import '../src/styles/pos-precios-producto.css'
import '../src/styles/commercial-forms.css'
import '../src/styles/management.css'
import '../src/styles/pos-cobro-unificado.css'
import '@fontsource-variable/manrope'
import '../src/styles/cash-workspace.css'
import '../src/styles/pos-piso.css'
import '../src/styles/pos-caja-pedido-vendedor.css'
import { createRoot } from 'react-dom/client'
import { DocumentoExportable, type ExportableDoc } from '../src/components/DocumentoExportable'
import { Modal } from '../src/components/Modal'
import { empresaStore } from '../src/config/empresaStore'
import { DOC_PRINT_FORMAT_STORAGE_KEY } from '../src/components/docPrintFormat'
import type { WorkflowLine } from '../src/application/shared/models'

// Arnés de regresión de impresión (solo desarrollo; no entra al build de producción).
// Query params: mode=cotizacion|pedido|nota-entrega, n=líneas, long=1 nombres largos,
// obs=1 observaciones, sig=1 firma+sello, nested=1 otro modal debajo, fmt=rollo-80.
const params = new URLSearchParams(location.search)
const mode = (params.get('mode') ?? 'cotizacion') as 'cotizacion' | 'pedido' | 'nota-entrega'
const n = Number(params.get('n') ?? 5)
const long = params.get('long') === '1'
const withObs = params.get('obs') === '1'

if (params.get('fmt') === 'rollo-80') localStorage.setItem(DOC_PRINT_FORMAT_STORAGE_KEY, 'rollo-80')
else localStorage.removeItem(DOC_PRINT_FORMAT_STORAGE_KEY)

const dataPng = (color: string, w: number, h: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color; ctx.fillRect(0, 0, w, h)
  return canvas.toDataURL('image/png')
}
if (params.get('sig') === '1') {
  // defineProperty para que loadEmpresaConfig() (que asigna al abrir el documento) no los pise.
  Object.defineProperty(empresaStore, 'firmaUrl', { value: dataPng('#1b3a8a', 300, 100), writable: false })
  Object.defineProperty(empresaStore, 'selloUrl', { value: dataPng('#8a1b1b', 200, 200), writable: false })
  Object.defineProperty(empresaStore, 'firmaNombre', { value: 'Gerente General', writable: false })
}

const lines: WorkflowLine[] = Array.from({ length: n }, (_, i) => ({
  id: `l${i}`, productId: `p${i}`, name: long ? `Producto de prueba número ${i + 1} con descripción larga que ocupa dos líneas en la tabla` : `Producto ${i + 1}`,
  sku: `SKU${i}`, quantity: 3 + (i % 7), unitPriceCents: 12_500 + i * 130, discountBasisPoints: i % 3 === 0 ? 500 : 0,
  sourceLocation: i % 2 ? 'Almacén' : 'Tienda',
}))
const doc: ExportableDoc = {
  number: 'DOC-2026-00123', customerName: 'Hospital Regional del Beni', channel: 'institucional', lines, orderId: 'ord-1',
  validUntil: '30/11/2026', conditionPago: 'CONTADO', medioPago: 'TRANSFERENCIA', createdAt: '2026-10-01T12:00:00Z', status: 'confirmed',
  terms: 'Precios sujetos a disponibilidad de stock. Entrega en 48 horas hábiles.',
  notes: withObs ? 'Entregar por la puerta lateral. Coordinar con almacén antes de las 10:00. Material frágil, manipular con cuidado.' : undefined,
}

createRoot(document.getElementById('root')!).render(
  <>
    {params.get('nested') === '1' && <Modal title="Otro modal" onClose={() => {}}><p>Modal de fondo</p></Modal>}
    <DocumentoExportable doc={doc} mode={mode} onClose={() => {}} />
  </>,
)
