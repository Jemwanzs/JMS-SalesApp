"use client";

import { ChevronDown } from "lucide-react";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * Security page's sign-in activity/session cards default to collapsed --
 * they're audit-trail detail, not something a user needs open on every
 * visit, and a tenant with a lot of activity made the page feel long.
 * `meta` (e.g. a row count) stays visible in the header even collapsed,
 * so there's still an at-a-glance signal of whether it's worth expanding.
 */
export function CollapsibleCard({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-(--card-spacing) text-left">
          <CardTitle>{title}</CardTitle>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {meta}
            <ChevronDown className="h-4 w-4 transition-transform group-data-open:rotate-180" />
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <CardContent className="space-y-3">{children}</CardContent>
        </CollapsiblePanel>
      </Collapsible>
    </Card>
  );
}
