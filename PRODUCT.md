# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El cajero registra ventas, pagos de clientes, anticipos y gastos en su turno. El responsable del negocio consulta desde el celular qué vendieron los cajeros y revisa caja.

## Product Purpose

Conectar Seller, caja-roari y el conciliador actual para probar la llegada de pagos y supervisar el desglose de cada turno.

## Operating Context

Pruebas locales en `pos-cation`, `caja-cation` y `conciliador`. La app de Caja comparte módulos con Seller; ambos usan Cation. El conciliador gestiona la cartera en el esquema Hermes.

## Capabilities and Constraints

Los gastos requieren detalle al declararlos. Las ventas, pagos y anticipos deben figurar en el turno de quien cobró. La recepción del pago y la confirmación contable son pasos diferentes. El cajero conserva el conteo ciego de cierre existente.

La revisión local no incluye publicación ni traslado automático de histórico Firebase. El acceso desde Internet es una decisión pendiente de despliegue.

## Brand Commitments

Nombre y logo existentes de Cation. El usuario pidió tomar en cuenta Impeccable y las guías de Emil Kowalski para rediseñar Caja.

El 2 de octubre de 2026 eligió Azul Claro entre las propuestas visuales y pidió aplicar Glassmorphism, mejorando UI y UX en Caja.

## Evidence on Hand

Solicitud del usuario del 2 de octubre de 2026; repositorio Seller y conciliador actual; ZIP original de caja-roari conservado en `caja-cation/src/LegacyApp.jsx`; migraciones de turno existentes; capturas sintéticas de escritorio y móvil en `.ui-review.local`.
