/** Shared fetch helper for the `{ success, data }` / `{ error }` envelope every Clarion route uses.
 *  `cache: 'no-store'`: API routes send no Cache-Control header, so without this the browser
 *  can serve a stale GET response after a React Query invalidation-triggered refetch. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`)
  return body.data as T
}
