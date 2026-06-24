export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";
export const BACKEND_BASE_URL = API.replace(/\/api\/v1\/?$/, "");

export function api(path: string, token: string, opts: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
}
