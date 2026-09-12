-- Prior season standings for tiles (owner 2026-09-12: "all records and
-- data showing in nfl is trash"). A week-one football tile read 0-0 vs
-- 0-0, which is true and useless. sync-standings now accepts a season
-- parameter and stores last season's final standings under that season
-- key; this view exposes them and the rankings context appends
-- "12-5 last yr" while a team's current record is 0-0.
CREATE OR REPLACE VIEW public.prior_season_standings AS
SELECT t.name AS team_name, t.sport, s.season, s.wins, s.losses, s.ties,
       CASE WHEN s.ties > 0 THEN s.wins || '-' || s.losses || '-' || s.ties ELSE s.wins || '-' || s.losses END AS record
FROM public.standings s
JOIN public.teams t ON t.id = s.team_id
WHERE s.season::numeric = EXTRACT(year FROM CURRENT_DATE) - 1;
GRANT SELECT ON public.prior_season_standings TO anon, authenticated, service_role;
