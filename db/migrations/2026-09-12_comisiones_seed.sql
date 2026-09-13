-- Brief: Módulo de Comisiones, Fase 1 — seed de reglas.
-- 28 reglas INCLUIR al 1% (18 MARCA + 10 NOMBRE). Sin reglas EXCLUIR por ahora.
-- Aplicar DESPUÉS de 2026-09-12_comisiones.sql. Mismo aviso: la aplica Ness a mano.

insert into comision_regla (tipo, patron, accion, porcentaje, prioridad, nota, creado_por) values
  ('MARCA', 'ROARI',    'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'YALONG',   'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'DL',       'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'EPSON',    'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'DELI',     'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'DIGNO',    'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'DIAMOND',  'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'GIXIN',    'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'TUKI',     'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'ZUIXUA',   'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'BOIL',     'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  -- 'BIA' como substring matcheaba MARCADORES FABER CASTELL ... CAMBIA COLORES (marca
  -- MADEPA) por error — se retira ese uso y queda solo como marca exacta.
  ('MARCA', 'BIA',      'INCLUIR', 0.01, 100, 'Seed inicial — antes también matcheaba por substring en NOMBRE por error (ver brief)', 'migracion'),
  ('MARCA', 'UHU',      'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'PRINCO',   'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'NORMA',    'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'DOVE',     'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('MARCA', 'HUHUA',    'INCLUIR', 0.01, 100, 'Seed inicial — variante ortográfica "uhua" no se migra, ver brief', 'migracion'),
  ('MARCA', 'PEGABOL',  'INCLUIR', 0.01, 100, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  -- Categorías que comisionan sin importar la marca (prioridad más baja: una marca es
  -- una afirmación más fuerte que un substring de nombre, a igual prioridad numérica
  -- las MARCA se evalúan primero según la lógica de la app — ver 4 abajo).
  ('NOMBRE', 'clip',                 'INCLUIR', 0.01, 200, 'Seed inicial — incluye binder clip de cualquier marca', 'migracion'),
  ('NOMBRE', 'binder clip',          'INCLUIR', 0.01, 200, 'Seed inicial — redundante con "clip" pero explícito por claridad', 'migracion'),
  ('NOMBRE', 'pizarra',              'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', 'cinta de embalaje',    'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', 'goma eva',             'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', 'cartulina negra',      'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', 'silicona en barra',    'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', 'tinta epson',          'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', '544',                  'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion'),
  ('NOMBRE', '664',                  'INCLUIR', 0.01, 200, 'Seed inicial — migración desde roari-comisiones', 'migracion');

-- comision_vendedor: solo los perfiles cuyo comisionamiento es inequívoco según el
-- brief. Las 3 preguntas abiertas (cajaroari1tdd@gmail.com, juanmamanil331@gmail.com,
-- admin@cation.app) quedan afuera a propósito — Ness decide cargándolos o no. 'pos' no
-- resuelve a ningún perfil (es un valor sucio de creado_por, no un login) y por diseño
-- nunca genera fila de comisión.
insert into comision_vendedor (perfil_id, nota)
select id, 'Seed inicial — vendedor con comisión inequívoca según el brief'
from perfil
where email in ('roari.2023.bo@gmail.com', 'gabrieloni62@gmail.com', 'piterali.argana@gmail.com', 'nessxd14@gmail.com', 'mamanicristian865@gmail.com')
on conflict (perfil_id) do nothing;
