-- deal_enriched view: analytics-ready layer on top of the deals table.
--
-- Design principles:
--   - deals table = clean HubSpot mirror, never modified here
--   - this view = all inferred/derived fields, always fresh, zero sync step
--   - to add a new computed column: ALTER VIEW or recreate (single SQL change)
--   - if performance ever degrades at scale: CREATE MATERIALIZED VIEW (one-line swap)
--
-- Derived fields:
--   state              — 2-letter abbreviation extracted from property_address
--   normalized_county  — from deal name first segment (more reliable than HubSpot dropdown)
--   tax_sale_year      — YYYY from tax_sale_date
--   case_age_months    — months elapsed since tax sale date
--   amount_bucket      — small / mid / large / xlarge / unknown
--   unique_call_days   — distinct calendar days (America/New_York) with outbound JustCall calls
--   call_intensity     — never_called / light / working / exhausted (7+ unique days)

CREATE OR REPLACE VIEW deal_enriched AS
SELECT
  d.*,

  -- State: pull 2-letter abbreviation before ZIP from address
  (regexp_match(d.property_address, ',\s*([A-Z]{2})\s+\d{5}'))[1]
    AS state,

  -- County: extract first segment of deal name before ' - ' or ' – ', uppercased
  -- More reliable than the HubSpot county dropdown (which puts non-metro GA + all FL as "Other")
  upper(trim(
    split_part(
      split_part(COALESCE(d.name, ''), ' - ', 1),
      ' – ', 1
    )
  ))
    AS normalized_county,

  -- Tax sale vintage
  EXTRACT(YEAR FROM d.tax_sale_date)::int
    AS tax_sale_year,

  -- Case age: months elapsed since tax sale (0 if tax_sale_date is null)
  CASE
    WHEN d.tax_sale_date IS NULL THEN NULL
    ELSE (
      EXTRACT(YEAR FROM age(CURRENT_DATE, d.tax_sale_date::date)) * 12 +
      EXTRACT(MONTH FROM age(CURRENT_DATE, d.tax_sale_date::date))
    )::int
  END
    AS case_age_months,

  -- Amount bucket
  CASE
    WHEN d.amount IS NULL     THEN 'unknown'
    WHEN d.amount <  15000    THEN 'small'    -- <$15K
    WHEN d.amount <  50000    THEN 'mid'      -- $15K–$50K
    WHEN d.amount < 100000    THEN 'large'    -- $50K–$100K
    ELSE                           'xlarge'   -- $100K+
  END
    AS amount_bucket,

  -- Unique call days: distinct calendar days in ET with at least one outbound JustCall attempt
  COALESCE(ucd.unique_call_days, 0)
    AS unique_call_days,

  -- Call intensity tier derived from unique call days
  CASE
    WHEN COALESCE(ucd.unique_call_days, 0) = 0 THEN 'never_called'
    WHEN ucd.unique_call_days <= 2             THEN 'light'       -- 1–2 days
    WHEN ucd.unique_call_days <= 6             THEN 'working'     -- 3–6 days
    ELSE                                            'exhausted'    -- 7+ days
  END
    AS call_intensity

FROM deals d
LEFT JOIN (
  SELECT
    deal_hubspot_id,
    COUNT(DISTINCT (happened_at AT TIME ZONE 'America/New_York')::date)::int AS unique_call_days
  FROM activity_events
  WHERE source = 'JUSTCALL'
    AND direction = 'outbound'
  GROUP BY deal_hubspot_id
) ucd ON ucd.deal_hubspot_id = d.hubspot_id;
