// Brief T1 Tarea 5: window.print() no expone ningún gancho para nombrar el archivo que
// Chrome ofrece al elegir "Guardar como PDF" — la única palanca disponible es
// document.title en el momento de imprimir. Esta función solo arma ese texto; quien la
// llama es responsable de setear/restaurar document.title alrededor de window.print().
const sanitizarCliente = (cliente: string): string =>
  cliente
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

export const nombreArchivoDocumento = (numero: string, cliente?: string): string => {
  const clienteLimpio = cliente ? sanitizarCliente(cliente) : ''
  return clienteLimpio ? `${numero} - ${clienteLimpio}` : numero
}
