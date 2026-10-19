import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CashDaddy — Get Paid For The Fun Stuff",
  description:
    "Join CashDaddy and get paid for the fun stuff: surveys, app trials, videos and mini-tasks. Cash out your earnings anytime.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-screen flex-col overflow-x-hidden">
        <div className="blob -top-32 -left-24 h-72 w-72 bg-indigo-300" />
        <div className="blob -top-24 right-0 h-64 w-64 bg-pink-300" />
        <AuthProvider>
          <Navbar />
          <main className="relative flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
