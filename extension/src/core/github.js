const API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, code = 'GITHUB_ERROR') {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.code = code;
  }
}

export class RateLimitError extends GitHubError {
  constructor(message, resetAt) {
    super(message, 403, 'RATE_LIMITED');
    this.name = 'RateLimitError';
    this.resetAt = resetAt ?? null;
  }
}

let lastRate = { remaining: null, limit: null, resetAt: null };

export function getLastRate() {
  return lastRate;
}

function readRate(headers) {
  const remaining = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  const reset = headers.get('x-ratelimit-reset');
  lastRate = {
    remaining: remaining === null ? null : Number(remaining),
    limit: limit === null ? null : Number(limit),
    resetAt: reset ? Number(reset) * 1000 : null,
  };
  return lastRate;
}

export function createClient(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request(path, { etag } = {}) {
    const requestHeaders = { ...headers };
    if (etag) requestHeaders['If-None-Match'] = etag;

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
    } catch (error) {
      throw new GitHubError(`网络请求失败：${error.message}`, 0, 'NETWORK');
    }

    const rate = readRate(response.headers);

    if (response.status === 304) {
      return { notModified: true, data: null, etag: etag ?? null, rate };
    }

    if (response.status === 403 || response.status === 429) {
      if (rate.remaining === 0 || response.status === 429) {
        throw new RateLimitError(
          rate.resetAt
            ? `GitHub 额度已用完，${new Date(rate.resetAt).toLocaleTimeString('zh-CN')} 重置`
            : 'GitHub 触发限流，请稍后再试',
          rate.resetAt,
        );
      }
    }

    if (response.status === 404) {
      throw new GitHubError('仓库不存在或已删除', 404, 'NOT_FOUND');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new GitHubError(text.slice(0, 200) || `GitHub 返回 ${response.status}`, response.status);
    }

    const data = await response.json();
    return { notModified: false, data, etag: response.headers.get('etag'), rate };
  }

  return {
    async getRepo(fullName, etag) {
      return request(`/repos/${fullName}`, { etag });
    },
    async getReadme(fullName) {
      const readmeHeaders = { ...headers, Accept: 'application/vnd.github.raw' };
      const response = await fetch(`${API_BASE}/repos/${fullName}/readme`, {
        headers: readmeHeaders,
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
      if (response.status === 404) return '';
      if (!response.ok) return '';
      return response.text();
    },
    async search(query, { perPage = 50, sort = 'stars' } = {}) {
      const params = new URLSearchParams({
        q: query,
        per_page: String(perPage),
        sort,
        order: 'desc',
      });
      const result = await request(`/search/repositories?${params.toString()}`);
      return result.data ?? { total_count: 0, items: [] };
    },
  };
}
