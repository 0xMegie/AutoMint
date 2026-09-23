import { Skeleton } from "@/components/ui/Skeleton";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useAllBotDetails } from "@/hooks/useBotDetails";
import { useAmtBalance } from "@/hooks/useAmtBalance";
import { useBots } from "@/hooks/useBots";
import { useProfile } from "@/hooks/useProfile";
import { useRegistered } from "@/hooks/useRegistered";
import { useWallet } from "@/hooks/useWallet";

export default function DashboardLoading() {
  const { isConnected } = useWallet();
  const {
    isCheckingRegistration,
    isRefetching: isRegRefetching,
  } = useRegistered();

  const {
    isRefetching: isProfileRefetching,
  } = useProfile();

  const {
    isBots,
    isBotsRefetching,
    isBotsError,
  } = useBots();

  const {
    isRefetching: isAccrualRefetching,
    isError: isAccrualError,
  } = useAccrualState();

  const {
    isRefetching: isBotsDetailsRefetching,
    isError: isBotsDetailsError,
  } = useAllBotDetails();

  const {
    isPending: isAmtBalancePending,
  } = useAmtBalance();

  const reducedMotion = useReduceMotion();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex min-h-[400px] items-center justify-center rounded-2xl border border-liner bg-card p-12">
        <Skeleton
          className={reducedMotion ? "h-16 w-16 rounded-2xl bg-card-2" : "h-16 w-16 rounded-2xl bg-card-2 animate-pulse"}
        />
        <Skeleton className={reducedMotion ? "mt-4 h-4 w-48" : "mt-4 h-4 w-48 animate-pulse"} />
      </div>

      {isConnected && !isCheckingRegistration && !isProfileRefetching ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column */}
          <div className="flex flex-col gap-6">
            <Skeleton
              className="rounded-2xl border border-liner bg-card p-5"
              reducedMotion
            >
              <Skeleton className="h-11 w-11 rounded-xl" reducedMotion />
              <Skeleton className="flex flex-col gap-2 reducedMotion">
                <Skeleton className="h-4 w-28" reducedMotion />
                <Skeleton className="h-3 w-16" reducedMotion />
              </S>