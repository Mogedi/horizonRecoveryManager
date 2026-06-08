-- CreateTable
CREATE TABLE "call_transcripts" (
    "id" SERIAL NOT NULL,
    "activity_event_id" INTEGER NOT NULL,
    "transcript" TEXT NOT NULL,
    "classification" TEXT,
    "summary" TEXT,
    "whisper_secs" DOUBLE PRECISION,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_transcripts_activity_event_id_key" ON "call_transcripts"("activity_event_id");

-- AddForeignKey
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_activity_event_id_fkey" FOREIGN KEY ("activity_event_id") REFERENCES "activity_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
