"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { setSaleNumberTemplateAction } from "@/features/settings/actions/set-sale-number-template";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { previewSaleNumber, validateSaleNumberTemplate } from "@/lib/utils/sale-number-template";

const EXAMPLES = ["SALE-{YYYY}-{000001}", "{LOCATION}-{DDMMYYYY}-{00001}", "BRANCH-{YYYYMMDD}-{0001}"];

export function SaleNumberTemplateCard({
  tenantId,
  tenantSlug,
  initialTemplate,
  sampleLocationCode,
}: {
  tenantId: string;
  tenantSlug: string;
  initialTemplate: string;
  sampleLocationCode: string | null;
}) {
  const [template, setTemplate] = useState(initialTemplate);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (validateSaleNumberTemplate(template)) return null;
    return previewSaleNumber(template, { date: new Date(), locationCode: sampleLocationCode, sequence: 1 });
  }, [template, sampleLocationCode]);

  function onSave() {
    setError(null);
    const validationError = validateSaleNumberTemplate(template);
    if (validationError) {
      setError(validationError);
      return;
    }
    startTransition(async () => {
      const result = await setSaleNumberTemplateAction(tenantId, tenantSlug, template);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Sale number format saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sale number format</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="sale-number-template">Template</Label>
          <Input id="sale-number-template" value={template} onChange={(e) => setTemplate(e.target.value)} />
        </div>

        {preview && (
          <p className="text-sm text-muted-foreground">
            Preview: <span className="font-medium text-foreground">{preview}</span>
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setTemplate(example)}
              className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              {example}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Placeholders: {"{YYYY}"} {"{YY}"} {"{MM}"} {"{DD}"} {"{DDMMYYYY}"} {"{YYYYMMDD}"} {"{LOCATION}"}, plus a zero-padded sequence like{" "}
          {"{000001}"}.
        </p>

        <Button onClick={onSave} disabled={isPending || template === initialTemplate}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
