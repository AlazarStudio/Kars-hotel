-- Hotel gallery: an ordered list of image URLs shown as a slider on the
-- partner-facing hotel page (Kars Avia «Общая информация»). The first element
-- is the cover / main image. Replaces the single logo as the hero media source.
ALTER TABLE "tenant"
  ADD COLUMN "gallery_photos" JSONB NOT NULL DEFAULT '[]';
