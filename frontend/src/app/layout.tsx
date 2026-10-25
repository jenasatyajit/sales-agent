import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pitch Simulator",
  description: "Voice roleplay & pitch coaching against skeptical B2B buyer personas",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider>
            <SidebarProvider>
              {/* usePathname in the sidebar is runtime data under Cache Components */}
              <Suspense fallback={null}>
                <AppSidebar />
              </Suspense>
              <SidebarInset>
                <header className="flex h-12 shrink-0 items-center gap-2 border-b">
                  <div className="flex items-center gap-2 px-3">
                    <SidebarTrigger />
                    <Separator
                      orientation="vertical"
                      className="mr-1 data-[orientation=vertical]:h-4"
                    />
                  </div>
                </header>
                <main className="flex-1">{children}</main>
              </SidebarInset>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
