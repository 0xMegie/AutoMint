"use client";

import { useWallet } from "@/hooks/useWallet";
import {
  useRegistered,
  useProfile,
  useBots,
  useAccrualState,
  useClaim,
  useAmtBalance,
} from "@/hooks/useAccrual";
import { useAllBotDetails } from "@/hooks/useBotDetails";
import { getPendingPoints } from "@/lib/contracts";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { PointsCounter } from "@/components/dashboard/PointsCounter";
import ClaimButton from "@/components/dashboard/ClaimButton";
import BotCard from "@/components/dashboard/BotCard";
import RegistrationBanner from "@/components/dashboard/RegistrationBanner";
import UpgradePrompt from "@/components/dashboard/UpgradePrompt";
import { ErrorState } from "@/components/ui/ErrorState";
import { Wallet, Loader2, Bot } from "lucide-react";
import clsx from "clsx";
import type { BotNFT } from "@/types";
import { useReduceMotion } from "@/hooks/useReduceMotion";

export default function DashboardPage() {
  const { publicKey, isConnected, connect, isConnecting } = useWallet();
  const {
    data: isRegistered,
    isLoading: isCheckingRegistration,
    isError: isRegError,
    error: regError,
    refetch: refetchReg,
    isRefetching: isRegRefetching,
  } = useRegistered();

  const {
    data: profile,
    isError: isProfileError,
    error: profileError,
    refetch: refetchProfile,
    isRefetching: isProfileRefetching,
  } = useProfile();

  const {
    data: botIds,
    isError: isBotsError,
    error: botsError,
    refetch: refetchBots,
    isRefetching: isBotsRefetching,
  } = useBots();

  const {
    data: accrualState,
    isError: isAccrualError,
    error: accrualError,
    refetch: refetchAccrual,
    isRefetching: isAccrualRefetching,
  } = useAccrualState();

  const {
    data: bots,
    isError: isBotsDetailsError,
    error: botsDetailsError,
    refetch: refetchBotsDetails,
    isRefetching: isBotsDetailsRefetching,
  } = useAllBotDetails(botIds || []);

  const { data: amtBalance, isPending: isAmtBalancePending } = useAmtBalance();
  const claim = useClaim();

  const [pendingPoints, setPendingPoints] = useState<bigint>(BigInt(0));

  const reduceMotion = useReduceMotion();

  const isAnyError = isRegError || isProfileError || isBotsError || isAccrualError || isBotsDetailsError;
  const activeError = regError || profileError || botsError || accrualError || botsDetailsError;
  const isRetrying = isRegRefetching || isProfileRefetching || isBotsRefetching || isBotsDetailsRefetching;

  // Check if any query is loading
  const isLoading =
    isCheckingRegistration ||
    isProfileRefetching ||
    isBotsRefetching ||
    isBotsDetailsRefetching ||
    isAccrualRefetching ||
    isAmtBalancePending;

  const handleRetryAll = () => {
    refetchReg();
    refetchProfile();
    refetchBots();
    refetchAccrual();
    refetchBotsDetails();
  };

  // Calculate total accrual rate from bots
  const totalRate =
    bots?.reduce(
      (sum: number, bot: BotNFT) => sum + Number(bot.accrual_rate),
      0,
    ) || 0;

  // Fetch pending points when connected
  useEffect(() => {
    if (publicKey && isRegistered) {
      getPendingPoints(publicKey)
        .then(setPendingPoints)
        .catch(() => setPendingPoints(BigInt(0)));
    }
  }, [publicKey, isRegistered, accrualState]);

  // Handle claim
  const handleClaim = () => {
    claim.mutate(undefined, {
      onSuccess: () => {
        setPendingPoints(BigInt(0));
      },
    });
  };

  // Not connected state
  if (!isConnected) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-liner bg-card p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card-2">
            <Wallet className="h-8 w-8 text-muted" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-semibold text-text">
            Connect Your Wallet
          </h2>
          <p className="mt-2 text-sm text-muted">
            Connect your Freighter wallet to access your dashboard and manage your AI bot NFTs.
          </p>
          <button
            onClick={connect}
            disabled={isConnecting}
            className={clsx(
              "mt-6 flex items-center gap-2 rounded-xl bg-gold/10 px-6 py-3",
              "text-sm font-medium text-gold border border-gold/30",
              "transition-all hover:bg-gold/20 hover:border-gold/50",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4" aria-hidden="true" />
                Connect Wallet
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Loading state - show skeletons while queries are in flight
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column */}
          <div className="flex flex-col gap-6">
            <Skeleton className="rounded-2xl border border-liner bg-card p-5" reducedMotion>
              <Skeleton className="h-11 w-11 rounded-xl" reducedMotion />
              <Skeleton className="flex flex-col gap-2 reducedMotion">
                <Skeleton className="h-4 w-28" reducedMotion />
                <Skeleton className="h-3 w-16" reducedMotion />
              </Skeleton>
            </Skeleton>

            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>
              <Skeleton className="h-7 w-48 reducedMotion" />
            </Skeleton>

            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>

            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>
              <Skeleton className="h-7 w-48 reducedMotion" />
            </Skeleton>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6">
            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>

            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>

            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>

            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>
              <Skeleton className="h-12 w-12 items-center justify-center rounded-xl bg-card-2 reducedMotion" />
              <Skeleton className="mt-3 text-sm text-muted reducedMotion" />
            </Skeleton>
          </div>
        </div>
      </div>
    );
  }

  // Error state for registration or initial query failures
  if (isRegError) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <ErrorState
          error={regError}
          title="Failed to Load Account Status"
          message="Could not verify your registration status with the Soroban registry contract."
          onRetry={handleRetryAll}
          isRetrying={isRetrying}
          data-testid="dashboard-error-state"
        />
      </div>
    );
  }

  // Not registered state
  if (!isRegistered) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold text-text sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-sm text-muted">
            Manage your AI bot NFTs and track your earnings.
          </p>
          <div className="mt-6">
            <RegistrationBanner />
          </div>
        </div>
      </div>
    );
  }

  // Registered state - show dashboard with error handling for sub-queries
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-text sm:text-4xl">
          Welcome back, {profile?.username || "User"}!
        </h1>
        <p className="mt-2 text-sm text-muted">
          Track your points and manage your AI bot collection.
        </p>
      </div>

      {isAnyError && (
        <div className="mb-6">
          <ErrorState
            error={activeError}
            title="Partial Data Outage"
            message="Some dashboard metrics could not be synchronized with the Stellar network."
            onRetry={handleRetryAll}
            isRetrying={isRetrying}
            compact
            data-testid="dashboard-suberror-state"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Points Counter */}
          <PointsCounter
            points={isLoading ? BigInt(0) : Number(profile?.points || BigInt(0))}
            rate={isLoading ? 0 : totalRate}
            bots={isLoading ? [] : bots || []}
            amtBalance={isLoading ? BigInt(0) : amtBalance ?? BigInt(0)}
          />

          {/* Claim Button */}
          {pendingPoints > BigInt(0) && !isLoading && (
            <ClaimButton
              pendingPoints={pendingPoints}
              onClaim={handleClaim}
              isClaiming={claim.isPending}
            />
          )}

          {/* Upgrade Prompt */}
          <UpgradePrompt currentRate={totalRate} />
        </div>

        {/* Right column - Bot Grid */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-text">Your Bots</h2>
            <span className="text-sm text-muted">{isLoading ? loading... : bots?.length || 0} owned</span>
          </div>

          {isBotsError || isBotsDetailsError ? (
            <ErrorState
              error={botsError || botsDetailsError}
              title="Failed to Load Bots"
              message="Could not retrieve your NFT bots from the contract."
              onRetry={() => {
                refetchBots();
                refetchBotsDetails();
              }}
              isRetrying={isBotsRefetching || isBotsDetailsRefetching}
              compact
              data-testid="bots-error-state"
            />
          ) : isLoading ? (
            <Skeleton className="rounded-2xl border border-liner bg-card p-5 reducedMotion" reducedMotion>
              <Skeleton className="h-11 w-11 rounded-xl" reducedMotion />
              <Skeleton className="flex flex-col gap-2 reducedMotion">
                <Skeleton className="h-4 w-28" reducedMotion />
                <Skeleton className="h-3 w-16" reducedMotion />
              </Skeleton>
              <Skeleton className="h-6 w-16 rounded-full" reducedMotion />
            </Skeleton>
          ) : bots && bots.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {bots.map((bot: BotNFT) => (
                <BotCard key={bot.id.toString()} bot={bot} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-liner bg-card p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-card-2">
                <Bot className="h-6 w-6 text-muted" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm text-muted">
                No bots yet. Visit the marketplace to get started!
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}