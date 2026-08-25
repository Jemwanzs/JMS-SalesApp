/**
 * Shared by LoginForm and SignUpForm only (not the rest of the app's
 * shared Input component, and not the other auth forms like reset-
 * password) -- explicit request to make the login/signup fields easy to
 * spot against the warm-cream auth card (app/(auth)/layout.tsx), whose
 * bg-background is close enough in tone to the default transparent
 * input that the field edges were hard to see. Fill sits between the
 * card's cream and pure white (warmer than white, lighter than cream)
 * so the box reads as a distinct surface; border is orange for a clear,
 * unambiguous "type here" affordance.
 */
export const AUTH_INPUT_CLASS =
  "border-2 border-orange-400 bg-[#fefcf8] focus-visible:border-orange-500 focus-visible:ring-orange-500/30 dark:border-orange-400/70 dark:bg-[#241f18]";
