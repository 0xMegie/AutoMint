import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useBuyBot,
  useMintTierBot,
  useListings,
  useMyListings,
  useListBot,
  useCancelListing,
} from '../hooks/useMarketplace';
import {
  buyBot,
  mintTierBot,
  getActiveListings,
  getUserListings,
  listBot,
  cancelListing,
} from '@/lib/contracts';
import { useWalletStore } from '@/store/walletStore';
import { toast } from 'sonner';

// Mock dependencies
jest.mock('@/lib/contracts');
jest.mock('@/store/walletStore', () => ({
  ...jest.requireActual('@/store/walletStore'),
  useWalletStore: jest.fn(),
}));
jest.mock('sonner');

const mockBuyBot = buyBot as jest.MockedFunction<typeof buyBot>;
const mockMintTierBot = mintTierBot as jest.MockedFunction<typeof mintTierBot>;
const mockGetActiveListings = getActiveListings as jest.MockedFunction<typeof getActiveListings>;
const mockGetUserListings = getUserListings as jest.MockedFunction<typeof getUserListings>;
const mockListBot = listBot as jest.MockedFunction<typeof listBot>;
const mockCancelListing = cancelListing as jest.MockedFunction<typeof cancelListing>;
const mockUseWalletStore = useWalletStore as jest.MockedFunction<typeof useWalletStore>;

describe('useMarketplace Hooks', () => {
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

    // Default wallet store mock
    (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({ publicKey: mockPublicKey })
    );
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useBuyBot', () => {
    it('should successfully purchase a bot', async () => {
      mockBuyBot.mockResolvedValue('tx_hash');

      const { result } = renderHook(() => useBuyBot(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockBuyBot).toHaveBeenCalledWith(mockPublicKey, 1n);
      expect(toast.success).toHaveBeenCalledWith('Bot purchased successfully!');
    });

    it('should handle error when purchasing bot fails', async () => {
      const error = new Error('Insufficient funds');
      mockBuyBot.mockRejectedValue(error);

      const { result } = renderHook(() => useBuyBot(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Insufficient funds');
    });

    it('should throw error when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useBuyBot(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(new Error('Wallet not connected'));
    });
  });

  describe('useMintTierBot', () => {
    it('should successfully mint a tier bot', async () => {
      mockMintTierBot.mockResolvedValue(1n);

      const { result } = renderHook(() => useMintTierBot(), { wrapper });

      act(() => {
        result.current.mutate({ tier: 'Advanced', token: 'TOKEN_ADDRESS' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockMintTierBot).toHaveBeenCalledWith(mockPublicKey, 'Advanced', 'TOKEN_ADDRESS');
      expect(toast.success).toHaveBeenCalledWith('Tier bot minted successfully!');
    });

    it('should handle error when minting fails', async () => {
      const error = new Error('Minting failed');
      mockMintTierBot.mockRejectedValue(error);

      const { result } = renderHook(() => useMintTierBot(), { wrapper });

      act(() => {
        result.current.mutate({ tier: 'Premium', token: 'TOKEN_ADDRESS' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(toast.error).toHaveBeenCalledWith('Minting failed');
    });
  });

  describe('useListings', () => {
    it('should return loading state initially', () => {
      mockGetActiveListings.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useListings(), { wrapper });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();
    });

    it('should successfully fetch active listings', async () => {
      const mockListings = [
        { id: 1n, seller: 'SELLER1', botId: 1n, price: 100n, isActive: true },
        { id: 2n, seller: 'SELLER2', botId: 2n, price: 200n, isActive: true },
      ];

      mockGetActiveListings.mockResolvedValue(mockListings);

      const { result } = renderHook(() => useListings(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockListings);
    });

    it('should handle error when fetching listings fails', async () => {
      const error = new Error('Failed to fetch listings');
      mockGetActiveListings.mockRejectedValue(error);

      const { result } = renderHook(() => useListings(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useMyListings', () => {
    it('should fetch user listings when wallet connected', async () => {
      const mockListings = [
        { id: 1n, seller: mockPublicKey, botId: 1n, price: 100n, isActive: true },
      ];

      mockGetUserListings.mockResolvedValue(mockListings);

      const { result } = renderHook(() => useMyListings(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockGetUserListings).toHaveBeenCalledWith(mockPublicKey);
      expect(result.current.data).toEqual(mockListings);
    });

    it('should return empty array when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useMyListings(), { wrapper });

      expect(result.current.data).toBeUndefined();
    });
  });

  describe('useListBot', () => {
    it('should successfully list a bot', async () => {
      mockListBot.mockResolvedValue(1n);

      const { result } = renderHook(() => useListBot(), { wrapper });

      act(() => {
        result.current.mutate({ botId: 1n, price: 500n });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockListBot).toHaveBeenCalledWith(mockPublicKey, 1n, 500n);
      expect(toast.success).toHaveBeenCalledWith('Bot listed successfully!');
    });

    it('should handle error when listing fails', async () => {
      const error = new Error('Listing failed');
      mockListBot.mockRejectedValue(error);

      const { result } = renderHook(() => useListBot(), { wrapper });

      act(() => {
        result.current.mutate({ botId: 1n, price: 500n });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(toast.error).toHaveBeenCalledWith('Listing failed');
    });
  });

  describe('useCancelListing', () => {
    it('should successfully cancel a listing', async () => {
      mockCancelListing.mockResolvedValue('tx_hash');

      const { result } = renderHook(() => useCancelListing(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockCancelListing).toHaveBeenCalledWith(mockPublicKey, 1n);
      expect(toast.success).toHaveBeenCalledWith('Listing cancelled successfully!');
    });

    it('should handle error when canceling fails', async () => {
      const error = new Error('Cancel failed');
      mockCancelListing.mockRejectedValue(error);

      const { result } = renderHook(() => useCancelListing(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(toast.error).toHaveBeenCalledWith('Cancel failed');
    });
  });
});
