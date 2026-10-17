/**
 * Safe authenticated API fetch wrapper for TwinMind AI.
 * Attaches the signed owner session Bearer token and credentials: 'include'
 * to ensure seamless communication in cross-site iframe environments.
 */

export function getAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra || {});
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('twinmind_owner_token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return headers;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = getAuthHeaders(init?.headers);
  return fetch(input, {
    credentials: 'include',
    ...init,
    headers,
  });
}
