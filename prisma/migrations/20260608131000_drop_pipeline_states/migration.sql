-- pipeline_states was created in M9 for per-deal pipeline group tracking.
-- That design was superseded by PIPELINE_GROUP constant + deal_enriched view.
-- The table was never written to (0 rows) and has no readers.
DROP TABLE IF EXISTS pipeline_states;
