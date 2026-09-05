-- Convert config_empresa.sello_url / firma_url from full public URL to object path,
-- and lock down read access to `documentos-empresa` now that the bucket is going private.
-- Guarded so it is a no-op if already migrated/applied.

-- 1) Data migration: strip host + /object/(public|sign)/documentos-empresa/ + query string.
update config_empresa
   set sello_url = regexp_replace(
         split_part(sello_url, '?', 1),
         '^.*/object/(public|sign)/documentos-empresa/', ''),
       firma_url = regexp_replace(
         split_part(firma_url, '?', 1),
         '^.*/object/(public|sign)/documentos-empresa/', '')
 where id = 1
   and (sello_url like 'http%' or firma_url like 'http%');

-- 2) RLS on storage.objects: verified against the live schema that a SELECT policy
-- named `documentos_empresa_lectura` already exists for this bucket, but it grants
-- SELECT to {anon, authenticated} — with anon included, making the bucket private
-- would not actually stop unauthenticated reads via the Storage API (anon key is
-- public). Replace it with an authenticated-only policy; do not add one for anon.
drop policy if exists documentos_empresa_lectura on storage.objects;

create policy documentos_empresa_lectura_autenticada
  on storage.objects for select to authenticated
  using (bucket_id = 'documentos-empresa');
