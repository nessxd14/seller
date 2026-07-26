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
  // TODO: drop the real CATION SRL logo PNG at this path (src/assets/cation-logo.png).
  // No image was provided for this brief — DocumentoExportable's header collapses the
  // <img> gracefully via onError when the file is missing, so nothing looks broken in
  // the meantime, but the letterhead is visually incomplete until this file exists.
  logoSrc: '/src/assets/cation-logo.png',
}
