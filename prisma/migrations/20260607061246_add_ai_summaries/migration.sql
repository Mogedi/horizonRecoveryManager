-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT NOT NULL,
    "summary_json" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_summaries_deal_hubspot_id_key" ON "ai_summaries"("deal_hubspot_id");

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE RESTRICT ON UPDATE CASCADE;
