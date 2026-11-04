import axios from 'axios';

// Set VITE_API_BASE_URL in Coolify to the backend origin, without /api.
// Example: https://timetracker-api.knowletive.in
const API_ORIGIN = (
  import.meta.env.VITE_API_BASE_URL || 'https://timetracker-api.knowletive.in'
).trim().replace(/\/+$/, '');

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
