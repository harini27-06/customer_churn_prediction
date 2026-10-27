import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000/api',
  timeout: 30000,
  withCredentials: true,
})

export const exportHistoryUrl = `${api.defaults.baseURL}/predictions/history.csv`
