Railway deployment checklist — Express backend + frontend (monorepo)

Overview
--------
This project runs a single Express backend (`server.js`) that in production will serve the built frontend from `dist/`. We recommend deploying the backend to Railway (or any container host). The `Procfile` and `Dockerfile` in the repo provide two options:

- Quick: Use Railway's GitHub integration and set the start command to `npm run start`.
- Container: Use the provided `Dockerfile` to deploy a container image.

Required environment variables
------------------------------
Set these in Railway's environment settings for the service:

- SUPABASE_URL — Supabase project URL
- SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (server-side only)
- SUPABASE_ANON_KEY — (optional) frontend anon key
- ODDS_API_KEY — the-odds-api key (if you want live fetching)
- OPENAI_API_KEY — OpenAI API key
- CRON_SECRET — secret used to protect `/cron/refresh-odds` (required for scheduled job)
- FRONTEND_URL — (optional) the deployed frontend hostname (used in CORS)
- NODE_ENV — set to "production"
- Any other keys present in `.env.example` that you need (e.g., SERPER_API_KEY, APISPORTS_API_KEY)

Railway setup (quick steps)
---------------------------
1. Create a new Railway project and connect the GitHub repo.
2. In the service settings, set the "Start Command" to:

   npm run start

   and the "Build Command":

   npm install

   (Railway runs a build step before starting; postinstall will run `npm run build`).
3. Add the environment variables above in Railway's dashboard (Environment → Variables).
4. For the port, Railway will inject `PORT`; `server.js` already respects `process.env.PORT`.
5. Deploy and watch logs. The server logs will show `Backend server started` with the port.

Scheduling the cron (seed `odds_cache`)
---------------------------------------
Railway provides a Scheduler (Add a plugin → Scheduler) or you can use "Tasks" to run HTTP requests.

Create a scheduled task that posts to the cron endpoint on the deployed service:

- Method: POST
- URL: https://<your-service>.up.railway.app/cron/refresh-odds
- Headers: { "Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>" }
- Body: {} (empty JSON)
- Frequency: your choice (e.g., every 15 minutes or hourly)

Verification commands (after deploy & first run)
-------------------------------------------------
1. Health check (should return JSON with apis configured):

```bash
curl -sS https://<your-service>.up.railway.app/api/health | jq
```

2. Trigger cron manually (one-off):

```bash
curl -X POST https://<your-service>.up.railway.app/cron/refresh-odds \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}'
```

3. Verify generator uses cache (quick smoke test):

```bash
curl -X POST https://<your-service>.up.railway.app/api/generate-parlay \
  -H "Content-Type: application/json" \
  -d '{"numLegs":3}' | jq '.metadata'
```

This should return metadata with `fallbackUsed: false` and `oddsSource` set to one of your configured bookmakers (e.g., DraftKings) if the cache was seeded.

Notes & troubleshooting
-----------------------
- If you previously deployed only the frontend to Vercel, the `/api/*` endpoints will 404 because the Express server isn't running there. Deploy the backend to Railway and point the frontend `API_BASE` (or use relative paths if hosting frontend on the same host) to Railway's URL.
- If you prefer everything on Vercel, we'd need to convert handlers to serverless functions. Since you have Railway, the container/server approach is simpler and recommended.
- Logging: enable `Verbose` logs in Railway while testing to capture server start and incoming requests.

Security
--------
- Keep `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` secret — only store them as Railway environment variables.
- Use a strong `CRON_SECRET` and never hard-code it in client code.

Next steps I can take for you
----------------------------
- Add a small network test in `scripts/` to call the deployed `/api/health` and `/cron/refresh-odds` and assert expected responses.
- Optionally add a small README note in the frontend config to set `API_BASE` to your Railway URL.
