-- Closing line value per moneyline pick (2026-08-10, owner request).
-- Positive clv_pp means the pick beat the closing price. Coverage starts
-- 2026-07-11 when closing_lines capture began. Joins by event id when the
-- pick carries one, otherwise by team pair + kickoff instant within 3h.
-- (Applied to prod via MCP on 2026-08-10; this file is the repo record.)
create or replace view public.pick_clv as
with ml as (
  select s.id, s.session_id, s.sport, s.tier, s.pick, s.game_date, s.actual_outcome,
         s.home_team, s.away_team, s.odds_event_id,
         nullif(regexp_replace(s.odds, '[^0-9-]', '', 'g'), '')::int as stored_odds,
         case when s.pick ilike '%' || s.home_team || '%' then s.home_team
              when s.pick ilike '%' || s.away_team || '%' then s.away_team end as pick_team
  from ai_suggestions s
  where s.session_id like 'auto_digest%'
    and s.bet_type ilike '%moneyline%'
    and s.voided_at is null
),
cl as (
  select c.external_game_id, c.home_team, c.away_team, c.commence_time,
         o.value->>'name' as team,
         avg((o.value->>'price')::numeric) as close_price
  from closing_lines c
  cross join lateral jsonb_array_elements(c.outcomes) o
  where c.market_type = 'h2h'
  group by c.external_game_id, c.home_team, c.away_team, c.commence_time, o.value->>'name'
)
select m.id, m.session_id, m.sport, m.tier, m.pick, m.game_date, m.actual_outcome,
       m.stored_odds, round(cl.close_price) as close_price,
       round((case when m.stored_odds > 0 then 100.0 / (m.stored_odds + 100)
                   else -m.stored_odds / (-m.stored_odds + 100.0) end) * 100, 2) as stored_implied_pp,
       round((case when cl.close_price > 0 then 100.0 / (cl.close_price + 100)
                   else -cl.close_price / (-cl.close_price + 100.0) end) * 100, 2) as close_implied_pp,
       round(((case when cl.close_price > 0 then 100.0 / (cl.close_price + 100)
                    else -cl.close_price / (-cl.close_price + 100.0) end)
            - (case when m.stored_odds > 0 then 100.0 / (m.stored_odds + 100)
                    else -m.stored_odds / (-m.stored_odds + 100.0) end)) * 100, 2) as clv_pp
from ml m
join cl on cl.team = m.pick_team
  and (
    (m.odds_event_id is not null and cl.external_game_id = m.odds_event_id)
    or (m.odds_event_id is null
        and cl.home_team = m.home_team and cl.away_team = m.away_team
        and abs(extract(epoch from cl.commence_time - m.game_date)) <= 10800)
  )
where m.pick_team is not null and m.stored_odds is not null;

grant select on public.pick_clv to service_role;
