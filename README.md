# Open Source Radar

Open Source Radar 是一个本地优先的 Chrome Extension，用来发现、收藏和分析 GitHub 开源项目。

## 当前版本

当前为 V1.0 插件基础版本，采用 Chrome Extension Manifest V3，不需要服务器、数据库或账号系统。

已经包含：

- Popup 项目发现页面
- Dashboard 页面
- GitHub 项目采集模块
- 项目分类逻辑
- IndexedDB 本地数据层
- 收藏和个人配置
- Star 增长计算
- AI 分析模块骨架
- `chrome.storage.local` 配置存储
- `chrome.alarms` 定时任务骨架
- 本地测试文件

## 安装插件

1. 克隆或下载本仓库。
2. 打开 Chrome，进入 `chrome://extensions`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择仓库中的 `extension` 文件夹。

## 配置

打开插件设置页后，可以配置：

- GitHub Token，可选。配置后可以提高 GitHub API 请求额度。
- OpenAI 兼容 API Base URL，可选。
- AI API Key，可选。
- AI 模型名称。

基础项目浏览不依赖 AI 服务。AI 服务不可用时，项目发现和本地收藏仍然可以使用。

## 数据与隐私

- 项目数据和收藏数据保存在浏览器本地。
- API Key 使用 Chrome 本地存储，不发送到自建服务器。
- 当前版本不包含云端账号、服务器后台或第三方搜索服务。
- 历史增长数据只基于实际采集快照计算。

## 目录结构

```text
extension/
├── manifest.json       # Manifest V3 配置
├── popup.html/js/css   # 插件弹窗
├── dashboard.html/js   # 项目管理页面
├── background.js       # Service Worker 与定时任务
├── src/core/           # GitHub、存储、分类、AI、增长逻辑
├── src/ui/             # UI 工具
├── scripts/            # 校验和资源脚本
└── tests/              # 核心逻辑测试
```

## 后续计划

1. 完善 GitHub API 分页、限流和重试。
2. 接入 IndexedDB 项目与历史快照持久化。
3. 增加分类筛选、收藏分组和项目详情页。
4. 增加 AI 项目总结、商业价值和二次开发分析。
5. 增加 JSON 数据导入导出和更完整的异常状态。

## License

暂未指定许可证。
