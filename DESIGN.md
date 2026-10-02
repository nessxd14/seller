---
name: Cation Caja
description: Azul Claro y Glassmorphism para caja y supervisión móvil
colors:
  primary: "#2563eb"
  ink: "#142033"
  muted: "#526279"
  line: "#dce5f1"
  page: "#f3f6fa"
  surface: "#ffffff"
  summary: "#14243c"
  on-primary: "#ffffff"
typography:
  headline:
    fontFamily: "Manrope Variable, DM Sans, sans-serif"
    fontSize: "32px"
    letterSpacing: "-.035em"
  title:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "18px"
    letterSpacing: "-.02em"
  body:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  label:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
rounded:
  control: "10px"
  primary: "12px"
  panel: "20px"
  opening: "20px"
spacing:
  compact: "8px"
  control: "12px"
  row: "18px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.primary}"
    padding: "12px 20px"
    height: "48px"
  panel:
    backgroundColor: "rgba(255,255,255,.78)"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Cation Caja

## Overview

Diseño compartido por Caja remota y la vista Caja de Seller. El usuario eligió el concepto **Azul Claro** y solicitó Glassmorphism el 2 de octubre de 2026. Se implementa en `src/styles/cash-workspace.css` y `src/features/cash`; el logo Cation conserva su identidad.

**Creative North Star: "Caja clara, siempre a mano"**

Vidrio blanco sobre un fondo azul suave, navegación cobalto y un resumen azul marino para reconocer el turno y sus importes. Cada movimiento conserva su detalle completo.

**Key Characteristics:**

- Totales visibles y desglose por método desplegable mediante teclado o toque.
- Vidrio moderado, bordes blancos y sombra suave.
- Navegación fija y controles de al menos 44 px en móvil.

## Colors

Cobalto `#2563eb` para las acciones; azul marino `#142033` para texto. Fondo frío `#f3f6fa` con manchas azules estáticas. Paneles blancos al 78% y desenfoque de 16 px. El resumen principal usa un degradado marino de `#173760f2` a `#14243cf7`, texto blanco y subtítulos claros. Estados y errores mantienen texto explícito.

## Typography

Manrope Variable se sirve desde el bundle local. Los nombres de cliente mantienen mayúsculas originales y varias líneas. Importes con cifras tabulares y sin animación. Campos de 16 px, incluidos los formularios que se montan en un portal.

## Layout

Contenedor remoto máximo de 1120 px. En escritorio, identificación del turno y desglose comparten una fila; debajo de 700 px se apilan. Actividad y tickets ocupan todo el ancho. El resumen tiene cuatro filas: Mostrador, VTD, pagos/anticipos y gastos; remesas e inyecciones conservan sus propios importes.

La apertura presenta introducción y conteo en escritorio. Por debajo de 1000 px se apilan; por debajo de 600 px, billetes y monedas se cuentan en una columna y el fondo con su acción permanece junto al borde inferior durante el desplazamiento. Todos los valores siguen siendo editables.

Cabecera remota fija de 76 px más área segura. Navegación de supervisión fija a 84 px más área segura. La vista del cajero evita una navegación con una sola opción. Las listas admiten desplazamiento vertical completo, sin desbordamiento horizontal en 360 y 390 px.

## Elevation & Depth

Paneles con `0 8px 32px rgba(39,72,121,.06)` y luz interior blanca. Vidrio en paneles y navegación; campos de entrada blancos. Evitar apilar filtros de fondo en paneles anidados. El cierre y los movimientos usan `.cash-dialog` para que el portal tenga el mismo diseño. Fondo sólido cuando el navegador no admite el filtro o se solicita menos transparencia.

## Shapes

Paneles de 20 px, diálogos de 22 px y botones principales de 12 px. Filas separadas por líneas finas. El importe permanece alineado y sin partirse; el nombre y detalle del movimiento pueden crecer.

## Components

Acciones principales de 48 px, secundarias de al menos 44 px. Foco visible de 3 px con separación de 3 px. Navegación activa cobalto con `aria-current`. Desgloses con `details` y `summary` nativos; métodos y nota se despliegan mediante Enter o toque. El filtro sin resultados ofrece volver a todos los movimientos.

Apertura, cierre y declaración bloquean los campos mientras guardan. Gastos conservan importe, detalle obligatorio, comprobante opcional e idempotencia. Conteo de cierre ciego; efectivo esperado visible solo para supervisión. VTD por cobrar permanece informativa fuera del arqueo.

Transiciones de color de 140 ms, sin animar importes ni la llegada de datos. Hover solo para punteros precisos. `prefers-reduced-motion` elimina transiciones y animaciones; `prefers-reduced-transparency` elimina el vidrio.

## Do's and Don'ts

### Do:

- Conservar detalles del gasto, cliente y turno junto a cada movimiento.
- Dejar los totales visibles y explicar los métodos al desplegar.
- Respetar foco, áreas seguras y controles táctiles.

### Don't:

- Aplicar transparencia a los caracteres o animar cifras.
- Mostrar efectivo esperado al cajero o alterar el conteo ciego.
- Cambiar el flujo de VTD o los contratos financieros por un cambio visual.
