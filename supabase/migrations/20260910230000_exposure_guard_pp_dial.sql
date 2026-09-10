-- The exposure guard moves onto the pp scale (owner, 2026-09-10: "doesn't
-- matter what label we give it, we score ourselves off pp"). Instead of
-- demoting the label one rung, a team on two straight graded moneyline
-- losses this week has its next claim deducted exposure_guard_pp, and the
-- tier falls out of the adjusted claim, which is what the record then
-- scores. Seeded at 2pp for every sport through the __all__ row; a sport
-- row overrides it like any other dial.
INSERT INTO sport_dials (sport, dial, value) VALUES ('__all__', 'exposure_guard_pp', 2)
ON CONFLICT (sport, dial) DO NOTHING;
