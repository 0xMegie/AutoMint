import { useCallback, useEffect } from "react";
import { requestAccess, getAddress, getNetwork } from "@stellar/freighter-api";
import { toast } from "sonner";
import {
  useWalletStore,
  selectStatus,
  selectPublicKey,
  selectNetwork,
  selectNetworkMismatch,
  selectError,
  selectSetConnecting,
  selectSetConnected,
  selectSetNetworkMismatch,
  selectSetError,
  selectDisconnect,
} from "@/store/walletStore";
import { STELLAR_NETWORK_PASSPHRASE } from "@/lib/constants";

const FREIGHTER_DOWNLOAD_URL = "https://freighter.app";

function isFreighterInstalled(): boolean {
  return typeof window !== "undefined" && "freighter" in window;
}

/**
 * Connection state and actions for the Freighter wallet.
 *
 * Subscribes atomically to only the three state fields its consumers render
 * (`status`, `publicKey`, `networkMismatch`) rather than to the whole store.
 * `network` and `error` are deliberately absent: nothing that renders the
 * header or the dashboard displays them, so subscribing to them here would
 * re-render every consumer whenever a failed connection attempt sets an
 * error message. Read them with {@link useWalletNetwork} and
 * {@link useWalletError} in the components that actually show them.
 */
export function useWallet() {
  const status = useWalletStore(selectStatus);
  const publicKey = useWalletStore(selectPublicKey);
  const networkMismatch = useWalletStore(selectNetworkMismatch);

  const setConnecting = useWalletStore(selectSetConnecting);
  const setConnected = useWalletStore(selectSetConnected);
  const setNetworkMismatch = useWalletStore(selectSetNetworkMismatch);
  const setError = useWalletStore(selectSetError);
  const disconnect = useWalletStore(selectDisconnect);

  const isConnecting = status === "connecting";
  const isNotInstalled = !isFreighterInstalled();

  const connect = useCallback(async () => {
    if (!isFreighterInstalled()) {
      toast.error("Freighter wallet is not installed", {
        action: {
          label: "Install Freighter",
          onClick: () => window.open(FREIGHTER_DOWNLOAD_URL, "_blank"),
        },
        duration: 8000,
      });
      window.open(FREIGHTER_DOWNLOAD_URL, "_blank");
      return;
    }

    // Guard: if already connecting, ignore duplicate requests (#532)
    if (status === "connecting") return;

    setConnecting();
    toast.loading("Connecting wallet...", { id: "wallet-connect" });

    try {
      await requestAccess();
      const { address: pk } = await getAddress();
      const net = await getNetwork();
      setConnected(pk, net.networkPassphrase);

      const isMismatch = net.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE;
      setNetworkMismatch(isMismatch);
      if (isMismatch) {
        toast.warning(
          `Network mismatch — Freighter is on a different network. Please switch to Testnet.`,
          { id: "wallet-connect", duration: 8000 },
        );
      } else {
        toast.success("Wallet connected!", { id: "wallet-connect" });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      toast.error(message, { id: "wallet-connect" });
    }
  }, [status, setConnecting, setConnected, setNetworkMismatch, setError]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    toast.success("Wallet disconnected");
  }, [disconnect]);

  useEffect(() => {
    if (status !== "connected") return;

    const checkNetwork = async () => {
      try {
        const net = await getNetwork();
        setNetworkMismatch(net.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE);
      } catch {
        // Freighter locked or uninstalled — ignore
      }
    };

    const id = setInterval(checkNetwork, 30_000);
    window.addEventListener("focus", checkNetwork);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", checkNetwork);
    };
  }, [status, setNetworkMismatch]);

  return {
    status,
    publicKey,
    networkMismatch,
    connect,
    disconnect: disconnectWallet,
    isConnected: status === "connected",
    isConnecting,
    isNotInstalled,
  };
}

/** The network passphrase Freighter reports, or `null` when disconnected. */
export function useWalletNetwork(): string | null {
  return useWalletStore(selectNetwork);
}

/** The last connection error message, or `null` when there is none. */
export function useWalletError(): string | null {
  return useWalletStore(selectError);
}
