"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { uploadImportAction } from "@/features/imports/actions/upload-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ImportType } from "@/types/database.types";

const TYPE_COPY: Record<ImportType, { title: string; templateLabel: string }> = {
  sales_history: { title: "Historical sales", templateLabel: "Download the sales history template" },
  products: { title: "Product catalog", templateLabel: "Download the products template" },
};

export function ImportUploadForm({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ImportType>("sales_history");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a file to upload");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);
    formData.set("type", type);

    startTransition(async () => {
      const result = await uploadImportAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/t/${tenantSlug}/imports/${result.importId}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk import</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={type} onValueChange={(v) => setType(v as ImportType)}>
          <TabsList>
            <TabsTrigger value="sales_history">Historical sales</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
          </TabsList>
        </Tabs>

        <a
          href={`/api/t/${tenantSlug}/imports/template?type=${type}`}
          className="block text-sm font-medium text-foreground underline"
        >
          {TYPE_COPY[type].templateLabel}
        </a>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="import-file">Upload completed file (.xlsx or .csv)</Label>
            <Input id="import-file" ref={fileInputRef} type="file" accept=".xlsx,.csv" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Uploading..." : "Upload & Validate"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
