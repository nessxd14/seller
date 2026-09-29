-- Brief Caja-1 — nuevo valor de enum. ALTER TYPE ... ADD VALUE no puede correr dentro de
-- una transacción, así que vive en su propio archivo y se aplica ANTES que
-- 2026-09-27_caja_turno_cajero.sql (que sí usa 'EN_REVISION' en un CHECK/DEFAULT/comparación
-- y fallaría si el valor todavía no existe en el tipo).
--
-- Ness: aplicar este archivo solo (fuera de BEGIN…ROLLBACK) antes del archivo principal.

ALTER TYPE estado_sesion_caja ADD VALUE IF NOT EXISTS 'EN_REVISION';
