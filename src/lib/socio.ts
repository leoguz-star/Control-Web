// Los socios entran por NOMBRE, no por email. Supabase Auth necesita un email
// por debajo, así que generamos uno interno y determinista a partir del nombre.
// El socio nunca lo ve. Esta misma lógica vive en la Edge Function create-socio
// (Deno) — si cambias una, cambia la otra.

const SOCIO_EMAIL_DOMAIN = 'socios.local'

export function socioNameToEmail(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.') // no alfanumérico -> punto
    .replace(/^\.+|\.+$/g, '') // sin puntos al inicio/fin
  return `${slug}@${SOCIO_EMAIL_DOMAIN}`
}

/** En el login: si el texto no parece email (sin @), es un nombre de socio. */
export function loginIdToEmail(idOrEmail: string): string {
  const v = idOrEmail.trim()
  return v.includes('@') ? v : socioNameToEmail(v)
}
