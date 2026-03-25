-- Process scheduling support
-- Adds: mode, schedule, schedule overlap policy, schedule runtime state

ALTER TABLE processes ADD COLUMN mode TEXT NOT NULL DEFAULT '\"daemon\"';
ALTER TABLE processes ADD COLUMN schedule TEXT;
ALTER TABLE processes ADD COLUMN schedule_overlap_policy TEXT NOT NULL DEFAULT '\"ignore\"';
ALTER TABLE processes ADD COLUMN schedule_state TEXT NOT NULL DEFAULT '{}';
