"use client";

import { useState } from "react";
import Image from "next/image";
import { Expand } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Shared square, rounded product thumbnail + "view photo" affordance,
 * used identically on the sales-capture grid and the product management
 * list so a product looks the same size everywhere (product enhancement
 * batch, see docs/20-development-progress.md). Tapping the small expand
 * badge opens the image full-size in a dialog; tapping the thumbnail
 * itself is left to the caller (the capture grid uses that tap to select
 * the product for a sale, so the expand badge has to be a separate
 * target with stopPropagation, not a click on the image itself).
 */
export const PRODUCT_THUMBNAIL_CLASSES = "h-20 w-20 rounded-2xl";

export function ProductPhotoThumbnail({
  imageUrl,
  productName,
  showName,
  className,
}: {
  imageUrl: string | null;
  productName: string;
  showName: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-muted ${PRODUCT_THUMBNAIL_CLASSES} ${className ?? ""}`}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={productName}
          width={80}
          height={80}
          className="h-full w-full object-cover"
          unoptimized
        />
      ) : (
        <span className="text-2xl">🛒</span>
      )}

      {imageUrl && (
        <ProductPhotoViewer imageUrl={imageUrl} productName={productName} showName={showName}>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
            aria-label="View photo"
          >
            <Expand className="h-3.5 w-3.5" />
          </button>
        </ProductPhotoViewer>
      )}
    </div>
  );
}

function ProductPhotoViewer({
  imageUrl,
  productName,
  showName,
  children,
}: {
  imageUrl: string;
  productName: string;
  showName: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent showCloseButton>
        <DialogTitle className="sr-only">{productName} photo</DialogTitle>
        <div className="overflow-hidden rounded-xl">
          <Image
            src={imageUrl}
            alt={productName}
            width={640}
            height={640}
            className="h-full w-full object-cover"
            unoptimized
          />
        </div>
        {showName && (
          <p className="text-center text-sm font-medium text-foreground">{productName}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
