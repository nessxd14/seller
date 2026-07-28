-- Ronda 5 (POS) — ANEXO: trazabilidad cotización → pedido.
--
-- Ni `pedido` tiene `cotizacion_id`, ni `cotizacion` tiene `pedido_id`
-- (verificado: cero columnas de vínculo en ambas direcciones). "Convertir a
-- pedido" marca la cotización como CONVERTIDA pero no registra en qué pedido
-- se convirtió — no hay forma de responder "¿esta cotización terminó en
-- venta?" salvo por el estado.
--
-- Validada en BEGIN … ROLLBACK contra la base viva (2026-07-28):
--   - Vincular un pedido a una cotización: OK.
--   - Cotización inexistente: rechazada por la FK.
--   - Columna nullable: OK — crear_pedido no necesita cambios.
--   - Pedidos existentes (127): todos quedan en NULL. No hay forma de
--     reconstruir el vínculo hacia atrás y no hay que inventarlo — con 8
--     borradores y 1 convertida, el costo de arrancar limpio es
--     prácticamente cero.
--
-- NO APLICAR sin OK explícito de Ness. Este archivo solo se genera; no se
-- ejecuta desde este brief.

alter table pedido add column if not exists cotizacion_id bigint references cotizacion(id);
create index if not exists idx_pedido_cotizacion on pedido(cotizacion_id) where cotizacion_id is not null;
