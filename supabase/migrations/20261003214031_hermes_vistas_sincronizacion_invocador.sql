-- Conserva la comprobación de permisos y RLS del usuario que consulta las vistas.
-- La clasificación es un CASE constante: no exige ejecutar un ayudante privado.
create or replace view hermes.v_clientes_cation_pendientes
with (security_invoker=true) as
select c.id,c.nombre,c.razon_social,c.tipo_precio,
  (case c.tipo_precio
    when 'mayorista' then 'MAYORISTA'
    when 'institucion' then 'INSTITUCIONAL'
    when 'corporativo' then 'CORPORATIVO'
    else null end)::hermes.categoria_cliente as categoria_sugerida,
  c.documento,c.ciudad,c.creado_en
from hermes.cation_cliente c
where c.activo and c.tipo_precio in ('mayorista','institucion','corporativo')
  and not exists(select 1 from hermes.cliente h where h.pos_cliente_id=c.id);

alter view hermes.v_pedidos_cation_pendientes set (security_invoker=true);
notify pgrst,'reload schema';
