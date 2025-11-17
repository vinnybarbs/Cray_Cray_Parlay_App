-- rosters_bulk_upsert_function.sql
-- Create a helper function to atomically upsert an array of roster rows (jsonb)
-- Usage:
--   SELECT rosters_bulk_upsert('[{...}, {...}]'::jsonb);
-- This avoids 409 duplicate-key errors by using ON CONFLICT DO UPDATE server-side.

BEGIN;

-- DROP existing function first to allow changing the return type safely.
-- Postgres disallows changing a function's return type with CREATE OR REPLACE.
-- If you prefer not to drop, you can manually run:
--   DROP FUNCTION IF EXISTS public.rosters_bulk_upsert(jsonb);
-- before running this file in the SQL editor.
DROP FUNCTION IF EXISTS public.rosters_bulk_upsert(jsonb);

CREATE OR REPLACE FUNCTION public.rosters_bulk_upsert(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  elem jsonb;
  rosters_arr jsonb := COALESCE(payload->'rosters', '[]'::jsonb);
  players_arr jsonb := COALESCE(payload->'players', '[]'::jsonb);
  -- loop-local temporary vars declared up here and reused per-iteration
  candidate text;
  candidate_espn text;
  canonical_team_id text;
  sport_val text;
  -- counters for reporting
  players_touched integer := 0;
  players_inserted integer := 0;
  players_updated integer := 0;
  rosters_touched integer := 0;
  rosters_inserted integer := 0;
  rosters_updated integer := 0;
BEGIN
  IF (players_arr IS NULL OR players_arr = '[]'::jsonb) AND (rosters_arr IS NULL OR rosters_arr = '[]'::jsonb) THEN
    RAISE NOTICE 'No rosters or players provided to rosters_bulk_upsert';
    RETURN;
  END IF;

  -- Upsert players first so rosters can reference them
  FOR elem IN SELECT * FROM jsonb_array_elements(players_arr)
  LOOP
    players_touched := players_touched + 1;
    -- Resolve candidate ids and sport from the JSON element
    candidate := NULLIF(elem->> 'current_team_id', '');
    candidate_espn := COALESCE(elem->> 'espn_team_id', elem->'provider_ids'->> 'espn');
    canonical_team_id := NULL;
    sport_val := NULLIF(elem->> 'sport', '');

    IF candidate IS NOT NULL OR candidate_espn IS NOT NULL THEN
      SELECT t.team_id INTO canonical_team_id
      FROM public.teams t
      WHERE t.sport = sport_val
        AND (
          t.team_id = candidate
          OR t.id::text = candidate
          OR (candidate_espn IS NOT NULL AND t.espn_id::text = candidate_espn)
        )
      LIMIT 1;
    END IF;

    IF canonical_team_id IS NULL THEN
      canonical_team_id := candidate;
    END IF;

    -- Try to update an existing player by player_id. If no row exists, insert.
    UPDATE public.players
    SET
      sport = COALESCE(NULLIF(elem->> 'sport', '')::text, sport),
      name = COALESCE(NULLIF(elem->> 'name', '')::text, name),
      player_name = COALESCE(NULLIF(elem->> 'player_name', '')::text, player_name),
      position = COALESCE(NULLIF(elem->> 'position', '')::text, position),
      current_team_id = COALESCE(canonical_team_id, current_team_id),
      provider_ids = COALESCE(provider_ids || COALESCE(elem->'provider_ids', '{}'::jsonb), COALESCE(elem->'provider_ids', '{}'::jsonb)),
      espn_id = COALESCE(NULLIF(elem->> 'espn_id','')::bigint, espn_id),
      last_updated = COALESCE(NULLIF(elem->> 'last_updated','')::timestamptz, last_updated)
    WHERE player_id = NULLIF(elem->> 'player_id', '')::text;
    IF FOUND THEN
      players_updated := players_updated + 1;
    ELSE
      INSERT INTO public.players (
        sport,
        player_id,
        name,
        player_name,
        position,
        current_team_id,
        provider_ids,
        espn_id,
        last_updated
      )
      VALUES (
        NULLIF(elem->> 'sport', '')::text,
        NULLIF(elem->> 'player_id', '')::text,
        NULLIF(elem->> 'name', '')::text,
        NULLIF(elem->> 'player_name', '')::text,
        NULLIF(elem->> 'position', '')::text,
        canonical_team_id,
        COALESCE(elem->'provider_ids', '{}'::jsonb),
        CASE WHEN (elem->> 'espn_id') IS NOT NULL AND (elem->> 'espn_id') <> '' THEN (elem->> 'espn_id')::bigint ELSE NULL END,
        COALESCE(NULLIF(elem->> 'last_updated','')::timestamptz, now())
      );
      players_inserted := players_inserted + 1;
    END IF;
  END LOOP;

  -- Upsert rosters
  FOR elem IN SELECT * FROM jsonb_array_elements(rosters_arr)
  LOOP
    rosters_touched := rosters_touched + 1;
    candidate := NULLIF(elem->> 'team_id', '');
    candidate_espn := COALESCE(elem->> 'espn_team_id', elem->'provider_ids'->> 'espn');
    canonical_team_id := NULL;
    sport_val := NULLIF(elem->> 'sport', '');

    IF candidate IS NOT NULL OR candidate_espn IS NOT NULL THEN
      SELECT t.team_id INTO canonical_team_id
      FROM public.teams t
      WHERE t.sport = sport_val
        AND (
          t.team_id = candidate
          OR t.id::text = candidate
          OR (candidate_espn IS NOT NULL AND t.espn_id::text = candidate_espn)
        )
      LIMIT 1;
    END IF;

    IF canonical_team_id IS NULL THEN
      canonical_team_id := candidate;
    END IF;

    -- Try update first; if no row exists, insert it. This avoids relying on a unique
    -- index existing at the time of deployment and lets us count inserts vs updates.
    UPDATE public.rosters
    SET
      active = COALESCE((elem->> 'active')::boolean, active, true),
      provider_ids = COALESCE(rosters.provider_ids || COALESCE(elem->'provider_ids','{}'::jsonb), COALESCE(elem->'provider_ids','{}'::jsonb)),
      metadata = COALESCE(elem-> 'metadata', metadata),
      last_updated = COALESCE(NULLIF(elem->> 'last_updated','')::timestamptz, last_updated)
    WHERE sport = NULLIF(elem->> 'sport', '')::text
      AND season = NULLIF(elem->> 'season', '')::text
      AND team_id = canonical_team_id
      AND player_id = NULLIF(elem->> 'player_id', '')::text;

    IF FOUND THEN
      rosters_updated := rosters_updated + 1;
    ELSE
      INSERT INTO public.rosters (sport, season, team_id, player_id, active, provider_ids, metadata, last_updated)
      VALUES (
        NULLIF(elem->> 'sport', '')::text,
        NULLIF(elem->> 'season', '')::text,
        canonical_team_id,
        NULLIF(elem->> 'player_id', '')::text,
        COALESCE((elem->> 'active')::boolean, true),
        COALESCE(elem->'provider_ids', '{}'::jsonb),
        elem-> 'metadata',
        COALESCE(NULLIF(elem->> 'last_updated','')::timestamptz, now())
      );
      rosters_inserted := rosters_inserted + 1;
    END IF;
  END LOOP;

  -- Return a JSON summary so callers can log/verify counts
  RETURN jsonb_build_object(
    'players_touched', players_touched,
    'players_inserted', players_inserted,
    'players_updated', players_updated,
    'rosters_touched', rosters_touched,
    'rosters_inserted', rosters_inserted,
    'rosters_updated', rosters_updated
  );
END;
$$;

COMMIT;

-- Example call (replace the JSON with your roster array):
-- SELECT rosters_bulk_upsert('[{"sport":"NFL","season":"2025","team_id":"22","player_id":"5084939","active":true,"provider_ids":{"espn":"5084939"},"last_updated":"2025-11-14T23:08:56.894-07"}]'::jsonb);
