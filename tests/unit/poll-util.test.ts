import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollForCompletion } from '../../src/media/generators/poll-util.js';

// Mock logger
vi.mock('../../src/util/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function mockFetchResponse(status: number, body: any, ok?: boolean) {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('pollForCompletion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should return URL when isComplete returns true', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse(200, { status: 'done', url: 'https://cdn.example.com/result.png' })
    );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/123',
      headers: { Authorization: 'Bearer test' },
      isComplete: (data) => data.status === 'done',
      isFailed: () => null,
      getResultUrl: (data) => data.url,
      interval: 100,
      maxAttempts: 5,
      label: 'TestAPI',
    });

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe('https://cdn.example.com/result.png');
  });

  it('should throw when isFailed returns an error message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse(200, { status: 'failed', error: 'content policy violation' })
    );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/123',
      headers: {},
      isComplete: () => false,
      isFailed: (data) => data.error || null,
      getResultUrl: () => '',
      interval: 100,
      maxAttempts: 5,
      label: 'TestAPI',
    });

    // Attach the catch handler BEFORE advancing timers to avoid unhandled rejection
    const resultPromise = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(100);
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('TestAPI generation failed: content policy violation');
  });

  it('should throw timeout error when maxAttempts reached', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse(200, { status: 'processing' })
    );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/123',
      headers: {},
      isComplete: () => false,
      isFailed: () => null,
      getResultUrl: () => '',
      interval: 100,
      maxAttempts: 3,
      label: 'TestAPI',
    });

    const resultPromise = promise.catch((err: Error) => err);

    // Advance through all 3 attempts
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('TestAPI generation timed out after 0.3s');
  });

  it('should throw immediately on 4xx error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse(400, {}, false)
    );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/123',
      headers: {},
      isComplete: () => false,
      isFailed: () => null,
      getResultUrl: () => '',
      interval: 100,
      maxAttempts: 5,
      label: 'TestAPI',
    });

    const resultPromise = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(100);
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('TestAPI API error: 400');
  });

  it('should continue polling on 5xx error', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;

    // First call: 500 error, second call: success
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse(500, {}, false))
      .mockResolvedValueOnce(
        mockFetchResponse(200, { status: 'done', url: 'https://cdn.example.com/result.png' })
      );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/123',
      headers: {},
      isComplete: (data) => data.status === 'done',
      isFailed: () => null,
      getResultUrl: (data) => data.url,
      interval: 100,
      maxAttempts: 5,
      label: 'TestAPI',
    });

    // First attempt - 500 error, should continue
    await vi.advanceTimersByTimeAsync(100);
    // Second attempt - success
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe('https://cdn.example.com/result.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should use default interval and maxAttempts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse(200, { done: true, url: 'https://result.com/x' })
    );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/1',
      headers: {},
      isComplete: (data) => data.done,
      isFailed: () => null,
      getResultUrl: (data) => data.url,
    });

    // Default interval is 5000ms
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result).toBe('https://result.com/x');
  });

  it('should handle 404 as a 4xx error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse(404, {}, false)
    );

    const promise = pollForCompletion({
      statusUrl: 'https://api.example.com/status/missing',
      headers: {},
      isComplete: () => false,
      isFailed: () => null,
      getResultUrl: () => '',
      interval: 100,
      maxAttempts: 3,
      label: 'ImageGen',
    });

    const resultPromise = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(100);
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('ImageGen API error: 404');
  });
});
