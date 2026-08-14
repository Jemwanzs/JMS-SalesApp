import type { Metadata } from "next";
import { Geist_Mono, Outfit } from "next/font/google";
import "./globals.css";

// Self-hosted via next/font (downloaded at build time, served from our
// own origin) -- no external font CDN request at runtime. Variable name
// must be --font-sans to match app/globals.css's @theme inline mapping;
// the previous --font-geist-sans name didn't match it, so the loaded
// font was silently never applied and the app was falling back to the
// browser default sans stack the whole time.
const outfit = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JMS Sales App",
  description:
    "Mobile-first, multi-tenant sales records & analytics platform.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
