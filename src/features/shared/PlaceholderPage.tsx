import { FeatureShell, FeatureState } from './FeatureShell'

export function PlaceholderPage({ title }: { title: string }) {
  return <FeatureShell eyebrow="PRÓXIMAMENTE" title={title} subtitle="Este módulo está en preparación"><FeatureState type="empty" text={`${title} estará disponible en una siguiente fase`} /></FeatureShell>
}
