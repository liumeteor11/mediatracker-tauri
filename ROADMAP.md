# MediaTracker 优化路线图

> 更新日期：2026-09-26。路线图按优先级排序，每步完成后勾选并记录验证结果。

## 阶段 1：AI 模型配置现代化（已完成）

目标：让内置模型列表跟上 2026 年各家供应商的现状，避免用户选择已下线模型。

- [x] 联网核对 OpenAI、DeepSeek、Moonshot、Qwen、Gemini、Mistral、MiMo、智谱 8 家供应商的现行模型清单。
- [x] 更新 `src/components/AIConfigPanel.tsx` 的 `PROVIDER_MODELS`，每家不超过 5 个最新模型（GPT-5.6 系列、DeepSeek V4、Kimi K3、Qwen3.8/3.7、Gemini 3.6 等）。
- [x] 更新 `src/store/useAIStore.ts` 的默认模型与旧模型自动迁移逻辑（kimi-latest→kimi-k3、gpt-4.x→gpt-5.6、deepseek-chat→v4-flash 等）。
- [x] 更新 `src/services/aiService.ts` 的兜底模型为 gpt-5.6-terra。
- [x] `tsc --noEmit` 通过。

## 阶段 2：核心逻辑缺陷修复（按优先级）

> 来源：2026-08-03 核心功能代码审查。P1 最高优先级，逐项修复并验证。

### P1 同步接口认证与安全

- [x] 为 `/sync/data` 增加共享密钥（PIN/配对码）认证，拒绝未授权 GET/POST（`sync_token` + `Authorization: Bearer`）。
- [x] 移除过宽的 CORS，同步数据按用户隔离（`?user=` + 仅返回条目），不泄露密码哈希与配置密钥。
- [x] SyncModal 增加配对码展示/复制/设置；同步失败提示码不匹配。

### P2 置顶持久化

- [x] Rust `models.rs` 的 `MediaItem` 增加 `isPinned` 字段（serde 序列化）。
- [x] 顺带修复 `tests.rs` 中失效的构造字段（media_type→kind），`isPinned` 序列化断言已加入。

### P3 冲突解决时间戳

- [x] 所有收藏 mutation（addToCollection / updateItem / moveCategory / createCollection / updateCollectionMembers / importCollection）统一写入 `lastEditedAt`。
- [x] 同步合并改为按用户合并并以 `lastEditedAt` 为准（`merge_user_items`）。

### P4 更新检查并发控制

- [x] `checkUpdates` 增加单例互斥（`updatesCheckInFlight`），重复触发直接跳过。
- [x] App.tsx 启动检查改为监听 `initialized`，消除初始化竞态。

### P5 收藏去重与合集成员

- [x] `addToCollection` 判重加入年份维度，已存在时合并更完整的元数据且不覆盖用户字段。
- [x] 修复 `createCollection`：未入库成员先持久化再加入合集，避免孤儿成员。

### P6 AI 更新输出校验与导出修复

- [x] `checkUpdates` 对 AI JSON 解析加 try/catch 与 schema 校验（仅接受本批次条目、非空更新文本）。
- [x] 修复 `export_collection` 的 `redact_sensitive=false` 逻辑矛盾（仅 redact 时删除敏感字段）。

> 验证说明：前端 `tsc --noEmit` 通过；Rust 工具链已安装至 D 盘（rustc/cargo 1.97.1），`cargo check`、`cargo build`、`cargo test` 全部通过（2 个测试：media_item_serialization、duckduckgo_parsing）。顺带修复：`src/tests.rs` 此前从未被 `mod tests;` 挂载，测试实际未运行，已在 lib.rs 补挂载并修正缺失字段。

## 阶段 2.5：AI 原生能力适配（原生搜索 + 思考强度 + maxTokens）

> 来源：2026-08-03 联网核实各家 API 参数（OpenAI / DeepSeek / Moonshot / Qwen / 智谱 / Kimi 官方文档）。目标：让「开启内置联网功能」「深度思考」两个开关真正生效，并按模型适配参数。
- [x] 新建 `src/services/modelCatalog.ts` 模型能力目录：8 家供应商 ≤5 个模型 + 每模型能力元数据（nativeSearch / reasoningLevels / maxTokensParam）。
- [x] 接通「开启内置联网功能」（enableNetworking）：支持原生搜索的模型优先使用内置搜索（OpenAI `web_search` 工具、Qwen `enable_search`+`search_options`、智谱 `web_search` 工具）；请求被 400/422 拒绝时自动降级为外部搜索（Google/Serper/Yandex/DuckDuckGo）。Moonshot/Kimi 原生联网官方标注维护中，暂走外部搜索。
- [x] 思考强度选择器：`enableDeepThinking` 布尔开关升级为 `reasoningEffort`（关闭/自动/低/中/高/最大），按模型映射参数（GPT-5.x `reasoning.effort`、DeepSeek V4 `reasoning_effort`(high/max)、Kimi K3 `reasoning_effort`(max)/K2.6 `enable_thinking`、Qwen `enable_thinking`、GLM-5.2 `reasoning_effort`/GLM-4.7+ `thinking.type`），不支持的模型自动忽略；含 v6 持久化迁移。
- [x] 修复 `maxTokens` 配置不生效：真正传给 API（OpenAI 系用 `max_completion_tokens`，其余用 `max_tokens`），Rust `ai_chat` 支持 `extra_body` 合并。
- [x] 验证：`tsc --noEmit` 通过；`cargo check` / `cargo test`（2 个测试）通过。

## 阶段 2.7：模型目录刷新 + 人物蒸馏与角色扮演对话（2026-09-26 完成）

> 模型目录按 2026 年 9 月各供应商最新发布刷新；新增「人物蒸馏」（参考 distilly 的 persona 建模）与「角色对话」（参考 nanobot 的会话/上下文治理）。

- [x] `modelCatalog.ts`：新增 DeepSeek V4.1-Flash（2026-09）、Qwen3.8 Max (0902)/Omni Flash、Gemini 3.8 Flash/Flash-Lite、GLM-5.3、MiMo V2.6 Pro/Flash；Qwen3.8 Max Preview 与 MiMo V2.5 系列（官方 2026-10-21 停服）标记 deprecated；每家维持 ≤5 个。
- [x] `useAIStore`：setProvider 默认模型同步更新（qwen→qwen3.8-max、google→gemini-3.8-flash、mimo→mimo-v2.6-pro、zhipu→glm-5.3），持久化 v6→v7 增加旧模型自动迁移映射。
- [x] 人物档案数据结构：`types/character.ts` 与 Rust `models.rs` 同步定义 `DistilledCharacter`（表达 DNA / 心智模型 / 决策模式 / 人际 / 边界 / 关系 / 台词 / 时间线 / 纠偏层 correction）与 `ChatSession`（含 summary + summarizedUpTo 归档偏移），JSON DB 以 `#[serde(default)]` 兼容旧数据，无需迁移。
- [x] 蒸馏流水线（`characterService.ts`）：作品元数据 + TMDb credits（演员-角色表）+ 用户补充素材 → distilly 式四维分析 prompt → JSON 人物数组；同名角色增量合并（保留纠偏与历史，version+1）。
- [x] 对话系统：nanobot 式分层 system prompt（身份 → 人设档案 → 表达 DNA → 纠偏层（优先级最高）→ 归档摘要 → 对话规则，`---` 分隔）；历史按最新往回的消息数/字符预算裁剪并对齐 user 消息开头；超 30 条未归档自动压缩为滚动摘要；每角色多会话（新建/重命名/删除，首条用户消息自动命名，开场白 greeting 注入新会话）。
- [x] UI：新增 `/characters`（蒸馏入口 + 人物卡片 + 档案详情 + 纠偏管理）与 `/characters/:id`（会话侧栏 + 聊天区 + 调校人格）页面，Navbar 增加「人物」入口，i18n en/zh 全量补齐；`callAI` 增加 `disableSearch` 选项（角色对话禁用联网搜索）。
- [x] Rust：新增 6 个命令（get_characters/save_character/remove_character/get_chat_sessions/save_chat_session/remove_chat_session），删除人物级联清理其会话。
- [x] 角色对话流式输出：Rust `ai_chat_stream`（reqwest SSE 解析 + Tauri Channel 增量推送 `{type:"delta"/"done"/"error"}`，provider 忽略 stream 时整体回退；重试仅发生在首个 delta 之前），前端 `callAIStream`（Tauri Channel / OpenAI SDK 流式双通道，多 Key 仅在未出首字前轮换），对话页渐进渲染 + 光标动画。
- [x] 验证：`npm run build`（tsc + vite）通过；`cargo test` 4 个测试通过（新增 distilled_character / chat_session 序列化与缺省字段反序列化测试）。

## 阶段 2.8：蒸馏链路可靠性与服务商适配（2026-09-27 完成）

> 修复「桌面版已配置 API Key，蒸馏仍报配置错误」：排查出服务商/Key 错配、Kimi 温度限制、思考模型 token 预算三个叠加问题；蒸馏恢复联网检索。

- [x] 服务商与 Key 匹配：`useAIStore` 持久化 v7→v8 增加 `apiKeyProvider`（记录 Key 是为哪个服务商保存的），配置面板在切换服务商导致不匹配时给出黄色警告并要求重新测试连接；API Key 输入框失焦即保存（此前仅"测试连接"成功才落盘，输入后离开面板会丢失），显式清空则同时清除记录。
- [x] 错误可定位：`aiService.describeAIError` 区分「Key 被服务商拒绝（401/403）」「服务商原始报错」「输出无法解析」「空响应」四类，蒸馏弹窗与角色对话 toast 针对 401 给出"检查服务商与密钥是否匹配"的指引（i18n en/zh 补齐）。
- [x] 模型适配（全厂商）：`modelCatalog` 新增 `fixedTemperature`；Moonshot 现行 Kimi 模型统一只接受 `temperature=1`（实测 kimi-k3 / k2.6 / k2.7-code / k2.7-code-highspeed 均返回 400 `invalid temperature: only 1 is allowed`）。除目录中已确认的模型外，`aiService` 还会在运行时向服务商学习：从报错中识别"只接受某个温度"（含 OpenAI 的 `only the default (N) value is supported`）、"不支持 temperature 字段"与"不支持工具定义"三类情况，记住后本会话后续调用直接按可接受的方式发（`learnedTemperaturePolicy` / `learnedNoTools`）；Rust `ai_chat` / `ai_chat_stream` 的 temperature 改为可选（`Option<f32>`），不支持该字段的模型整段省略。未收录模型、自定义端点同样生效。
- [x] 思考模型 token 兜底：回答被截断（`finish_reason=length` 且内容为空，推理吃掉整个额度）时自动提高 `max_tokens` 再问一次——首次跳到 ≥8000，仍截断再翻倍，上限 32000；非流式（`callAI`）与流式（`callAIStream`）两条路径共用同一套温度策略与学习结果。
- [x] 蒸馏联网检索：蒸馏以 `forceSearch` 启用 web_search 工具轮次，user prompt 增加 `[Research]` 指令（先检索作品与目标角色，台词/时间线以检索结果为据、禁止编造）；工具执行不再受全局"联网搜索"开关阻断；工具轮次用尽后再发一次无工具请求，避免以空响应收尾。
- [x] 检索后空回答兜底：思考模型常在检索轮后返回 `finish_reason=stop` 但 content 为空（它还想继续检索），`callAI` 此时追加一条"直接输出最终答案、不得调用工具"的 user 消息再问一次（`toolsDisabled` + 单次上限），实测 kimi-k3 由此产出完整 16 字段画像并成功解析。
- [x] 检索密钥轮询：Rust `web_search` 统一拆分 `;` / `；` 分隔的搜索密钥并逐个轮换（此前拼接后的整串被直接当作单个 key 发给 Google，返回 400 `API key not valid`，而"测试连接"因已拆分而显示正常）；新增 `split_search_keys` / `search_with_key_rotation` 及 2 个单元测试。
- [x] Token 预算：蒸馏固定请求 8000 `max_tokens`（思考模型会把默认 2000 全部用于推理并返回空内容、`finish_reason=length`），空响应文案改为提示 token 预算/模型方向。
- [x] 验证：`npm run build`（tsc + vite）通过；对 Moonshot 实测——kimi-k3 在 8000 预算下输出可解析的 16 字段画像（推理 ≈5351 token），检索轮 + 最终答案的多轮链路端到端跑通。

## 阶段 3：搜索与元数据质量

- [ ] 为豆瓣、TMDB、Bangumi 等数据源增加响应校验与缓存过期策略，降低 429/超时导致的空结果。
- [ ] 为"权威域名"白名单提供默认预置（电影/剧集/图书/漫画/音乐各 5-10 个），并支持一键恢复默认。
- [ ] 搜索失败时自动降级链路（Google→Serper→Yandex→DuckDuckGo）加入结果去重与评分合并。
- [ ] 封面图失败时按"用户自定义 > 平台海报 > 占位图"顺序回退，避免刷新覆盖已有海报。

## 阶段 4：性能与体验

- [ ] 虚拟列表/增量渲染大收藏集（1000+ 条目时滚动卡顿）。
- [ ] 为列表页与仪表盘增加 React.memo + 选择器收敛，消除 Zustand 无限渲染风险。
- [ ] 海报懒加载加交错（staggered）与内存缓存，减少重复网络请求。
- [ ] 冷启动优化：首屏只渲染骨架屏，元数据异步填充（已有部分实现，需量化验证）。

## 阶段 5：可靠性、安全与配置

- [ ] 将 `useAIStore.ts` 中硬编码的 AES 密钥改为用户口令派生或系统钥匙串存储。
- [ ] API Key 支持多密钥健康检查：测试时自动剔除失效 Key，日志中打码显示。
- [ ] 为同步（LAN sync）增加冲突合并策略与数据校验（版本号 + 更新时间戳）。
- [ ] 增加设置页"一键诊断"：连通性、模型可用性、Key 有效性、代理状态。

## 阶段 6：CI/CD 与发布

- [ ] 在 `release.yml` 中增加前端类型检查与 Rust 测试步骤，失败即中止。
- [ ] 添加 `v*` 标签发布前的 CHANGELOG 自动生成（按 Conventional Commits 聚合）。
- [ ] 为 Windows 安装包增加自动更新（tauri-plugin-updater），减少用户手动升级。
- [ ] 补充 Android 构建的签名与 Play 商店 / 侧载发布文档。

## 验收标准

每个阶段完成后：本地 `npm run build` 与 `cargo test` 通过；手动回归搜索、收藏、同步、AI 配置四个核心流程；发布前更新本文件并勾选对应项。
