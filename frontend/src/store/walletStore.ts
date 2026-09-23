import { create } from "zustand";

export type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WalletState {
  status: WalletStatus;
  publicKey: string | null;
  network: string | null;
  networkMismatch: boolean;
  error: string | null;
  setConnecting: () => void;
  setConnected: (publicKey: string, network: string) => void;
  setNetworkMismatch: (mismatch: boolean) => void;
  setError: (error: string) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  status: "disconnected",
  publicKey: null,
  network: null,
  networkMismatch: false,
  error: null,
  setConnecting: () => set({ status: "connecting", error: null }),
  setConnected: (publicKey, network) =>
    set({ status: "connected", publicKey, network, error: null }),
  setNetworkMismatch: (mismatch) => set({ networkMismatch: mismatch }),
  setError: (error) => set({ status: "error", error }),
  disconnect: () =>
    set({ status: "disconnected", publicKey: null, network: null, networkMismatch: false, error: null }),
}));

/**
 * Named atomic selectors.
 *
 * Every call site reads store state through one of these instead of an
 * inline arrow with a hand-written parameter type. Two reasons:
 *
 *  1. **Type safety.** An inline `(s: { publicKey: string | null }) => s.publicKey`
 *     duplicates part of `WalletState` and silently drifts from it when the
 *     store changes. These selectors are typed against `WalletState` itself,
 *     so a rename or a type change is a compile error at every call site.
 *  2. **Render cost.** Each selector returns a single primitive (or a stable
 *     action reference), so zustand's default `Object.is` comparison only
 *     re-renders a subscriber when that exact value changes. Selecting an
 *     object literal — or subscribing to the whole store by calling
 *     `useWalletStore()` with no selector — re-renders every consumer on
 *     every unrelated state change.
 */
export const selectStatus = (s: WalletState): WalletStatus => s.status;
export const selectPublicKey = (s: WalletState): string | null => s.publicKey;
export const selectNetwork = (s: WalletState): string | null => s.network;
export const selectNetworkMismatch = (s: WalletState): boolean => s.networkMismatch;
export const selectError = (s: WalletState): string | null => s.error;

/**
 * Action selectors. Actions are created once by the store initializer and
 * never replaced, so subscribing to one never triggers a re-render.
 */
export const selectSetConnecting = (s: WalletState) => s.setConnecting;
export const selectSetConnected = (s: WalletState) => s.setConnected;
export const selectSetNetworkMismatch = (s: WalletState) => s.setNetworkMismatch;
export const selectSetError = (s: WalletState) => s.setError;
export const selectDisconnect = (s: WalletState) => s.disconnect;
