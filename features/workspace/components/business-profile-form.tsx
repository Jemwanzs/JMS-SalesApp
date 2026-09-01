"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateBusinessProfileAction } from "@/features/workspace/actions/update-business-profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CURRENCIES,
  TIMEZONES,
} from "@/validations/onboarding";
import {
  businessProfileSchema,
  type BusinessProfileInput,
} from "@/validations/workspace";

/**
 * Same fields onboarding's BusinessDetailsStep captures (plus the
 * business name, which onboarding already knows from sign-up and
 * never re-asks for) -- pre-filled with what's actually saved, not the
 * wizard's blank/default starting values, since this is an edit, not a
 * first-time setup.
 */
export function BusinessProfileForm({
  tenantId,
  tenantSlug,
  initial,
}: {
  tenantId: string;
  tenantSlug: string;
  initial: BusinessProfileInput;
}) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<BusinessProfileInput>({
    resolver: zodResolver(businessProfileSchema),
    defaultValues: initial,
  });

  function onSubmit(values: BusinessProfileInput) {
    const formData = new FormData();
    formData.set("businessName", values.businessName);
    formData.set("businessType", values.businessType);
    formData.set("website", values.website ?? "");
    formData.set("anniversaryDate", values.anniversaryDate ?? "");
    formData.set("currency", values.currency);
    formData.set("timezone", values.timezone);

    startTransition(async () => {
      const result = await updateBusinessProfileAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof BusinessProfileInput, { message });
        }
        return;
      }

      if (result.success) {
        toast.success("Business profile updated");
      }
    });
  }

  return (
    <Card data-tour-id="workspace-business-profile">
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="businessName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="businessType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Restaurant, Retail shop" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="anniversaryDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business anniversary (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time zone</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
