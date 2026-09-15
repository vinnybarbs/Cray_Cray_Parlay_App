-- Owner 2026-09-15: "add all users so far to admin ability" and a live,
-- read only dials dashboard per market linked from the admin dashboard.
--
-- Admin access was an env allowlist (ADMIN_EMAILS on Railway) that only
-- the owner could edit. It moves to a table: requireAdmin accepts an
-- email on the env list OR in admin_users. Seeded with every account
-- that exists today. Nothing here changes who can see the public site;
-- the digest, ledger and board were already open to any signed in user.

CREATE TABLE IF NOT EXISTS public.admin_users (
  email text PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.admin_users IS
  'Emails allowed into /admin and the /api/admin/* endpoints, checked by api/admin-dashboard.js requireAdmin next to the ADMIN_EMAILS env list. Seeded 2026-09-15 with every auth.users row at the time (owner: all users so far).';
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_users_service ON public.admin_users;
CREATE POLICY admin_users_service ON public.admin_users FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.admin_users TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.admin_users TO service_role;

INSERT INTO public.admin_users (email, note)
SELECT lower(email), 'seeded 2026-09-15, every account at the time'
FROM auth.users
WHERE email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

INSERT INTO build_queue (priority, status, title, detail) VALUES
  ('medium', 'done', 'Live dials dashboard per market, linked from the admin dashboard',
   'Owner 2026-09-15: "link in the admin dashboard to a live dials dashboard for each market", "do not allow tweaking dials in the view". Shipped: GET /api/admin/dials?sport=X (read only, admin JWT) returns the merged dial board for the sport with its scope, the flat multipliers, the raw band map, the rails, the publication flags, the last weight changes, and every read in the window with its factor stack, its published pick and its shadow grade; NFL props return the last reads with the v1 and v2 columns. /admin/dials renders it with a tab per market and a card per read in the Edge Anatomy order (anchor, factors, net, edges per market, sizing, pick, outcome). No control on the page writes anything: dials move only through sport_dials and model_weight_changes under the review protocol (directives 7, 8, 21).');
