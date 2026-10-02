-- El esquema auth pertenece a supabase_admin. El rol de migraciones administrado
-- no dispone de GRANT OPTION para dar USAGE a hermes_app.
-- Reutiliza exactamente la expresión de auth.jwt() sobre las claims de PostgREST.
-- Conserva firmas, propietarios, permisos y todas las validaciones de dominio.
do $$
declare f record; definicion text;
begin
 for f in
   select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='hermes' and p.proname in (
     'contexto_confiable','actualizar_credito_cliente','cargar_saldo_apertura',
     'confirmar_pago','registrar_nota_credito')
 loop
   definicion := replace(pg_get_functiondef(f.oid),'auth.jwt()',
     '(coalesce(nullif(current_setting(''request.jwt.claim'',true),''''),nullif(current_setting(''request.jwt.claims'',true),''''))::jsonb)');
   execute definicion;
 end loop;
end $$;
alter function hermes.contexto_confiable() set search_path=pg_catalog;
notify pgrst,'reload schema';
