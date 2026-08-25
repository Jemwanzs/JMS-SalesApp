"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { signInAction, type LoginActionState } from "@/features/auth/actions/sign-in";
import { AUTH_INPUT_CLASS } from "@/features/auth/components/auth-input-class";
import { RequestTemporaryAccessForm } from "@/features/auth/components/request-temporary-access-form";
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
import { loginSchema, type LoginInput } from "@/validations/auth";

/**
 * Best-effort, short-timeout geolocation read -- resolves to nulls on
 * denial/unavailability/timeout rather than ever blocking the submit.
 * The gate itself (AuthService.evaluateAccessGate) treats missing
 * coordinates as a geofence block only when the tenant has geo-fencing
 * turned on at all; every other tenant never notices this ran.
 */
function readGeolocation(): Promise<{ latitude: number | null; longitude: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({ latitude: null, longitude: null }),
      { timeout: 5000, maximumAge: 60_000 }
    );
  });
}

export function LoginForm() {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<LoginActionState["blockedBy"]>(undefined);
  const [attempted, setAttempted] = useState<{
    email: string;
    password: string;
    latitude: number | null;
    longitude: number | null;
  } | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  function onSubmit(values: LoginInput) {
    setServerError(null);
    setBlockedBy(undefined);

    startTransition(async () => {
      const { latitude, longitude } = await readGeolocation();

      const formData = new FormData();
      formData.set("email", values.email);
      formData.set("password", values.password);
      if (latitude != null) formData.set("latitude", String(latitude));
      if (longitude != null) formData.set("longitude", String(longitude));

      const result = await signInAction({}, formData);

      if (!result) return;

      if (result.error) {
        setServerError(result.error);
        setBlockedBy(result.blockedBy);
        if (result.blockedBy === "geofence") {
          setAttempted({ email: values.email, password: values.password, latitude, longitude });
        }
      }

      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof LoginInput, { message });
        }
      }
    });
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
                <Input type="email" autoComplete="email" className={AUTH_INPUT_CLASS} {...field} />
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
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <Link
                  href="/reset-password"
                  className="text-sm text-muted-foreground underline"
                >
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  className={AUTH_INPUT_CLASS}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverError && (
          <p className="text-sm text-destructive">{serverError}</p>
        )}

        {blockedBy === "geofence" && attempted && (
          <RequestTemporaryAccessForm
            email={attempted.email}
            password={attempted.password}
            latitude={attempted.latitude}
            longitude={attempted.longitude}
          />
        )}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Logging in..." : "Log in"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-foreground underline">
            Sign up
          </Link>
        </p>
      </form>
    </Form>
  );
}
