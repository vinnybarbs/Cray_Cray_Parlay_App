-- The running to-do list, made queryable (owner request 2026-09-08):
-- the build queue lived only in the code-shipping session's context,
-- invisible to the project agents and the owner. Now it is a table the
-- desktop project loads next to the blackboard (agent_reports) and the
-- dial board (sport_dials). The code-shipping session keeps it current;
-- review agents may reference items but never edit them.
CREATE TABLE IF NOT EXISTS build_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  detail text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE build_queue IS
  'TrapHawk running build and decision queue. status: open, in_progress, blocked, done. priority: high, medium, low. Maintained by the code-shipping session.';
