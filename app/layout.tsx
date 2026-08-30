import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Lato, Outfit, Poppins, Roboto } from "next/font/google";
import "./globals.css";

import { CookieConsentBanner } from "@/components/shared/cookie-consent-banner";
import { DisableContextMenu } from "@/components/shared/disable-context-menu";
import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { Toaster } from "@/components/ui/sonner";

// Self-hosted via next/font (downloaded at build time, served from our
// own origin) -- no external font CDN request at runtime. Variable name
// must be --font-sans to match app/globals.css's @theme inline mapping;
// the previous --font-geist-sans name didn't match it, so the loaded
// font was silently never applied and the app was falling back to the
// browser default sans stack the whole time.
//
// User & Tenant Branding Personalization: Inter/Roboto/Poppins/Lato
// added alongside Outfit (still the default) for the per-user font
// preference. All five are always loaded here and exposed as CSS
// variables -- next/font/google requires the font list to be a
// build-time static import, so "pick one of five" has to mean "load
// all five, swap which variable --font-sans points to," not a
// per-request dynamic fetch.
//
// Deliberately loaded here (this root layout stays fully static -- no
// cookies/DB read, so /login, /signup, and the marketing pages keep
// prerendering the way they already did) but the actual WHICH-font
// decision is resolved lower down, in app/(tenant)/t/[tenantSlug]/
// layout.tsx and the platform-admin layout -- both are already
// per-request dynamic (they read the session to resolve the tenant/
// admin), so that's where a cookie-dependent lookup belongs. Each sets
// its own data-font attribute on its own app-shell wrapper rather than
// on <html> here, since only ONE component owns <html> and it can't be
// this one without forcing every route in the app to become dynamic
// just to support a preference that only ever applies to a signed-in
// user's own authenticated screens anyway.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const FONT_VARIABLES = `${outfit.variable} ${inter.variable} ${roboto.variable} ${poppins.variable} ${lato.variable} ${geistMono.variable}`;

export const metadata: Metadata = {
  title: "JMS Sales App",
  description:
    "Mobile-first, multi-tenant sales records & analytics platform.",
};

export const viewport: Viewport = {
  themeColor: "#10786A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${FONT_VARIABLES} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
        <ServiceWorkerRegistration />
        <DisableContextMenu />
        <CookieConsentBanner />
      </body>
    </html>
  );
}
