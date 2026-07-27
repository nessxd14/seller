// TAREA A: shared "is this line unpriced" predicate — mirrors stockCheck.ts's
// file-organization pattern (a focused pure predicate, no side effects). A line is
// "unpriced" when its applied price is (effectively) zero. This deliberately covers
// BOTH precio_base IS NULL and precio_base = 0 uniformly: ProductRepository.supabase.ts's
// num() helper already collapses both to 0 at the adapter layer before the price ever
// reaches the cart, so there is nothing left to distinguish here — checking for
// nullness would miss the "collapsed to 0" case entirely, so this must be a numeric
// near-zero test, never a nullness test.
export interface PriceCheckLine {
  precioAplicado: number
}

const EPSILON = 0.005

export const isLineUnpriced = (line: PriceCheckLine): boolean => Math.abs(line.precioAplicado) < EPSILON
