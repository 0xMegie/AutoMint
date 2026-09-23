const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Response && error.status === 429) return true;

  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("too many requests")
  );
}

function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof Response) {
    const header = error.headers.get("Retry-After");
    if (header) {
      const seconds = Number(header);
      if (!Number.isNaN(seconds)) return seconds * 1_000;
    }
  }
  return null;
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const serverDelay = getRetryAfterMs(error);
      const backoffDelay = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * 500;
      const delay = (serverDelay ?? backoffDelay) + jitter;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
