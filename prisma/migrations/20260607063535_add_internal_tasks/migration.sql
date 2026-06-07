-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('case', 'business', 'vendor', 'legal', 'networking', 'other');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'done');

-- CreateTable
CREATE TABLE "internal_tasks" (
    "id" SERIAL NOT NULL,
    "deal_hubspot_id" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "due_date" DATE,
    "category" "TaskCategory" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "internal_tasks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_deal_hubspot_id_fkey" FOREIGN KEY ("deal_hubspot_id") REFERENCES "deals"("hubspot_id") ON DELETE SET NULL ON UPDATE CASCADE;
