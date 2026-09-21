const RASTER_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface RasterImage {
  dataUrl: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Fetches a tenant logo (a Supabase Storage public URL) and converts it
 * to a base64 data URL for jsPDF's `addImage()`, which needs raw image
 * data, not a remote URL. No image-embedding utility existed anywhere
 * in this codebase before this (confirmed via repo-wide grep for
 * `addImage`/`toDataURL`) -- every existing logo display is a plain
 * `<img src={logo_url}>`.
 *
 * Returns null on ANY failure (network error, non-raster mime type,
 * decode failure) rather than throwing -- a broken/unsupported logo
 * must never block receipt generation, only fall it back to text-only
 * branding. jsPDF's `addImage()` does not support SVG, and the tenant
 * logo upload flow (features/workspace/components/logo-upload.tsx)
 * allows SVG uploads, so an SVG logo is a real, expected "skip" case,
 * not just an error path.
 */
export async function fetchImageAsDataUrl(url: string): Promise<RasterImage | null> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (!RASTER_MIME_TYPES.has(blob.type)) return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = dataUrl;
    });

    return { dataUrl, mimeType: blob.type, widthPx: dimensions.width, heightPx: dimensions.height };
  } catch {
    return null;
  }
}
