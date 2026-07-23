import type { Product } from '../types'
import { moneyToDecimal } from '../domain/common/money'
import { resolveMockChannelPrice } from '../domain/pricing/priceResolver'

export const categories = ['Todos', 'Frecuentes', 'Escritura', 'Cuadernos', 'Papelería', 'Oficina', 'Papel', 'Archivo', 'Manualidades', 'Escolar']

export const products: Product[] = [
  { id: 1, sku: 'CUA-TUK-050', codigoBarra: '777100100001', codigoFabrica: 'TK-50R', nombre: 'Cuaderno TUKI 50 hojas', descripcion: 'Rayado · Tapa flexible', categoria: 'Cuadernos', imagen: 'cuaderno', color: '#ff7a45', precioRetail: 18.5, precioMayoreo: 16.2, precioInstitucional: 15.8, stockTienda: 42, stockAlmacen: 180 },
  { id: 2, sku: 'ARC-PAL-AZ', codigoBarra: '777100100002', codigoFabrica: 'AP-A4-75', nombre: 'Archivador Palanca', descripcion: 'Tamaño A4 · Lomo 75 mm', categoria: 'Archivo', imagen: 'archivador', color: '#efad32', precioRetail: 36, precioMayoreo: 32, precioInstitucional: 30.5, stockTienda: 18, stockAlmacen: 64 },
  { id: 3, sku: 'BOL-05-AZ', codigoBarra: '777100100003', codigoFabrica: 'BP05-BL', nombre: 'Bolígrafo 0.5 mm', descripcion: 'Tinta azul · Punta fina', categoria: 'Escritura', imagen: 'boligrafo', color: '#4d75b8', precioRetail: 4.5, precioMayoreo: 3.5, precioInstitucional: 3.2, stockTienda: 96, stockAlmacen: 450 },
  { id: 4, sku: 'RES-BON-C75', codigoBarra: '777100100004', codigoFabrica: 'BOND-C-75', nombre: 'Resma Bond Carta', descripcion: '500 hojas · 75 g/m²', categoria: 'Papel', imagen: 'resma', color: '#87b8d4', precioRetail: 58, precioMayoreo: 53.5, precioInstitucional: 51, stockTienda: 27, stockAlmacen: 102 },
  { id: 5, sku: 'SIL-LIQ-250', codigoBarra: '777100100005', codigoFabrica: 'SL-250', nombre: 'Silicona Líquida 250 ml', descripcion: 'Transparente · Uso escolar', categoria: 'Manualidades', imagen: 'silicona', color: '#8bc6b0', precioRetail: 21, precioMayoreo: 18.5, precioInstitucional: 17.8, stockTienda: 31, stockAlmacen: 78 },
  { id: 6, sku: 'EVA-A4-SUR', codigoBarra: '777100100006', codigoFabrica: 'EVA-A4', nombre: 'Goma Eva', descripcion: 'Formato A4 · Colores surtidos', categoria: 'Manualidades', imagen: 'goma', color: '#d07bb4', precioRetail: 7, precioMayoreo: 5.5, precioInstitucional: 5, stockTienda: 84, stockAlmacen: 210 },
  { id: 7, sku: 'GRA-246-NEG', codigoBarra: '777100100007', codigoFabrica: 'ST-246', nombre: 'Grapadora 24/6', descripcion: 'Metálica · Capacidad 20 hojas', categoria: 'Oficina', imagen: 'grapadora', color: '#585b63', precioRetail: 42, precioMayoreo: 37.5, precioInstitucional: 36, stockTienda: 14, stockAlmacen: 38 },
  { id: 8, sku: 'SET-GEO-4P', codigoBarra: '777100100008', codigoFabrica: 'SG-4', nombre: 'Set Geométrico', descripcion: '4 piezas · Estuche incluido', categoria: 'Escolar', imagen: 'geometria', color: '#f0a943', precioRetail: 24, precioMayoreo: 21, precioInstitucional: 19.5, stockTienda: 36, stockAlmacen: 92 },
]

export const getPrice = (product: Product, channel: 'retail' | 'mayoreo' | 'institucional') =>
  moneyToDecimal(resolveMockChannelPrice(channel, {
    retailCents: Math.round(product.precioRetail * 100),
    wholesaleCents: Math.round(product.precioMayoreo * 100),
    institutionalCents: Math.round(product.precioInstitucional * 100),
  }))
