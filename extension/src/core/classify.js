import { CATEGORIES } from './defaults.js';

const CJK = /[\u4e00-\u9fff]/;

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
}

/**
 * 规则分类：
 * - 名称完整命中 4 分，名称单词命中 2 分
 * - topics 命中 3 分
 * - 描述命中 0.5 分（描述噪声大，权重最低）
 * 同分时保持 CATEGORIES 顺序，稳定可预测。
 */
export function classify(repo, categories = CATEGORIES) {
  const name = String(repo.name ?? '').toLowerCase();
  const description = String(repo.description ?? '').toLowerCase();
  const topics = (repo.topics ?? []).map((topic) => String(topic).toLowerCase());
  const topicText = topics.join(' ');
  const nameTokens = new Set(tokenize(repo.name));

  const scored = categories
    .filter((category) => category.slug !== 'other')
    .map((category) => {
      let score = 0;
      const matched = [];

      for (const rawKeyword of category.keywords) {
        const keyword = rawKeyword.toLowerCase();
        if (!keyword) continue;
        let hit = 0;

        if (name.includes(keyword)) {
          hit = 4;
        } else if (!CJK.test(keyword)) {
          const words = tokenize(keyword).filter((word) => word.length >= 4);
          if (words.some((word) => nameTokens.has(word))) hit = 2;
        }

        if (hit < 3 && topicText.includes(keyword)) hit = 3;
        if (hit === 0 && description.includes(keyword)) hit = 0.5;

        if (hit > 0) {
          score += hit;
          matched.push(rawKeyword);
        }
      }

      return { category, score, matched };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { slug: 'other', name: '其他', confidence: 0, matched: [], source: 'rule' };
  }

  const best = scored[0];
  const second = scored[1]?.score ?? 0;
  const confidence = Math.min(0.95, best.score / (best.score + second + 2));

  return {
    slug: best.category.slug,
    name: best.category.name,
    confidence: Number(confidence.toFixed(2)),
    matched: best.matched.slice(0, 5),
    source: 'rule',
  };
}
