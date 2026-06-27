declare global {
  interface Window {
    _env_?: {
      VITE_API_URL?: string;
    };
  }
}

let envApiUrl = window?._env_?.VITE_API_URL || import.meta.env.VITE_API_URL;

if (!envApiUrl || envApiUrl === "") {
  envApiUrl = "http://localhost:5000/api/v1";
}

export const API = envApiUrl;
export const BACKEND_BASE_URL = API.replace(/\/api\/v1\/?$/, "");

export function api(path: string, token: string, opts: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
}
