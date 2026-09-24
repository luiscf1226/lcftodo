import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ThemeSync } from "@/components/ThemeSync";
import { clerkLocalization } from "@/lib/clerkLocalization";
import { ONBOARDING_PATH } from "@/lib/routes";
import { THEME_COLORS, themeInitScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Icons come from the file conventions next to this layout: icon.svg, favicon.ico, apple-icon.png.
export const metadata: Metadata = {
  title: "LCF Todos",
  description: "Daily and weekly todos for your team.",
  applicationName: "LCF Todos",
  appleWebApp: { capable: true, title: "LCF Todos", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script sets data-theme / .dark before first paint, so React must accept the DOM's values.
    <html
      lang="en"
      data-theme="system"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full font-sans">
        <ThemeSync />
        {/* Pending sessions (signed in, no team yet) complete Clerk's choose-organization task on our page. */}
        <ClerkProvider taskUrls={{ "choose-organization": ONBOARDING_PATH }} localization={clerkLocalization}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
