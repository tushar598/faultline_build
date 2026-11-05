"use client";
import type { ReactNode } from "react";
import { DataProvider } from "@/state/data";
import { NetworkProvider } from "@/state/network";
import { WalletProvider } from "@/state/wallet";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <WalletProvider>
        <DataProvider>{children}</DataProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}
