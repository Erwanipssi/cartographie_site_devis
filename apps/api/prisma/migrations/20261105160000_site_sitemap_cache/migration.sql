-- Dernière version lue du sitemap, réutilisée quand le sitemap du site est indisponible
ALTER TABLE "Site" ADD COLUMN "sitemapUrls" JSONB,
ADD COLUMN "sitemapReadAt" TIMESTAMP(3);
