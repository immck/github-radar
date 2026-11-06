import { dbGet, dbPut, STORES } from './db.js';

export const PROMPT_VERSION = 'v1';

export const SCORE_DIMENSIONS = [
  { key: 'demand', label: '需求强度', weight: 25 },
  { key: 'competition', label: '竞争格局', weight: 20 },
  { key: 'monetization', label: '变现路径', weight: 20 },
  { key: 'moat', label: '技术壁垒', weight: 15 },
  { key: 'cost', label: '落地成本', weight: 10 },
  { key: 'timing', label: '时机', weight: 10 },
];

const SYSTEM_PROMPT = `你是一名谨慎的开源项目商业分析师。你只能基于用户提供的仓库元数据与 README 摘要做判断。
硬性规则：
1. 不得编造市场规模、竞品价格、融资额、用户数量等无法从材料中得出的事实。
2. 信息不足时字段必须写 "未知"，不要用合理猜测填充。
3. 所有结论必须标注依据；没有依据的判断降低置信度。
4. 只输出一个 JSON 对象，不要 markdown 代码块，不要额外解释。
5. 商业价值评分是估算，不是事实；score 必须是 0-100 的整数，confidence 必须是 0-1 的小数。`;

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function buildPrompt(repo, readme = '') {
  const facts = {
    full_name: repo.fullName,
    description: repo.description || '无',
    language: repo.language || '未知',
    topics: repo.topics ?? [],
    stars: repo.stars,
    forks: repo.forks,
    open_issues: repo.issues,
    license: repo.license || '未声明',
    created_at: repo.createdAtGithub ? new Date(repo.createdAtGithub).toISOString().slice(0, 10) : '未知',
    pushed_at: repo.pushedAtGithub ? new Date(repo.pushedAtGithub).toISOString().slice(0, 10) : '未知',
    homepage: repo.homepage || '无',
  };

  return `请分析以下 GitHub 开源项目，并按指定 JSON 结构输出。

## 项目事实（来自 GitHub API）
${JSON.stringify(facts, null, 2)}

## README 摘要（可能为空，仅作为材料）
${readme ? clip(readme, 6000) : '（未获取到 README）'}

## 输出 JSON 结构
{
  "summaryZh": "一句话中文说明项目做什么（不超过 60 字）",
  "problem": "项目解决的具体问题；信息不足写 未知",
  "targetUsers": ["目标用户1", "目标用户2"],
  "marketSignals": ["能从材料中看到的真实需求信号；没有就给空数组"],
  "monetization": ["可能的盈利模式；没有依据的写 未知"],
  "competitors": [{"name": "竞品名", "difference": "差异化；不确定写 未知"}],
  "maturity": "技术成熟度评估（依据 star/issue/更新时间/文档）",
  "devEffort": "二次开发难度与主要原因",
  "reusable": ["可直接复用的模块或能力"],
  "missing": ["做成产品还缺的功能"],
  "infraCost": "GPU / API / 存储等基础设施成本判断；不确定写 未知",
  "mvp": "推荐的 MVP 方向（一句话）",
  "risks": ["商业化风险，至少 1 条"],
  "score": 0,
  "confidence": 0.0,
  "scoreBreakdown": [
    {"key": "demand", "score": 0, "reason": "依据"},
    {"key": "competition", "score": 0, "reason": "依据"},
    {"key": "monetization", "score": 0, "reason": "依据"},
    {"key": "moat", "score": 0, "reason": "依据"},
    {"key": "cost", "score": 0, "reason": "依据"},
    {"key": "timing", "score": 0, "reason": "依据"}
  ],
  "evidence": ["支撑上述判断的材料出处，例如 README 中的某句话或某个指标"],
  "unknowns": ["信息不足、无法判断的项"]
}

评分维度固定为：需求强度、竞争格局、变现路径、技术壁垒、落地成本、时机。每个维度 0-100 分，reason 必须说明依据。总分 score 是加权估算。`;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.3;
  return Math.max(0, Math.min(1, number));
}

export function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI 返回的不是 JSON 对象');
  }

  const breakdown = Array.isArray(raw.scoreBreakdown)
    ? raw.scoreBreakdown
        .map((item) => {
          const key = typeof item?.key === 'string' ? item.key : '';
          const dimension = SCORE_DIMENSIONS.find((entry) => entry.key === key);
          if (!dimension) return null;
          const score = clampScore(item?.score);
          if (score === null) return null;
          return {
            key,
            label: dimension.label,
            weight: dimension.weight,
            score,
            reason: typeof item?.reason === 'string' ? item.reason.trim() : '未知',
          };
        })
        .filter(Boolean)
    : [];

  const competitors = Array.isArray(raw.competitors)
    ? raw.competitors
        .map((item) =>
          typeof item === 'string'
            ? { name: item, difference: '未知' }
            : {
                name: typeof item?.name === 'string' ? item.name : '未知',
                difference: typeof item?.difference === 'string' ? item.difference : '未知',
              },
        )
        .slice(0, 8)
    : [];

  return {
    summaryZh: typeof raw.summaryZh === 'string' ? raw.summaryZh.trim() : '',
    problem: typeof raw.problem === 'string' ? raw.problem.trim() : '未知',
    targetUsers: asStringArray(raw.targetUsers),
    marketSignals: asStringArray(raw.marketSignals),
    monetization: asStringArray(raw.monetization),
    competitors,
    maturity: typeof raw.maturity === 'string' ? raw.maturity.trim() : '未知',
    devEffort: typeof raw.devEffort === 'string' ? raw.devEffort.trim() : '未知',
    reusable: asStringArray(raw.reusable),
    missing: asStringArray(raw.missing),
    infraCost: typeof raw.infraCost === 'string' ? raw.infraCost.trim() : '未知',
    mvp: typeof raw.mvp === 'string' ? raw.mvp.trim() : '未知',
    risks: asStringArray(raw.risks),
    score: clampScore(raw.score),
    confidence: clampConfidence(raw.confidence),
    scoreBreakdown: breakdown,
    evidence: asStringArray(raw.evidence),
    unknowns: asStringArray(raw.unknowns),
    estimated: true,
  };
}

function extractJson(text) {
  const cleaned = String(text ?? '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 响应中没有 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function analyzeRepository(repo, settings, readme = '') {
  if (!settings.aiEnabled) throw new Error('未启用 AI 分析，请先在设置中开启');
  if (!settings.aiApiKey) throw new Error('未配置 AI API Key');
  if (!settings.aiBaseUrl) throw new Error('未配置 AI Base URL');

  const base = settings.aiBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.aiModel || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(repo, readme) },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AI 接口返回 ${response.status}：${text.slice(0, 160) || response.statusText}`);
  }

  const payload = await response.json();
  const message = payload?.choices?.[0]?.message?.content ?? '';
  const content = Array.isArray(message)
    ? message.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    : message;
  const parsed = extractJson(content);
  const analysis = normalizeAnalysis(parsed);

  const record = {
    repoId: repo.id,
    model: settings.aiModel || 'unknown',
    promptVersion: PROMPT_VERSION,
    createdAt: Date.now(),
    analysis,
  };
  await dbPut(STORES.analyses, record);
  return record;
}

export async function getAnalysis(repoId) {
  return dbGet(STORES.analyses, repoId);
}
