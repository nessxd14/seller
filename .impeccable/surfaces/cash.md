# Caja compartida

Mode: Operate

Scope: `src/features/cash`, `src/styles/cash-workspace.css`, conteo por denominaciones y app remota `caja-cation/src/App.jsx`.

Authority: petición explícita de rediseñar caja para móvil. El 2 de octubre de 2026 el usuario eligió Azul Claro entre los conceptos generados y pidió Glassmorphism y mejorar UI/UX. Logo Cation existente.

Primary job: identificar qué cobró cada cajero y declarar movimientos con detalle.

First viewport: identificación del turno, actualización y totales. Métodos desplegables. Histórico y revisiones en navegación fija de supervisión.

Form: apertura compacta por denominaciones, total y acción a mano; gastos con importe y detalle; cierre ciego. Campos bloqueados mientras se guarda. Consulta remota del histórico en lectura.

Validation: Chromium escritorio 1440 px y móviles 360/390 px; sin desbordamiento, navegación fija, teclado en desplegables, filtro vacío, conteo de monedas, foco al cerrar diálogo, conservación de detalle y reintentos idempotentes. HTTP interceptado con datos sintéticos. Pendiente prueba física en el teléfono del usuario.
