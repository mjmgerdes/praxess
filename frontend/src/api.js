// Central API base URL — in dev, Vite proxies /api/* to localhost:8000,
// so apiBase() returns '' and calls like fetch('/api/health') work unchanged.
// In production (Railway), VITE_API_URL is set to the backend's public URL
// (e.g. https://praxess-backend.up.railway.app) so the same paths resolve correctly.
export const apiBase = () => (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export function apiFetch(path, body) {
  const base = apiBase()
  const url = base ? `${base}/api/${path}` : `/api/${path}`
  return fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => {
    if (!r.ok) throw new Error(path + ' ' + r.status)
    return r.json()
  })
}
