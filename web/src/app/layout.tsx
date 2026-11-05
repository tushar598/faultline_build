import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Header } from "@/components/shell/Header";
import { Sidebar } from "@/components/shell/Sidebar";
import { TxPanel } from "@/components/shell/TxPanel";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Faultline dashboard",
  description: "Parametric earthquake bond on Hedera: bond status, loss index, challenge window and holder values, read from the chain and HCS.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <Providers>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 md:px-8">{children}</main>
            </div>
          </div>
          <TxPanel />
        </Providers>
      </body>
    </html>
  );
}
