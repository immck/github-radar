/**
 * 默认分类与关键词。
 * keyword 全部小写；规则分类时对 name / description / topics 做包含匹配。
 */
export const CATEGORIES = [
  {
    slug: 'ai-video',
    name: 'AI 视频',
    keywords: ['text-to-video', 'image-to-video', 'video generation', 'video editing', 'sora', 'animatediff', 'digital human', 'lip sync', '文生视频', '图生视频', '视频生成'],
    children: ['文生视频', '图生视频', '视频编辑', '数字人', '视频工作流'],
  },
  {
    slug: 'ai-image',
    name: 'AI 图片',
    keywords: ['text-to-image', 'image generation', 'stable diffusion', 'diffusion', 'inpainting', 'image editing', 'upscale', 'comfyui', '文生图', '图像生成', 'ai 绘画'],
    children: ['文生图', '图像编辑', '图片增强', 'AI 绘画', '图像工作流'],
  },
  {
    slug: 'ai-coding',
    name: 'AI 编程',
    keywords: ['coding agent', 'code agent', 'ai ide', 'code completion', 'copilot', 'code review', 'code generation', 'pair programming', 'claude code', 'ai 编程', '代码补全'],
    children: ['Coding Agent', 'AI IDE', '代码补全', '代码审查', '自动化开发'],
  },
  {
    slug: 'ai-agent',
    name: 'AI Agent',
    keywords: ['agent framework', 'autonomous agent', 'multi-agent', 'mcp', 'model context protocol', 'tool use', 'function calling', 'ai agent', '智能体'],
    children: ['Autonomous Agent', 'MCP', '多 Agent 协作', 'Agent Framework', '工作流自动化'],
  },
  {
    slug: 'ai-writing',
    name: 'AI 写作',
    keywords: ['writing', 'copywriting', 'content generation', 'summarize', 'translation', 'ai writer', '写作', '内容生成', '翻译'],
    children: [],
  },
  {
    slug: 'ai-music',
    name: 'AI 音乐',
    keywords: ['music generation', 'text-to-music', 'audio generation', 'suno', 'musicgen', 'tts', 'voice clone', '音乐生成', '音频生成'],
    children: [],
  },
  {
    slug: 'ai-voice',
    name: 'AI 语音',
    keywords: ['text-to-speech', 'speech synthesis', 'speech recognition', 'asr', 'tts', 'voice cloning', 'whisper', '语音识别', '语音合成'],
    children: [],
  },
  {
    slug: 'ai-model',
    name: 'AI 模型',
    keywords: ['llm', 'language model', 'transformer', 'fine-tuning', 'lora', 'inference', 'quantization', 'pytorch', '大模型', '模型训练', '微调'],
    children: [],
  },
  {
    slug: 'ai-automation',
    name: 'AI 自动化',
    keywords: ['automation', 'rpa', 'browser automation', 'workflow', 'n8n', 'zapier', 'scraping', '自动化', '工作流'],
    children: [],
  },
  {
    slug: 'dev-tools',
    name: '开发工具',
    keywords: ['cli', 'developer tool', 'devtool', 'build tool', 'bundler', 'linter', 'formatter', 'terminal', 'shell', 'monitoring', '开发工具', '命令行'],
    children: [],
  },
  {
    slug: 'frontend',
    name: '前端开发',
    keywords: ['react', 'vue', 'svelte', 'nextjs', 'next.js', 'tailwind', 'css', 'ui library', 'component library', 'frontend', '前端', '组件库'],
    children: [],
  },
  {
    slug: 'backend',
    name: '后端开发',
    keywords: ['backend', 'server', 'api', 'graphql', 'grpc', 'microservice', 'fastapi', 'nestjs', '后端', '服务端'],
    children: [],
  },
  {
    slug: 'database',
    name: '数据库',
    keywords: ['database', 'sql', 'nosql', 'postgres', 'mysql', 'sqlite', 'redis', 'vector database', 'orm', '数据库'],
    children: [],
  },
  {
    slug: 'data-analysis',
    name: '数据分析',
    keywords: ['data analysis', 'analytics', 'visualization', 'dashboard', 'pandas', 'etl', 'bi', '数据分析', '可视化'],
    children: [],
  },
  {
    slug: 'web3',
    name: 'Web3 / Blockchain',
    keywords: ['blockchain', 'web3', 'ethereum', 'evm', 'smart contract', 'wallet', 'solidity', '区块链', '智能合约', '钱包'],
    children: ['区块链基础设施', 'Solana', 'EVM', '钱包工具', '链上数据分析'],
  },
  {
    slug: 'defi',
    name: 'DeFi',
    keywords: ['defi', 'dex', 'amm', 'lending', 'yield', 'liquidity', 'staking', 'swap', '去中心化金融', '流动性'],
    children: [],
  },
  {
    slug: 'solana',
    name: 'Solana',
    keywords: ['solana', 'anchor', 'spl token'],
    children: [],
  },
  {
    slug: 'gamedev',
    name: '游戏开发',
    keywords: ['game engine', 'gamedev', 'unity', 'godot', 'unreal', 'graphics', 'shader', '游戏开发', '游戏引擎'],
    children: [],
  },
  {
    slug: 'productivity',
    name: '效率工具',
    keywords: ['productivity', 'note-taking', 'notes', 'task management', 'todo', 'knowledge base', 'pkm', 'efficiency', '效率', '笔记'],
    children: [],
  },
  {
    slug: 'other',
    name: '其他',
    keywords: [],
    children: [],
  },
];

export const CATEGORY_NAME = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.name]));

export const DEFAULT_SETTINGS = {
  githubToken: '',
  aiBaseUrl: 'https://api.deepseek.com/v1',
  aiApiKey: '',
  aiModel: 'deepseek-chat',
  aiEnabled: false,
  crawlIntervalMinutes: 360,
  maxDetailPerCrawl: 120,
  discoveryDays: 7,
  minStars: 5,
};

export function currentWeekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
