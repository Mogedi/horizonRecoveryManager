-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('HUBSPOT', 'JUSTCALL', 'GOOGLE', 'USER', 'AI');

-- CreateEnum
CREATE TYPE "PhoneStatus" AS ENUM ('active', 'disconnected', 'invalid', 'unknown');

-- CreateEnum
CREATE TYPE "PipelineGroup" AS ENUM ('setup', 'outreach', 'case_mgmt', 'terminal');

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "call_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_call_attempt_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT,
    "source" "ActivitySource" NOT NULL,
    "external_id" TEXT,
    "type" TEXT NOT NULL,
    "happened_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_secs" INTEGER,
    "direction" TEXT,
    "outcome" TEXT,
    "from_number" TEXT,
    "to_number" TEXT,
    "agent_id" TEXT,
    "body" TEXT,
    "metadata" JSONB,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" SERIAL NOT NULL,
    "number_e164" TEXT NOT NULL,
    "deal_hubspot_id" TEXT,
    "contact_name" TEXT,
    "status" "PhoneStatus" NOT NULL DEFAULT 'unknown',
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_states" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT NOT NULL,
    "pipeline" "PipelineGroup" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "entered_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(6),
    "config" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_events_deal_hubspot_id_happened_at_idx" ON "activity_events"("deal_hubspot_id", "happened_at");

-- CreateIndex
CREATE INDEX "activity_events_source_happened_at_idx" ON "activity_events"("source", "happened_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_source_external_id_key" ON "activity_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "phone_numbers_number_e164_idx" ON "phone_numbers"("number_e164");

-- CreateIndex
CREATE INDEX "phone_numbers_deal_hubspot_id_idx" ON "phone_numbers"("deal_hubspot_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_states_deal_hubspot_id_pipeline_key" ON "pipeline_states"("deal_hubspot_id", "pipeline");

-- CreateIndex
CREATE UNIQUE INDEX "sync_sources_name_key" ON "sync_sources"("name");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_states" ADD CONSTRAINT "pipeline_states_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE CASCADE ON UPDATE CASCADE;
