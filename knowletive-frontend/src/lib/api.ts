import axios from 'axios';

// Resolve backend origin:
// 1. Explicit VITE_API_BASE_URL (set in Dockerfile / Coolify build env).
// 2. If running locally on localhost/127.0.0.1, connect to local backend (http://localhost:8000).
// 3. Deployed production fallback (https://timetracker-api.knowletive.in).
const resolveApiOrigin = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:8000';
  }
  return 'https://timetracker-api.knowletive.in';
};

const API_ORIGIN = resolveApiOrigin().trim().replace(/\/+$/, '');

const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');

  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      // Avoid redirecting repeatedly if the current page is already login.
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
