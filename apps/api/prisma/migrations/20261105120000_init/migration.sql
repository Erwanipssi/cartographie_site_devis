-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AnalysisTrigger" AS ENUM ('manual', 'scheduled');

-- CreateEnum
CREATE TYPE "SiteRunStatus" AS ENUM ('pending', 'crawling', 'analyzing_pdfs', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('pending', 'text', 'image', 'partial', 'error');

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "inputUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "includeSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "emailOnComplete" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'pending',
    "trigger" "AnalysisTrigger" NOT NULL DEFAULT 'manual',
    "scheduleId" TEXT,
    "config" JSONB NOT NULL,
    "emailOnComplete" BOOLEAN NOT NULL DEFAULT false,
    "notifyEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "exportPath" TEXT,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisSite" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "SiteRunStatus" NOT NULL DEFAULT 'pending',
    "htmlCount" INTEGER NOT NULL DEFAULT 0,
    "pdfCount" INTEGER NOT NULL DEFAULT 0,
    "pdfTextCount" INTEGER NOT NULL DEFAULT 0,
    "pdfImageCount" INTEGER NOT NULL DEFAULT 0,
    "pdfPartialCount" INTEGER NOT NULL DEFAULT 0,
    "pdfErrorCount" INTEGER NOT NULL DEFAULT 0,
    "otherCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "pendingPdfCount" INTEGER NOT NULL DEFAULT 0,
    "discoveryDone" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "AnalysisSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "analysisSiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "depth" INTEGER NOT NULL,
    "parentUrl" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdfDocument" (
    "id" TEXT NOT NULL,
    "analysisSiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "depth" INTEGER NOT NULL,
    "parentUrl" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "pageCount" INTEGER,
    "pagesWithText" INTEGER,
    "pagesWithoutText" INTEGER,
    "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "PdfDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlError" (
    "id" TEXT NOT NULL,
    "analysisSiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailDelivery" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "recipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "MailStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "trigger" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSite" (
    "scheduleId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "ScheduleSite_pkey" PRIMARY KEY ("scheduleId","siteId")
);

-- CreateTable
CREATE TABLE "ScheduleRecipient" (
    "scheduleId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,

    CONSTRAINT "ScheduleRecipient_pkey" PRIMARY KEY ("scheduleId","recipientId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_normalizedUrl_key" ON "Site"("normalizedUrl");

-- CreateIndex
CREATE INDEX "Site_archivedAt_idx" ON "Site"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_email_key" ON "Recipient"("email");

-- CreateIndex
CREATE INDEX "Analysis_createdAt_idx" ON "Analysis"("createdAt");

-- CreateIndex
CREATE INDEX "Analysis_scheduleId_idx" ON "Analysis"("scheduleId");

-- CreateIndex
CREATE INDEX "AnalysisSite_analysisId_status_idx" ON "AnalysisSite"("analysisId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSite_analysisId_siteId_key" ON "AnalysisSite"("analysisId", "siteId");

-- CreateIndex
CREATE INDEX "Page_analysisSiteId_idx" ON "Page"("analysisSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_analysisSiteId_url_key" ON "Page"("analysisSiteId", "url");

-- CreateIndex
CREATE INDEX "PdfDocument_analysisSiteId_ocrStatus_idx" ON "PdfDocument"("analysisSiteId", "ocrStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PdfDocument_analysisSiteId_url_key" ON "PdfDocument"("analysisSiteId", "url");

-- CreateIndex
CREATE INDEX "CrawlError_analysisSiteId_idx" ON "CrawlError"("analysisSiteId");

-- CreateIndex
CREATE INDEX "MailDelivery_analysisId_idx" ON "MailDelivery"("analysisId");

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSite" ADD CONSTRAINT "AnalysisSite_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSite" ADD CONSTRAINT "AnalysisSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_analysisSiteId_fkey" FOREIGN KEY ("analysisSiteId") REFERENCES "AnalysisSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfDocument" ADD CONSTRAINT "PdfDocument_analysisSiteId_fkey" FOREIGN KEY ("analysisSiteId") REFERENCES "AnalysisSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlError" ADD CONSTRAINT "CrawlError_analysisSiteId_fkey" FOREIGN KEY ("analysisSiteId") REFERENCES "AnalysisSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSite" ADD CONSTRAINT "ScheduleSite_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSite" ADD CONSTRAINT "ScheduleSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRecipient" ADD CONSTRAINT "ScheduleRecipient_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRecipient" ADD CONSTRAINT "ScheduleRecipient_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
