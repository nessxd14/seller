-- hermes_app es un rol interno NOLOGIN que ya ejecuta las funciones de dominio.
-- Sus comprobaciones usan auth.uid()/auth.jwt(); USAGE permite resolver esas
-- funciones existentes. No concede lectura de auth.users ni de otras tablas.
grant usage on schema auth to hermes_app;
-- La función que valida perfil activo y acceso a Hermes pertenece a postgres.
-- Las funciones de dominio necesitan poder llamarla bajo su propietario interno.
grant execute on function hermes.rol_actual() to hermes_app;
