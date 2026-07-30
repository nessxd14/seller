// Brief H: informativo, no un error — sin colores de alarma.
const tiempoRelativo = (guardadoEn: number): string => {
  const minutos = Math.max(1, Math.round((Date.now() - guardadoEn) / 60_000))
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  return `hace ${horas} h`
}

export function BorradorBanner({ guardadoEn, onRetomar, onDescartar }: { guardadoEn: number; onRetomar: () => void; onDescartar: () => void }) {
  return (
    <div className="borrador-banner" role="status">
      <span>Recuperamos un borrador de {tiempoRelativo(guardadoEn)}</span>
      <div className="borrador-banner-actions">
        <button type="button" onClick={onRetomar}>Retomar</button>
        <button type="button" onClick={onDescartar}>Descartar</button>
      </div>
    </div>
  )
}
