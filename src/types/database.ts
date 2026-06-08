export type TransactionCategory = 'VENTA' | 'CAMBIO' | 'PAGO' | 'AJUSTE+' | 'AJUSTE-'
export type TransactionStatus = 'PENDIENTE' | 'CONCILIADO'
export type CommissionKind = 'ACUMULADO' | 'COBRADO'
export type AccountKind = 'FIAT' | 'CRYPTO'

export type PartnerRole = 'ADMIN' | 'SOCIO'

export interface Partner {
  id: string
  name: string
  commission_share: number
  role: PartnerRole
  is_capital_partner: boolean
  is_house_operator: boolean
  user_id: string | null
  created_at: string
}

export interface Account {
  id: string
  name: string
  kind: AccountKind
  currency: 'USD' | 'USDT'
  initial_balance: number
  sort_order: number
  is_active: boolean
  owner_partner_id: string | null
}

export interface Client {
  id: string
  name: string
  notes: string | null
  owner_partner_id: string | null
  created_at: string
}

export interface Transaction {
  id: string
  date: string
  category: TransactionCategory
  description: string | null
  client_id: string | null
  account_id: string | null
  destination_account_id: string | null
  partner_id: string | null
  owner_partner_id: string | null
  monto_usdt: number | null
  tasa_usdt: number | null
  ref: string | null
  monto_divisa: number | null
  tasa_divisa: number | null
  ref2: string | null
  aplica_pago_movil: boolean
  comision_binance_usd: number
  dif_usd: number
  cambio_usdt_bs: number
  cambio_divisa_bs: number
  dif_bs: number
  comision_pago_movil_bs: number
  margen_pct: number | null
  status: TransactionStatus
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface BolivarSummary {
  ventas_count: number
  dif_bs_total: number
  comision_pago_movil_total: number
  comision_binance_total: number
  dif_bs_neto_total: number
  dif_usd_neto_total: number
}

export interface AccountBalance {
  id: string
  name: string
  kind: AccountKind
  currency: 'USD' | 'USDT'
  sort_order: number
  owner_partner_id: string | null
  balance: number
}

export interface PartnerCashBalance {
  partner_id: string
  partner_name: string
  account_id: string
  account_name: string
  kind: AccountKind
  currency: 'USD' | 'USDT'
  sort_order: number
  balance: number
}

export interface PartnerBalance {
  id: string
  name: string
  commission_share: number
  acumulado_total: number
  cobrado_total: number
  pendiente: number
}

export interface CashPending {
  efectivo_pendiente: number
  ventas_pendientes: number
}
