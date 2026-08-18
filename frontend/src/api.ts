const envApiUrl = import.meta.env.VITE_API_URL;

if (!envApiUrl || envApiUrl === "") {
  throw new Error("VITE_API_URL no está definido");
}

export const API = envApiUrl;
export const BACKEND_BASE_URL = API.replace(/\/api\/v1\/?$/, "");

export function api(path: string, token: string, opts: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
}
