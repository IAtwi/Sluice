import { CONFIG } from '../config.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Options {
  /** Overrides CONFIG.http.retries. Writes should pass 0. */
  retries?: number;
}

/**
 * fetch with a timeout and bounded retries.
 * Retries only transient conditions (network failure, 5xx, 429). Never retries 4xx.
 */
export async function request(url: string, init: RequestInit = {}, opts: Options = {}): Promise<Response> {
  const retries = opts.retries ?? CONFIG.http.retries;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(CONFIG.http.retryDelayMs * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.http.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'User-Agent': CONFIG.http.userAgent, ...(init.headers ?? {}) },
      });
      if (res.status >= 500 || res.status === 429) {
        const body = await res.text().catch(() => '');
        lastError = new HttpError(res.status, body, `HTTP ${res.status} from ${url}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function requestJson<T>(url: string, init: RequestInit = {}, opts: Options = {}): Promise<T> {
  const res = await request(url, init, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, text, `HTTP ${res.status} from ${url}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}
