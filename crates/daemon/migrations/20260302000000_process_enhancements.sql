-- Process Guardian Enhancements
-- Adds: log_config, run_as fields

ALTER TABLE processes ADD COLUMN log_config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE processes ADD COLUMN run_as TEXT;
