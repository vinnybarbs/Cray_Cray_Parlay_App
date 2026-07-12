-- Golf outright-winner events have no home/away team, so the NOT NULL
-- constraints silently rejected every golf row the odds refresher ever
-- fetched (including the majors the old static list requested). Outrights
-- are legitimately team-less; the field lives in outcomes JSON.
alter table odds_cache alter column home_team drop not null;
alter table odds_cache alter column away_team drop not null;
