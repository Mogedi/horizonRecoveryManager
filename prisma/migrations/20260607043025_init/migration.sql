-- CreateEnum
CREATE TYPE "SnoozeCategory" AS ENUM ('waiting_on_attorney', 'waiting_on_county', 'waiting_on_client', 'waiting_on_documents', 'waiting_on_probate', 'filed_normal_wait', 'other');

-- CreateTable
CREATE TABLE "deals" (
    "id" SERIAL NOT NULL,
    "hubspot_id" TEXT NOT NULL,
    "name" TEXT,
    "stage" TEXT,
    "pipeline" TEXT,
    "owner_id" TEXT,
    "amount" DECIMAL(12,2),
    "estimated_surplus" DECIMAL(12,2),
    "close_date" DATE,
    "last_activity_date" TIMESTAMPTZ(6),
    "stage_entered_at" TIMESTAMPTZ(6),
    "last_modified" TIMESTAMPTZ(6),
    "contact_count" INTEGER NOT NULL DEFAULT 0,
    "property_address" TEXT,
    "county" TEXT,
    "parcel_id" TEXT,
    "tax_sale_date" DATE,
    "hubspot_url" TEXT,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_activities" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "author_owner_id" TEXT,
    "direction" TEXT,
    "timestamp" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_contacts" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT NOT NULL,
    "contact_hubspot_id" TEXT,
    "name" TEXT,
    "contact_type" TEXT,
    "ownership_status" TEXT,
    "is_deceased" BOOLEAN NOT NULL DEFAULT false,
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "phone_numbers" JSONB,
    "email_list" JSONB,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_snoozes" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT NOT NULL,
    "category" "SnoozeCategory" NOT NULL,
    "freeform_note" TEXT,
    "snooze_until" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "woke_at" TIMESTAMPTZ(6),

    CONSTRAINT "deal_snoozes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" SERIAL NOT NULL,
    "sync_type" TEXT,
    "api_calls_made" INTEGER,
    "deals_synced" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "deals_hubspot_id_key" ON "deals"("hubspot_id");

-- AddForeignKey
ALTER TABLE "deal_activities" ADD CONSTRAINT "deal_activities_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_snoozes" ADD CONSTRAINT "deal_snoozes_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE RESTRICT ON UPDATE CASCADE;
