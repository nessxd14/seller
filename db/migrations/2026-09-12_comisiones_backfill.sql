-- Brief: Módulo de Comisiones, Fase 1 — backfill histórico desde 2026-08-01.
-- Aplicar DESPUÉS de 2026-09-12_comisiones.sql y 2026-09-12_comisiones_seed.sql.
--
-- NO CORRER hasta resolver con Ness quién es 'pos' (2 pedidos completados, Bs 760 de
-- base comisionable) — ver brief, pregunta abierta 1. Sin alias para 'pos' en
-- comision_creado_por_alias, esos 2 pedidos simplemente no generan devengo (no se
-- inventa un dueño), así que correr esto sin resolver la pregunta no rompe nada, pero
-- deja esa plata sin asignar hasta que se decida.
--
-- comision_registrar_pedido/venta son las mismas funciones que disparan los triggers
-- comision_pedido_completado / comision_venta_completada — este backfill solo las llama
-- a mano sobre lo que ya estaba COMPLETADO/COMPLETADA antes de que existieran los
-- triggers. Son idempotentes (no reescriben una fila que ya existe), así que correr
-- este script más de una vez es seguro.

select comision_registrar_pedido(id)
from pedido
where estado = 'COMPLETADO' and categoria <> 'TIENDA' and creado_en >= '2026-08-01';

select comision_registrar_venta(id)
from venta
where estado = 'COMPLETADA' and ubicacion_id = 31 and creado_en >= '2026-08-01';

-- Verificación (criterio de aceptación: total ≈ Bs 2.028, con las 4 preguntas abiertas
-- sin resolver el número real será algo distinto — cajaroari1tdd@gmail.com y
-- juanmamanil331@gmail.com solo generan fila si Ness los carga en comision_vendedor).
select vendedor_email, origen, count(*) as documentos, sum(base_comisionable) as base, sum(monto) as comision
from comision_devengo
group by vendedor_email, origen
order by vendedor_email, origen;
