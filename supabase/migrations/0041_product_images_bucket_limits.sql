-- Hardening roadmap Phase 2.2 (docs/22-hardening-roadmap.md, security
-- finding #3): the product-images bucket (migration 0007) has never set
-- allowed_mime_types/file_size_limit -- the 5MB cap and image/* MIME
-- check in product-image-upload.tsx are client-side JS only, trivially
-- bypassed by calling the Storage API directly with the caller's own
-- (valid, products.edit-scoped) JWT. Setting both here is enforced by
-- Supabase Storage itself, server-side, regardless of what the client
-- claims -- no app-code change needed for this half of the fix.
--
-- Matches the client's own 5MB limit exactly (product-image-upload.tsx's
-- MAX_BYTES) rather than loosening it. SVG is deliberately excluded from
-- the allowed types even though it's a common "image/*" format -- an SVG
-- can embed a <script>, and this bucket is public with no signed-URL
-- indirection (0007's own documented trade-off), so serving one back
-- verbatim would be a real, avoidable XSS surface for no real product
-- need (product photos are never meant to be vector graphics here).

update storage.buckets
set
  file_size_limit = 5242880, -- 5 MiB, matches product-image-upload.tsx's MAX_BYTES
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'product-images';
