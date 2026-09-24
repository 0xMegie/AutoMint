import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getActiveListings, getUserListings } from "@/lib/contracts";
import { executeTransaction, type TransactionStatus } from "@/lib/transaction";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Tier } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";

export function useBuyBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const MARKETPLACE_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID || "";

      return new Promise((resolve, reject) => {
        executeTransaction({
          contractId: MARKETPLACE_CONTRACT_ID,
          method: "buy_bot",
          args: [nativeToScVal(listingId, { type: "u128" })],
          sourceAddress: publicKey,
          onStatus: (status: TransactionStatus) => {
            switch (status.stage) {
              case "building":
              case "simulating":
              case "assembling":
                toast.loading("Preparing purchase transaction...", { id: "buy_bot" });
                break;
              case "signing":
                toast.loading("Waiting for wallet signature...", { id: "buy_bot" });
                break;
              case "submitting":
                toast.loading("Submitting purchase to blockchain...", { id: "buy_bot" });
                break;
              case "polling":
                toast.loading(
                  `Confirming on-chain... (${status.hash?.slice(0, 8)})`,
                  { id: "buy_bot" }
                );
                break;
              case "success":
                toast.success("Bot purchased successfully!", {
                  id: "buy_bot",
                  action: status.explorerUrl
                    ? {
                        label: "View",
                        onClick: () => window.open(status.explorerUrl, "_blank"),
                      }
                    : undefined,
                });
                resolve(status);
                break;
              case "error":
                toast.error(`Purchase failed: ${status.error || "Unknown error"}`, {
                  id: "buy_bot",
                });
                reject(new Error(status.error || "Purchase failed"));
                break;
            }
          },
        }).catch(reject);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
    onError: (error: Error) => {
      // onStatus callback already handles error toasts
      console.error("Bot purchase failed:", error);
    },
  });
}

export function useMintTierBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async ({ tier, token }: { tier: Tier; token: string }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const BOT_NFT_CONTRACT_ID = process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID || "";

      return new Promise((resolve, reject) => {
        executeTransaction({
          contractId: BOT_NFT_CONTRACT_ID,
          method: "mint_tier",
          args: [
            nativeToScVal(publicKey, { type: "address" }),
            xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tier)]),
            nativeToScVal(token, { type: "address" }),
          ],
          sourceAddress: publicKey,
          onStatus: (status: TransactionStatus) => {
            switch (status.stage) {
              case "building":
              case "simulating":
              case "assembling":
                toast.loading("Preparing mint transaction...", { id: "mint_tier" });
                break;
              case "signing":
                toast.loading("Waiting for wallet signature...", { id: "mint_tier" });
                break;
              case "submitting":
                toast.loading("Submitting mint to blockchain...", { id: "mint_tier" });
                break;
              case "polling":
                toast.loading(
                  `Confirming on-chain... (${status.hash?.slice(0, 8)})`,
                  { id: "mint_tier" }
                );
                break;
              case "success":
                toast.success("Tier bot minted successfully!", {
                  id: "mint_tier",
                  action: status.explorerUrl
                    ? {
                        label: "View",
                        onClick: () => window.open(status.explorerUrl, "_blank"),
                      }
                    : undefined,
                });
                resolve(status);
                break;
              case "error":
                toast.error(`Mint failed: ${status.error || "Unknown error"}`, {
                  id: "mint_tier",
                });
                reject(new Error(status.error || "Mint failed"));
                break;
            }
          },
        }).catch(reject);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
    onError: (error: Error) => {
      // onStatus callback already handles error toasts
      console.error("Bot mint failed:", error);
    },
  });
}

export function useListings() {
  return useQuery({
    queryKey: qk.listings(),
    queryFn: () => getActiveListings(),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

export function useMyListings() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery({
    queryKey: qk.myListings(publicKey),
    queryFn: () => (publicKey ? getUserListings(publicKey) : Promise.resolve([])),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

export function useListBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async ({ botId, price }: { botId: bigint; price: bigint }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const MARKETPLACE_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID || "";

      return new Promise((resolve, reject) => {
        executeTransaction({
          contractId: MARKETPLACE_CONTRACT_ID,
          method: "list_bot",
          args: [
            nativeToScVal(botId, { type: "u128" }),
            nativeToScVal(price, { type: "u128" }),
          ],
          sourceAddress: publicKey,
          onStatus: (status: TransactionStatus) => {
            switch (status.stage) {
              case "building":
              case "simulating":
              case "assembling":
                toast.loading("Preparing listing transaction...", { id: "list_bot" });
                break;
              case "signing":
                toast.loading("Waiting for wallet signature...", { id: "list_bot" });
                break;
              case "submitting":
                toast.loading("Submitting listing to blockchain...", {
                  id: "list_bot",
                });
                break;
              case "polling":
                toast.loading(
                  `Confirming on-chain... (${status.hash?.slice(0, 8)})`,
                  { id: "list_bot" }
                );
                break;
              case "success":
                toast.success("Bot listed successfully!", {
                  id: "list_bot",
                  action: status.explorerUrl
                    ? {
                        label: "View",
                        onClick: () => window.open(status.explorerUrl, "_blank"),
                      }
                    : undefined,
                });
                resolve(status);
                break;
              case "error":
                toast.error(`Listing failed: ${status.error || "Unknown error"}`, {
                  id: "list_bot",
                });
                reject(new Error(status.error || "Listing failed"));
                break;
            }
          },
        }).catch(reject);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
    },
    onError: (error: Error) => {
      // onStatus callback already handles error toasts
      console.error("Bot listing failed:", error);
    },
  });
}

export function useCancelListing() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const MARKETPLACE_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID || "";

      return new Promise((resolve, reject) => {
        executeTransaction({
          contractId: MARKETPLACE_CONTRACT_ID,
          method: "cancel_listing",
          args: [nativeToScVal(listingId, { type: "u128" })],
          sourceAddress: publicKey,
          onStatus: (status: TransactionStatus) => {
            switch (status.stage) {
              case "building":
              case "simulating":
              case "assembling":
                toast.loading("Preparing cancel transaction...", { id: "cancel_listing" });
                break;
              case "signing":
                toast.loading("Waiting for wallet signature...", { id: "cancel_listing" });
                break;
              case "submitting":
                toast.loading("Submitting cancellation to blockchain...", {
                  id: "cancel_listing",
                });
                break;
              case "polling":
                toast.loading(
                  `Confirming on-chain... (${status.hash?.slice(0, 8)})`,
                  { id: "cancel_listing" }
                );
                break;
              case "success":
                toast.success("Listing cancelled successfully!", {
                  id: "cancel_listing",
                  action: status.explorerUrl
                    ? {
                        label: "View",
                        onClick: () => window.open(status.explorerUrl, "_blank"),
                      }
                    : undefined,
                });
                resolve(status);
                break;
              case "error":
                toast.error(`Cancellation failed: ${status.error || "Unknown error"}`, {
                  id: "cancel_listing",
                });
                reject(new Error(status.error || "Cancellation failed"));
                break;
            }
          },
        }).catch(reject);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
    },
    onError: (error: Error) => {
      // onStatus callback already handles error toasts
      console.error("Listing cancellation failed:", error);
    },
  });
}
