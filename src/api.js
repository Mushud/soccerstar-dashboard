import axios from 'axios'

/**
 * Single source of truth for where the backend lives.
 *
 * Unset  -> '' -> calls stay relative, resolved by the vite dev proxy locally, or by an
 *                 Amplify /api/<*> rewrite in production.
 * Set    -> absolute, for a frontend hosted apart from the API (Amplify + the pm2 box).
 *
 * This used to be duplicated as `const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'`
 * in three pages while three other files used bare relative paths. That meant half the app
 * called the Amplify domain (404 — Amplify serves static files, there is no backend behind it)
 * and the other half called http://localhost:3001, i.e. the visitor's own machine.
 *
 * Note there is no localhost fallback any more. A missing VITE_API_URL now degrades to
 * same-origin, which is correct behind a rewrite and an obvious 404 otherwise — far easier to
 * diagnose than requests silently aimed at the user's own computer.
 */
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

/** For raw fetch() calls (the SSE streams) that can't use the axios instance. */
export const apiUrl = path => `${API_BASE}${path}`

const api = axios.create({ baseURL: API_BASE })

export default api
