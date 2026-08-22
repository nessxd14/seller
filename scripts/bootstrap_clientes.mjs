#!/usr/bin/env node
// =====================================================================
//  POS — BOOTSTRAP DE CLIENTES DESDE SHOPIFY
//
//  Qué hace:
//    1. Obtiene token shpat_ vía OAuth client_credentials (igual que
//       bootstrap_catalogo.mjs, del repo WMS almacen_cation).
//    2. Baja TODOS los clientes de Shopify (GraphQL, paginado).
//    3. Transforma cada cliente Shopify -> una fila `cliente`:
//         - nombre        <- `${firstName} ${lastName}`.trim(), o si no hay
//                            nombre de persona, defaultAddress.company; si
//                            tampoco hay company, se usa el email como
//                            último recurso (o se marca "sin-nombre-utilizable"
//                            en el reporte y se omite si ni siquiera hay email).
//         - razon_social  <- defaultAddress.company, SOLO cuando difiere del
//                            nombre (es decir, solo si `nombre` vino de un
//                            nombre de persona real Y además existe una
//                            empresa separada — si `nombre` ya se llenó DESDE
//                            company, no se duplica en razon_social).
//         - email/telefono/direccion/ciudad <- directo de Shopify (telefono
//                            cae a defaultAddress.phone si el cliente no
//                            tiene phone propio).
//         - documento     <- siempre NULL (sin equivalente en Shopify).
//         - tipo_precio   <- siempre 'mayorista' (sin clasificación por tag,
//                            decisión confirmada explícitamente).
//         - origen        <- siempre 'shopify'.
//         - activo        <- siempre TRUE.
//    4. Inserta en Postgres en UNA transacción, idempotente vía
//       ON CONFLICT (shopify_customer_id) — índice único parcial
//       `uq_cliente_shopify` (WHERE shopify_customer_id IS NOT NULL),
//       verificado en vivo antes de escribir este script. tipo_precio queda
//       DELIBERADAMENTE fuera del DO UPDATE SET: se siembra solo en el
//       INSERT inicial, así una reclasificación manual a institucion/
//       corporativo hecha en el POS sobrevive a cada re-corrida de este
//       script (mismo patrón que bootstrap_catalogo.mjs usa con `marca`).
//    5. Imprime un reporte: creados, actualizados, sin-email, sin-teléfono,
//       sin-nombre-utilizable.
//
//  Requisitos:
//    - Node 18+ (usa fetch nativo)
//    - npm i pg  (ya agregado como devDependency de este repo)
//    - Variables de entorno (.env cargado por tu shell o --env-file):
//        SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN
//        SHOPIFY_API_VERSION   (default 2026-01; lectura)
//        DATABASE_URL          (ej: postgresql://postgres:postgres@127.0.0.1:54322/postgres)
//
//  Uso:
//    node --env-file=.env scripts/bootstrap_clientes.mjs            # ejecuta
//    node --env-file=.env scripts/bootstrap_clientes.mjs --dry-run  # NO escribe BD
//
//  Nota: este script se corre localmente, a mano, por quien tenga las
//  credenciales de Shopify y acceso directo a la base — no forma parte del
//  runtime de la app POS (por eso usa `pg` directo y no @supabase/supabase-js).
// =====================================================================

import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

const {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_API_VERSION = '2026-01',
  DATABASE_URL,
} = process.env;

function requireEnv() {
  const faltan = [];
  if (!SHOPIFY_CLIENT_ID) faltan.push('SHOPIFY_CLIENT_ID');
  if (!SHOPIFY_CLIENT_SECRET) faltan.push('SHOPIFY_CLIENT_SECRET');
  if (!SHOPIFY_STORE_DOMAIN) faltan.push('SHOPIFY_STORE_DOMAIN');
  if (!DRY_RUN && !DATABASE_URL) faltan.push('DATABASE_URL');
  if (faltan.length) {
    console.error('ERROR: faltan variables de entorno:', faltan.join(', '));
    process.exit(1);
  }
}

// GID "gid://shopify/Customer/123" -> "123" (idéntico a bootstrap_catalogo.mjs).
function idNumerico(gid) {
  if (!gid) return null;
  const m = String(gid).match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
//  SHOPIFY: token + pull paginado (boilerplate compartido con bootstrap_catalogo.mjs)
// ---------------------------------------------------------------------

async function obtenerToken() {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SHOPIFY_CLIENT_ID,
    client_secret: SHOPIFY_CLIENT_SECRET,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`OAuth falló: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('OAuth: sin access_token en la respuesta');
  return json.access_token;
}

const QUERY = `
query($cursor: String) {
  customers(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        firstName
        lastName
        email
        phone
        defaultAddress {
          company
          address1
          address2
          city
          phone
        }
      }
    }
  }
}`;

async function pullClientes(token) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const clientes = [];
  let cursor = null;
  let pagina = 0;

  while (true) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    });
    const json = await res.json();

    if (json.errors) {
      // Manejo básico de throttling: si nos limitan, esperamos y reintentamos.
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        console.warn('  (throttled, esperando 2s y reintentando…)');
        await sleep(2000);
        continue;
      }
      throw new Error('GraphQL error: ' + JSON.stringify(json.errors));
    }

    const data = json.data.customers;
    for (const edge of data.edges) clientes.push(edge.node);
    pagina++;
    process.stdout.write(`\r  Página ${pagina} — ${clientes.length} clientes…`);

    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
    await sleep(500); // cortesía con el rate limit
  }
  process.stdout.write('\n');
  return clientes;
}

// ---------------------------------------------------------------------
//  TRANSFORMACIÓN: API -> filas a insertar
// ---------------------------------------------------------------------

function joinDireccion(address1, address2) {
  return [address1, address2].filter((part) => part && String(part).trim() !== '').join(' ').trim();
}

function transformar(clientes) {
  const rep = {
    creados: 0, // completado luego de cargar() (xmax=0 por fila)
    actualizados: 0,
    sinEmail: 0,
    sinTelefono: 0,
    sinNombreUtilizable: 0,
    omitidos: 0,
  };

  const filas = [];
  for (const c of clientes) {
    const nombrePersona = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    const company = c.defaultAddress?.company?.trim() || null;

    let nombre;
    let razonSocial = null;
    if (nombrePersona) {
      nombre = nombrePersona;
      // razon_social solo cuando hay una empresa distinta del nombre de persona.
      if (company) razonSocial = company;
    } else if (company) {
      // Sin nombre de persona: el nombre del cliente ES la empresa — no duplicar
      // el mismo string en razon_social.
      nombre = company;
    } else if (c.email) {
      nombre = c.email;
    } else {
      // Sin nombre de persona, sin empresa, sin email: no hay ningún dato usable
      // como nombre — se omite el registro en vez de insertar una fila vacía.
      rep.sinNombreUtilizable++;
      rep.omitidos++;
      continue;
    }

    const telefono = c.phone || c.defaultAddress?.phone || null;
    const direccion = joinDireccion(c.defaultAddress?.address1, c.defaultAddress?.address2) || null;
    const ciudad = c.defaultAddress?.city || null;

    if (!c.email) rep.sinEmail++;
    if (!telefono) rep.sinTelefono++;

    filas.push({
      shopify_customer_id: idNumerico(c.id),
      nombre: nombre.slice(0, 250),
      razon_social: razonSocial ? razonSocial.slice(0, 250) : null,
      email: c.email || null,
      telefono,
      direccion,
      ciudad,
    });
  }
  return { filas, rep };
}

// ---------------------------------------------------------------------
//  CARGA EN POSTGRES (transaccional, idempotente)
// ---------------------------------------------------------------------

async function cargar(filas, rep) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    for (const fila of filas) {
      // ON CONFLICT con índice único parcial (uq_cliente_shopify, WHERE
      // shopify_customer_id IS NOT NULL) requiere la cláusula WHERE explícita,
      // igual que bootstrap_catalogo.mjs con shopify_variant_id/shopify_product_id.
      // tipo_precio va en el INSERT pero NO en el DO UPDATE SET: se siembra solo
      // al crear el cliente y nunca pisa una reclasificación manual posterior.
      const r = await client.query(
        `INSERT INTO cliente
           (nombre, razon_social, tipo_precio, documento, telefono, email, direccion, ciudad,
            shopify_customer_id, origen, activo)
         VALUES ($1,$2,'mayorista',NULL,$3,$4,$5,$6,$7,'shopify',TRUE)
         ON CONFLICT (shopify_customer_id) WHERE shopify_customer_id IS NOT NULL
         DO UPDATE
           SET nombre = EXCLUDED.nombre,
               razon_social = EXCLUDED.razon_social,
               telefono = EXCLUDED.telefono,
               email = EXCLUDED.email,
               direccion = EXCLUDED.direccion,
               ciudad = EXCLUDED.ciudad,
               actualizado_en = now()
         RETURNING (xmax = 0) AS insertado`,
        [fila.nombre, fila.razon_social, fila.telefono, fila.email, fila.direccion, fila.ciudad, fila.shopify_customer_id]);

      if (r.rows[0].insertado) rep.creados++;
      else rep.actualizados++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------
//  MAIN
// ---------------------------------------------------------------------

function imprimirReporte(rep) {
  console.log('\n========== REPORTE DE BOOTSTRAP DE CLIENTES ==========');
  console.log(`  Creados:                     ${rep.creados}`);
  console.log(`  Actualizados:                ${rep.actualizados}`);
  console.log('  ---- a revisar manualmente ----');
  console.log(`  Sin email:                   ${rep.sinEmail}`);
  console.log(`  Sin teléfono:                ${rep.sinTelefono}`);
  console.log(`  Sin nombre utilizable (omitidos): ${rep.sinNombreUtilizable}`);
  console.log('========================================================\n');
}

async function main() {
  requireEnv();
  console.log(`Tienda: ${SHOPIFY_STORE_DOMAIN}  ·  API ${SHOPIFY_API_VERSION}  ${DRY_RUN ? '· DRY-RUN' : ''}`);

  console.log('1) Obteniendo token…');
  const token = await obtenerToken();

  console.log('2) Bajando clientes de Shopify…');
  const clientes = await pullClientes(token);

  console.log('3) Transformando…');
  const { filas, rep } = transformar(clientes);

  if (DRY_RUN) {
    imprimirReporte(rep);
    console.log('DRY-RUN: no se escribió nada en la base de datos.');
    return;
  }

  console.log('4) Cargando en Postgres (transacción única)…');
  await cargar(filas, rep);
  imprimirReporte(rep);
  console.log('✓ Listo. Clientes sembrados.');
}

main().catch((err) => {
  console.error('\n✗ FALLÓ:', err.message);
  process.exit(1);
});
