-- Recreate deal_enriched view to add owner_name column.
-- PostgreSQL requires DROP + CREATE when adding columns (can't ALTER ORDER on views).
-- owner_name: third segment of deal name, handles both ' - ' and ' – ' separators.

DROP VIEW IF EXISTS deal_enriched;

CREATE VIEW deal_enriched AS
SELECT
  d.*,

  -- State: 2-letter abbreviation before ZIP from address
  (regexp_match(d.property_address, ',\s*([A-Z]{2})\s+\d{5}'))[1]
    AS state,

  -- County: first segment of deal name, uppercased
  upper(trim(
    split_part(
      split_part(COALESCE(d.name, ''), ' - ', 1),
      ' – ', 1
    )
  ))
    AS normalized_county,

  -- Owner name: third segment, em-dash normalized to hyphen, ($Amount) suffix stripped.
  -- Returns NULL if empty (deals with < 3 segments or unparseable names).
  NULLIF(trim(regexp_replace(
    split_part(
      regexp_replace(COALESCE(d.name, ''), ' – ', ' - ', 'g'),
      ' - ', 3
    ),
    '\s*\(\$[^)]*\)\s*$', '', 'g'
  )), '') AS owner_name,

  -- Tax sale vintage
  EXTRACT(YEAR FROM d.tax_sale_date)::int
    AS tax_sale_year,

  -- Case age: months elapsed since tax sale
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
    WHEN d.amount <  15000    THEN 'small'
    WHEN d.amount <  50000    THEN 'mid'
    WHEN d.amount < 100000    THEN 'large'
    ELSE                           'xlarge'
  END
    AS amount_bucket,

  -- Unique call days: distinct calendar days in ET with outbound JustCall calls
  COALESCE(ucd.unique_call_days, 0)
    AS unique_call_days,

  -- Call intensity tier
  CASE
    WHEN COALESCE(ucd.unique_call_days, 0) = 0 THEN 'never_called'
    WHEN ucd.unique_call_days <= 2             THEN 'light'
    WHEN ucd.unique_call_days <= 6             THEN 'working'
    ELSE                                            'exhausted'
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
