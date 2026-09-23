import { useWalletStore } from "../store/walletStore";

describe("walletStore", () => {
  beforeEach(() => {
    useWalletStore.setState({
      status: "disconnected",
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
    });
  });

  test("setConnecting updates state correctly", () => {
    useWalletStore.setState({ status: "disconnected", publicKey: null, network: null, networkMismatch: false, error: null });
    useWalletStore.getState().setConnecting();
    const state = useWalletStore.getState();
    expect(state.status).toBe("connecting");
    expect(state.error).toBeNull();
  });

  test("setConnected updates state correctly", () => {
    useWalletStore.setState({
      status: "disconnected",
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
    });
    useWalletStore.getState().setConnected("0x123", "testnet");
    const state = useWalletStore.getState();
    expect(state.status).toBe("connected");
    expect(state.publicKey).toBe("0x123");
    expect(state.network).toBe("testnet");
    expect(state.error).toBeNull();
  });

  test("setError updates state correctly", () => {
    useWalletStore.setState({
      status: "disconnected",
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
    });
    useWalletStore.getState().setError("Connection failed");
    const state = useWalletStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("Connection failed");
  });

  test("disconnect resets state correctly", () => {
    useWalletStore.setState({
      status: "disconnected",
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
    });
    useWalletStore.getState().setConnected("0x123", "testnet");
    useWalletStore.getState().disconnect();
    const state = useWalletStore.getState();
    expect(state.status).toBe("disconnected");
    expect(state.publicKey).toBeNull();
    expect(state.network).toBeNull();
    expect(state.networkMismatch).toBe(false);
    expect(state.error).toBeNull();
  });
});