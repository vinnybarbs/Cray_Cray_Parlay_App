// API Configuration.
// Production builds are served by the same Express server that hosts the
// API, so same-origin ('') is correct on any domain (traphawk.io, www, or
// the railway.app URL) and no CORS is involved. Local dev (vite on :3001)
// talks to prod unless VITE_API_BASE_URL overrides it.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'https://craycrayparlayapp-production.up.railway.app' : '');
