import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Blaze Downloader",
  description: "A high-performance multi-threaded concurrent download manager.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} font-sans h-full w-full antialiased overflow-hidden`}
    >
      <body className="h-screen w-screen flex flex-col overflow-hidden select-none">{children}</body>
    </html>
  );
}