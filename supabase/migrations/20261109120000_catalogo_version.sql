-- Versión del catálogo: contador que sube cada vez que cambia algo que el Seller guarda en memoria.
--
-- El Seller carga el catálogo activo (producto, presentación, identificador, familia) una vez y lo
-- responde desde memoria. Como los precios se editan en Almacén, un Seller abierto necesita saber
-- que el catálogo cambió. `presentacion` e `identificador` no tienen marca de tiempo, así que se
-- agrega un contador: public.catalogo_version() lo devuelve y el frontend recarga si cambió.
--
--   public.catalogo_version                  una sola fila (id = true), RLS sin políticas
--   public.trg_catalogo_version_bump()       sube version y actualizado_en (una vez por sentencia)
--   public.catalogo_version()                lee la versión (STABLE, SECURITY DEFINER)
--
-- Disparadores por sentencia en presentacion, identificador, familia y producto. En producto solo
-- INSERT/DELETE y los UPDATE de columnas que el Seller muestra o usa para buscar/cobrar: editar
-- ficha_md, stock_min y similares no sube la versión.
--
-- Requisitos: ninguno. Sin esta migración el frontend funciona igual (recarga por edad, 15 min).
-- Estado: NO aplicada. Correr el ENSAYO (BEGIN…ROLLBACK) y revisar «ENSAYO OK» antes de aplicar.

CREATE TABLE IF NOT EXISTS public.catalogo_version (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version bigint NOT NULL DEFAULT 1,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.catalogo_version (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.catalogo_version ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_version FROM anon, public;

CREATE OR REPLACE FUNCTION public.trg_catalogo_version_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  update public.catalogo_version set version = version + 1, actualizado_en = now() where id;
  return null;
end
$function$;
REVOKE ALL ON FUNCTION public.trg_catalogo_version_bump() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.trg_catalogo_version_bump() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catalogo_version()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select version from public.catalogo_version where id
$function$;
REVOKE ALL ON FUNCTION public.catalogo_version() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.catalogo_version() TO authenticated, service_role;

DROP TRIGGER IF EXISTS catalogo_version_bump ON public.presentacion;
CREATE TRIGGER catalogo_version_bump AFTER INSERT OR UPDATE OR DELETE ON public.presentacion
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_catalogo_version_bump();
DROP TRIGGER IF EXISTS catalogo_version_bump ON public.identificador;
CREATE TRIGGER catalogo_version_bump AFTER INSERT OR UPDATE OR DELETE ON public.identificador
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_catalogo_version_bump();
DROP TRIGGER IF EXISTS catalogo_version_bump ON public.familia;
CREATE TRIGGER catalogo_version_bump AFTER INSERT OR UPDATE OR DELETE ON public.familia
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_catalogo_version_bump();

DROP TRIGGER IF EXISTS catalogo_version_bump_alta_baja ON public.producto;
CREATE TRIGGER catalogo_version_bump_alta_baja AFTER INSERT OR DELETE ON public.producto
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_catalogo_version_bump();
DROP TRIGGER IF EXISTS catalogo_version_bump_cambio ON public.producto;
CREATE TRIGGER catalogo_version_bump_cambio
  AFTER UPDATE OF nombre, sku_interno, marca, unidad_base, precio_base, precio_mayoreo, precio_institucion,
                  precio_corporativo, activo, imagen_url, familia_id
  ON public.producto
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_catalogo_version_bump();
