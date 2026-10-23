ALTER TABLE orgs ADD COLUMN IF NOT EXISTS minutes_reserved numeric(10,2) NOT NULL DEFAULT 0 CHECK (minutes_reserved >= 0);

CREATE TABLE IF NOT EXISTS usage_ledger_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz
);
-- Activation is deliberately manual after draining legacy calls and reviewing
-- the existing minutes_used baseline. Never infer historical held minutes.
INSERT INTO usage_ledger_state (singleton, activated_at) VALUES (true, NULL) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS usage_reservations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  minutes numeric(10,2) NOT NULL CHECK (minutes > 0),
  call_id text,
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'released', 'settled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (org_id, call_id)
);
CREATE INDEX IF NOT EXISTS usage_reservations_held_idx ON usage_reservations(org_id) WHERE state = 'held';

CREATE TABLE IF NOT EXISTS usage_settlements (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  reservation_id uuid REFERENCES usage_reservations(id),
  actual_minutes numeric(10,2) NOT NULL CHECK (actual_minutes >= 0),
  overage_minutes numeric(10,2) NOT NULL CHECK (overage_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, call_id)
);

ALTER TABLE usage_ledger_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON usage_ledger_state, usage_reservations, usage_settlements FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON usage_ledger_state, usage_reservations, usage_settlements FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON usage_ledger_state, usage_reservations, usage_settlements FROM authenticated;
  END IF;
END $$;
