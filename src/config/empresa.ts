import logoCation from '../assets/logo-cation.png'

// CATION SRL company letterhead FALLBACK data. This used to be the single source of
// truth consumed directly by DocumentoExportable/TicketPreviewModal/PosSidebar/
// LoginScreen; it is now only the fallback used until `empresaStore.loadEmpresaConfig()`
// resolves against `config_empresa` (or forever, if that fetch fails) — see
// src/config/empresaStore.ts. nit is intentionally blank in the fallback — the export
// component must not render the NIT line while it stays empty.
export const empresaFallback = {
  razonSocial: 'Cation y Asociados S.R.L',
  direccion: 'Calle Secure s/n entre 1 de Mayo e Ibare',
  ciudad: 'Trinidad · Beni · Bolivia',
  celular: '67986727',
  correo: 'cationtdd@gmail.com',
  nit: '',
  // Imported (not a literal path string) so Vite processes/hashes it through the build
  // pipeline — a bare '/src/...' string only worked by accident in dev. Not part of
  // config_empresa (that table has no logo column), so it always comes from here.
  logoSrc: logoCation,
}
