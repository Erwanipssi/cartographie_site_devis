-- Accessibilité des PDF : balisage, titre (et sa pertinence), langue déclarée
ALTER TABLE "PdfDocument" ADD COLUMN "tagged" BOOLEAN,
ADD COLUMN "title" TEXT,
ADD COLUMN "titleStatus" TEXT,
ADD COLUMN "lang" TEXT;
