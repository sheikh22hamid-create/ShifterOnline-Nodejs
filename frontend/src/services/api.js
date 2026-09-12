import axios from 'axios'

const PROD_API_BASE = 'https://shifteronline-nodejs.onrender.com/api/v1/admin'

function getBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return '/api/v1/admin'
  }
  return PROD_API_BASE
}

const api = axios.create({
  baseURL: getBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('shifter_admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// A 401 here always means the token is gone/expired — every admin route
// requires auth, so there's no "some routes are public" ambiguity to handle.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('shifter_admin_token')
      localStorage.removeItem('shifter_admin_user')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
