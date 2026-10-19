// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import Navbar from "@/components/ui/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fit-Ah - AI-Powered Virtual Try-On",
  description: "Never buy the wrong size again with AI-powered size recommendations and virtual try-on",
};

// Safari / Chrome on phones tint their bars with this, so they blend into the cream pages
export const viewport: Viewport = { themeColor: '#F8F3EA' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
   return (
    <html lang="en">
      <head>
        <link rel="preload" href="/models/humanlatestwithshirt2.glb?v=1.0" as="fetch" crossOrigin="anonymous" />
      </head>
      <body className={inter.className}>
        <AuthProvider>
          <Navbar/>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}