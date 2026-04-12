const TOKEN_KEY = 'admin-token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch (_) { return null }
}

export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token) } catch (_) {}
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY) } catch (_) {}
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

export function getRole(): string | null {
  const token = getToken()
  if (!token) return null
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 1) return null
    const payload = JSON.parse(atob(token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role || null
  } catch (_) {
    return null
  }
}

export function getUsername(): string | null {
  const token = getToken()
  if (!token) return null
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 1) return null
    const payload = JSON.parse(atob(token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/')))
    return payload.user || null
  } catch (_) {
    return null
  }
}

export function isSuperAdmin(): boolean {
  return getRole() === 'superadmin'
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/admin/login'
  }
  return res
}
