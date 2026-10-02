/** Selecciona la misma cartera para RPC, consultas y actualizaciones REST. */
export function hermesHeaders(serviceKey: string): Record<string, string> {
  const schema = process.env.HERMES_SCHEMA ?? 'public'
  if (schema !== 'public' && schema !== 'hermes') {
    throw new Error('HERMES_SCHEMA debe ser public o hermes')
  }
  if (process.env.HERMES_URL?.includes('zxoxougwgstrarwymlvd.supabase.co') && schema !== 'hermes') {
    throw new Error('Cation requiere HERMES_SCHEMA=hermes')
  }
  return {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Accept-Profile': schema,
    'Content-Profile': schema,
  }
}
