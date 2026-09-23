import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useRegister,
  useRegistered,
  useProfile,
  useBots,
  useAccrualState,
  useAmtBalance,
  useClaim,
  useAnimatedPoints,
} from '../hooks/useAccrual';
import {
  registerUser,
  mintBasicBot,
  startAccrual,
  isRegistered,
  getUserProfile,
  getUserBots,
  getAccrualState,
  getAmtBalance,
  claimPoints,
} from '@/lib/contracts';
import { useWalletStore } from '@/store/walletStore';
import { toast } from 'sonner';
import type { UserProfile, AccrualState } from '@/types';

// Mock dependencies
jest.mock('@/lib/contracts');
jest.mock('@/store/walletStore', () => ({
  ...jest.requireActual('@/store/walletStore'),
  useWalletStore: jest.fn(),
}));
jest.mock('sonner');

const mockRegisterUser = registerUser as jest.MockedFunction<typeof registerUser>;
const mockMintBasicBot = mintBasicBot as jest.MockedFunction<typeof mintBasicBot>;
const mockStartAccrual = startAccrual as jest.MockedFunction<typeof startAccrual>;
const mockIsRegistered = isRegistered as jest.MockedFunction<typeof isRegistered>;
const mockGetUserProfile = getUserProfile as jest.MockedFunction<typeof getUserProfile>;
const mockGetUserBots = getUserBots as jest.MockedFunction<typeof getUserBots>;
const mockGetAccrualState = getAccrualState as jest.MockedFunction<typeof getAccrualState>;
const mockGetAmtBalance = getAmtBalance as jest.MockedFunction<typeof getAmtBalance>;
const mockClaimPoints = claimPoints as jest.MockedFunction<typeof claimPoints>;
const mockUseWalletStore = useWalletStore as jest.MockedFunction<typeof useWalletStore>;

describe('useAccrual Hooks', () => {
  let queryClient: QueryClient;
  const mockPublicKey = 'GABC123456';

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default wallet store mock
    (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({ publicKey: mockPublicKey })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useRegister', () => {
    it('should successfully register a user', async () => {
      mockRegisterUser.mockResolvedValue('tx1');
      mockMintBasicBot.mockResolvedValue(1n);
      mockStartAccrual.mockResolvedValue('tx3');

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockRegisterUser).toHaveBeenCalledWith(mockPublicKey, 'testuser');
      expect(mockMintBasicBot).toHaveBeenCalledWith(mockPublicKey);
      expect(mockStartAccrual).toHaveBeenCalledWith(mockPublicKey, 1);
      expect(toast.success).toHaveBeenCalledWith('Registration complete! Welcome to AutoMint!');
    });

    it('should handle registration failure', async () => {
      const error = new Error('Registration failed');
      mockRegisterUser.mockRejectedValue(error);

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Registration failed');
    });

    it('should throw error when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(new Error('Wallet not connected'));
    });
  });

  describe('useRegistered', () => {
    it('should return true when user is registered', async () => {
      mockIsRegistered.mockResolvedValue(true);

      const { result } = renderHook(() => useRegistered(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(true);
      expect(mockIsRegistered).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should return false when user is not registered', async () => {
      mockIsRegistered.mockResolvedValue(false);

      const { result } = renderHook(() => useRegistered(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(false);
    });

    it('should handle error when check fails', async () => {
      const error = new Error('Check failed');
      mockIsRegistered.mockRejectedValue(error);

      const { result } = renderHook(() => useRegistered(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });

    it('should not fetch when wallet not connected', () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useRegistered(), { wrapper });

      expect(result.current.data).toBeUndefined();
      expect(mockIsRegistered).not.toHaveBeenCalled();
    });
  });

  describe('useProfile', () => {
    it('should return user profile when available', async () => {
      const mockProfile: UserProfile = {
        address: mockPublicKey,
        username: 'testuser',
        points: 1000n,
        claimedAmt: 500n,
        registeredAt: 1234567890n,
        botCount: 3,
      };

      mockGetUserProfile.mockResolvedValue(mockProfile);

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockProfile);
      expect(mockGetUserProfile).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should handle error when fetching profile fails', async () => {
      const error = new Error('Profile not found');
      mockGetUserProfile.mockRejectedValue(error);

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useBots', () => {
    it('should return bot IDs', async () => {
      const mockBots = [1n, 2n, 3n];
      mockGetUserBots.mockResolvedValue(mockBots);

      const { result } = renderHook(() => useBots(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockBots);
      expect(mockGetUserBots).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should return empty array when no bots', async () => {
      mockGetUserBots.mockResolvedValue([]);

      const { result } = renderHook(() => useBots(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });
  });

  describe('useAccrualState', () => {
    it('should return accrual state', async () => {
      const mockState: AccrualState = {
        last_claim_ts: 1234567890n,
        total_claimed_points: 1000n,
      };

      mockGetAccrualState.mockResolvedValue(mockState);

      const { result } = renderHook(() => useAccrualState(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockState);
      expect(mockGetAccrualState).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should handle null accrual state', async () => {
      mockGetAccrualState.mockResolvedValue(null);

      const { result } = renderHook(() => useAccrualState(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeNull();
    });
  });

  describe('useAmtBalance', () => {
    it('should return AMT balance', async () => {
      const mockBalance = 5000n;
      mockGetAmtBalance.mockResolvedValue(mockBalance);

      const { result } = renderHook(() => useAmtBalance(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockBalance);
      expect(mockGetAmtBalance).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should handle error when fetching balance fails', async () => {
      const error = new Error('Balance fetch failed');
      mockGetAmtBalance.mockRejectedValue(error);

      const { result } = renderHook(() => useAmtBalance(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useClaim', () => {
    it('should successfully claim points', async () => {
      mockClaimPoints.mockResolvedValue('tx_hash');

      const { result } = renderHook(() => useClaim(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockClaimPoints).toHaveBeenCalledWith(mockPublicKey);
      expect(toast.success).toHaveBeenCalledWith('Points claimed successfully!');
    });

    it('should handle error when claiming fails', async () => {
      const error = new Error('Claim failed');
      mockClaimPoints.mockRejectedValue(error);

      const { result } = renderHook(() => useClaim(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Claim failed');
    });

    it('should throw error when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useClaim(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(new Error('Wallet not connected'));
    });
  });
});

describe('useAnimatedPoints (#491)', () => {
  let qc: QueryClient;
  const pk = 'GABCUSER';

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.clearAllMocks();
    jest.useFakeTimers();
    (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({ publicKey: pk })
    );
  });
  afterEach(() => jest.useRealTimers());

  const wrap = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it('bases the headline on the registry lifetime total plus pending, with the carry shown separately', async () => {
    const lastClaim = Math.floor(Date.now() / 1000) - 3600; // one hour ago
    mockGetUserProfile.mockResolvedValue({ username: 'u', points: 12_345n });
    mockGetAccrualState.mockResolvedValue({
      last_claim_ts: BigInt(lastClaim),
      total_claimed_points: 42n, // the sub-threshold carry, NOT a lifetime total
    });

    const { result } = renderHook(() => useAnimatedPoints(1), { wrapper: wrap });

    // Waiting on the composite total also waits for profile (12,345) and the
    // interpolated pending (1 point at rate 1/hr over 3600s) to settle.
    await waitFor(() => {
      expect(result.current.total).toBe(12_346n);
    });
    expect(result.current.pending).toBe(1n);
    // The carry is surfaced separately as "progress to next AMT" — it is NOT
    // folded into the headline, which is the bug (#491).
    expect(result.current.progressToNext).toBe(42n);
  });

  it('never renders a total below the registry lifetime points across a claim', async () => {
    // Immediately after a claim: last_claim_ts is now, carry reset to a few.
    mockGetUserProfile.mockResolvedValue({ username: 'u', points: 1000n });
    mockGetAccrualState.mockResolvedValue({
      last_claim_ts: BigInt(Math.floor(Date.now() / 1000)),
      total_claimed_points: 3n,
    });

    const { result } = renderHook(() => useAnimatedPoints(1), { wrapper: wrap });

    await waitFor(() => expect(result.current.total).toBe(1000n));
    expect(result.current.total).toBeGreaterThanOrEqual(1000n);
  });
});
