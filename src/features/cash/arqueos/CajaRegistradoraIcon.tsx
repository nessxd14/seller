/** lucide no trae caja registradora: mismo trazo (24×24, 2 px, redondeado) para que combine con Bell. */
export function CajaRegistradoraIcon({ className, size = 24 }: { className?: string; size?: number }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="7" y="3" width="10" height="6" rx="1" />
    <path d="M9.5 6h5" />
    <path d="M6 9h12l3 5v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
    <path d="M3 14h18" />
    <path d="M7 17.5h2M11 17.5h2M15 17.5h2" />
  </svg>
}
