import logoCation from '../assets/logo-cation.png'

// CATION SRL company letterhead data, used by DocumentoExportable's print header.
// nit is intentionally blank — the export component must not render the NIT line
// while this stays empty.
export const empresa = {
  razonSocial: 'Comercializadora Cation SRL',
  direccion: 'Calle Secure s/n entre 1 de Mayo e Ibare',
  ciudad: 'Trinidad · Beni · Bolivia',
  celular: '67986727',
  correo: 'cationtdd@gmail.com',
  nit: '',
  // Imported (not a literal path string) so Vite processes/hashes it through the build
  // pipeline — a bare '/src/...' string only worked by accident in dev.
  logoSrc: logoCation,
}
