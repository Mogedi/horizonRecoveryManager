-- Missing index on deal_contacts.deal_hubspot_id.
-- Every contact-quality and outreach query JOINs this table by deal_hubspot_id.
-- Without this index, each JOIN is a sequential scan of the full table.
CREATE INDEX IF NOT EXISTS idx_deal_contacts_deal
  ON deal_contacts(deal_hubspot_id);
