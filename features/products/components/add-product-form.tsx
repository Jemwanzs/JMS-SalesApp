"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { createProductAction } from "@/features/products/actions/create-product";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createProductSchema, type CreateProductInput } from "@/validations/product";

export function AddProductForm({
  tenantId,
  tenantSlug,
}: {
  tenantId: string;
  tenantSlug: string;
}) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: { name: "", expectedPrice: "0", imageUrl: "" },
  });

  function onSubmit(values: CreateProductInput) {
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("expectedPrice", values.expectedPrice);
    formData.set("imageUrl", values.imageUrl);

    startTransition(async () => {
      const result = await createProductAction(tenantId, tenantSlug, {}, formData);

      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof CreateProductInput, { message });
        }
        return;
      }

      if (result.success) {
        form.reset({ name: "", expectedPrice: "0", imageUrl: "" });
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Product name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Coffee" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="expectedPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expected price</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="0.01" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="imageUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Image URL (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="https://" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Adding..." : "Add product"}
        </Button>
      </form>
    </Form>
  );
}
