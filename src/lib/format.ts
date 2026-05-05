const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const plain = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const fmtUSD = (n: number | null | undefined) =>
  n == null ? '—' : usd.format(n)

export const fmtNum = (n: number | null | undefined) =>
  n == null ? '—' : plain.format(n)

const bs = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const fmtBs = (n: number | null | undefined) =>
  n == null ? '—' : `${bs.format(n)} Bs`

export const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${plain.format(n)}%`

/**
 * Parse un string numérico admitiendo coma o punto como separador decimal.
 * Ignora separadores de miles. Devuelve null si está vacío o no es válido.
 */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  let normalized = s
  if (hasComma && hasDot) {
    // Formato con miles + decimales: el último separador es el decimal.
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    const decimalIsComma = lastComma > lastDot
    normalized = decimalIsComma
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (hasComma) {
    normalized = s.replace(',', '.')
  }

  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}
