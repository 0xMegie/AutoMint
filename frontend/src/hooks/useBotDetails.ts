import { useQuery } from "@tanstack/react-query";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { getBotById } from "@/lib/contracts";
import { ANONYMOUS_READ_SOURCE } from "@/lib/constants";
import type { BotNFT } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { qk, STALE_TIME, GC_TIME } from "@/lib/queryKeys";

export function useBotDetails(botId: bigint) {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<BotNFT | null>({
    queryKey: qk.botDetails(publicKey, botId),
    queryFn: () => (publicKey ? getBotById(publicKey, botId) : Promise.resolve(null)),
    enabled: !!publicKey && botId > BigInt(0),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}

export function useAllBotDetails(botIds: bigint[]) {
  const publicKey = useWalletStore(selectPublicKey);
  // Bot ownership details are public data. Fall back to the configured
  // anonymous read source so disconnected visitors still see bot tier/rate
  // on the marketplace; the dashboard always has a wallet and is unaffected.
  const source = publicKey ?? ANONYMOUS_READ_SOURCE;

  return useQuery<BotNFT[]>({
    queryKey: qk.allBotDetails(publicKey, botIds),
    queryFn: async () => {
      if (!source || botIds.length === 0) return [];
      const bots = await Promise.all(
        botIds.map((id) => getBotById(source, id))
      );
      return bots.filter((bot): bot is BotNFT => bot !== null);
    },
    enabled: !!source && botIds.length > 0,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}
