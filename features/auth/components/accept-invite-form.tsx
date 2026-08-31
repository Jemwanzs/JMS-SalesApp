"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { acceptInviteAction } from "@/features/auth/actions/accept-invite";
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
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { acceptInviteSchema, type AcceptInviteInput } from "@/validations/auth";

export function AcceptInviteForm({
  membershipId,
  tenantId,
  tenantSlug,
  tenantName,
  roleName,
  email,
  initialFullName,
}: {
  membershipId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  roleName: string | null;
  email: string;
  initialFullName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { fullName: initialFullName, password: "", confirmPassword: "" },
  });

  function onSubmit(values: AcceptInviteInput) {
    setServerError(null);

    const formData = new FormData();
    formData.set("fullName", values.fullName);
    formData.set("password", values.password);
    formData.set("confirmPassword", values.confirmPassword);

    startTransition(async () => {
      const result = await acceptInviteAction(tenantId, tenantSlug, membershipId, {}, formData);

      if (!result) return;

      if (result.error) {
        setServerError(result.error);
      }

      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof AcceptInviteInput, { message });
        }
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Email</Label>
        <p className="text-sm">{email}</p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Role</Label>
        <p className="text-sm">{roleName ?? "—"}</p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Business</Label>
        <p className="text-sm">{tenantName}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 border-t pt-4">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Setting up..." : "Complete setup"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
