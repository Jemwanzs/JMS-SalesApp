"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { requestPasswordResetAction } from "@/features/auth/actions/request-password-reset";
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
import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from "@/validations/auth";

export function RequestPasswordResetForm() {
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: "" },
  });

  function onSubmit(values: RequestPasswordResetInput) {
    const formData = new FormData();
    formData.set("email", values.email);

    setServerError(null);

    startTransition(async () => {
      const result = await requestPasswordResetAction({}, formData);

      if (result?.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(
            field as keyof RequestPasswordResetInput,
            { message }
          );
        }
        return;
      }

      if (result?.error) {
        setServerError(result.error);
        return;
      }

      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <p className="text-sm text-muted-foreground">
        If an account exists for that email, a password reset link is on its
        way. Check your inbox.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverError && (
          <p className="text-sm text-destructive">{serverError}</p>
        )}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Sending..." : "Send reset link"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground underline">
            Back to log in
          </Link>
        </p>
      </form>
    </Form>
  );
}
