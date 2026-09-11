-- The first live props read (2026-09-10 19:45 MT) put a single-book
-- line at the top of the board (3.5 receptions, one book, 16.2pp). One
-- book is dispersion, not consensus, the tennis +251 lesson. A prop
-- needs prop_min_books books before it is read; dial, seeded at 2.
INSERT INTO sport_dials (sport, dial, value) VALUES ('NFL_props', 'prop_min_books', 2)
ON CONFLICT (sport, dial) DO NOTHING;
