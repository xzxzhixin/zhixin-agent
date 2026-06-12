# 致心智能体项目协作规则

本文件是新会话、新 agent 或新开发者进入项目后必须先读取的项目规则。出现冲突时，用户当前明确指令优先，其次遵守本文件。

## 必读文件

开始任何需求拆解、代码修改、审查或实现前，必须先读取：

- `总体计划.md`：系统的大方向，所有的需求都来自这个文件，只允许用户手动修改，即使用户明确可以修改也不能修改。
- `需求.md`：产品需求源，来自总体计划拆解，同步记录项目最新进度，如有冲突直接删除对应描述或者修改。
- `架构.md`：架构、技术栈、布局边界和工程约定源。
- `AGENTS.md`：当前协作规则。

## 清单状态图标

- 📋 未开始
- ⏳ 进行中
- ✅ 已完成
- 🔄 持续性

## 文档同步规则

- `需求.md` 只保存产品需求，不保存架构、执行计划、开发记录或临时 UI 调整说明。
- 需求事实源同步口径以 `需求.md` 的“需求事实源与同步”为准；执行时如果用户后续提到的需求在 `需求.md` 中没有明确覆盖，必须先新增到 `需求.md`，再落代码。
- 执行时如果新需求与已有 `需求.md` 内容或用户之前明确提出的需求冲突，必须先停下来告知冲突点，让用户决定采用哪个口径；用户确认后再修订 `需求.md`、`设计.md` 或 `架构.md` 并落代码。
- 架构、技术栈、目录边界、布局边界和工程约定维护在 `架构.md`；此类内容不要写入 `需求.md`。
- `设计.md` 保存当前功能设计和验收设计；执行前必须评估并同步本轮设计，不能把多个功能、多个端或多个验收口径揉在同一个标题下。
- `设计.md` 必须按功能拆分二级标题；每个功能标题下必须至少包含目标、范围、设计要点、验收口径和清单状态，必要时再补充交互、数据流、接口、边界和风险。
- `设计.md` 的目标必须写清楚该功能要解决的问题和完成后的可验证结果；范围必须写清楚本轮包含什么、不包含什么，避免执行时扩大实现边界。
- `设计.md` 中的清单状态必须使用 📋、⏳、✅、🔄 图标维护；功能完成、部分完成、持续性维护或暂未开始时，都必须同步调整对应标题或清单项状态。
- `需求.md`、`设计.md` 和 `架构.md` 必须随着最近代码和真实实现持续保持一致；每次完成代码修改、规则调整、架构调整或验收口径调整后，都要评估这些文件是否需要同步。
- 代码实现已经改变产品能力、交互口径或验收口径时，必须同步更新 `需求.md`；代码实现已经改变设计、架构、目录、模块边界、接口、存储、构建或运行方式时，必须同步更新 `设计.md` 或 `架构.md`。
- `需求.md` 发生用户明确要求的新增、删除、修改后，必须同步评估是否需要更新 `设计.md` 和 `架构.md`。
- `设计.md` 或 `架构.md` 发生目录边界、技术栈、接口规范、存储规范、构建打包、运行边界或验收设计调整后，必须同步评估是否需要更新 `需求.md`。
- `需求.md` 中需要使用清单和状态图标维护需求状态；图标口径以 `总体计划.md` 的 md 文件图标说明为准。
- 代码实现、规则调整、架构调整或验收口径调整完成后，必须回查 `需求.md`、`设计.md` 和 `架构.md` 中对应清单项，并按实际完成度更新状态图标，不能只改内容不改状态。
- 每次完成代码修改、规则调整、架构调整、设计调整或验收口径调整后，最终回复前必须明确自查 `需求.md` 与 `设计.md` 的对应清单状态是否已更新；如果不需要更新，必须能说明原因。
- 用户明确提出产品能力、交互口径、数据口径、验收口径或业务规则时，即视为需求修改指令；如果该内容在 `需求.md` 中没有明确覆盖，必须按 `需求.md` 的事实源同步口径写入 `需求.md`；如果该内容与已有需求冲突，必须先停下来告知冲突点，让用户决定后再写入。
- 不允许把用户新提到但 `需求.md` 未覆盖的需求只写入 `AGENTS.md`、`设计.md`、`架构.md` 或代码。
- 如果用户只要求更新计划、设计或规则，不要顺手改业务代码。

## 工程目录规则

- 工程目录、模块边界和新增端目录规则以 `架构.md` 的“代码目录约定”为准。
- 修改代码时必须先确认目标模块归属，不能把不同端、SDK、中心服务或共享代码混放。
- `架构.md` 中的目录树、模块清单、接口清单和构建产物清单必须把说明写在对应条目旁边或紧跟对应条目之后，不能把解释集中放到很远的位置让读者再按行号或顺序对照。

## 包管理与构建工具

- 包管理、构建打包、插件构建和产物命名规则以 `架构.md` 的“代码目录约定”和“构建打包约定”为准。
- node版本必须用用户系统环境里面的node版本，如果不行提醒用户，不允许私自处理。
- TypeScript 配置只服务源码组织和 IDE 识别，不允许把 `tsc` 或 `vue-tsc` 作为整个项目、任一子包或任一脚本的语法检查、类型检查或默认质量门槛。
- TS 文件不要通过命令行脚本做校验；确需检查 TS 语法或类型时，只使用 IDE 自带检查能力。
- 新增或修改 `package.json`、测试脚本、构建脚本时，不能加入 `tsc --noEmit`、`vue-tsc` 或等价 TypeScript 编译器检查命令，也不要把静态协议检查、源码扫描检查挂到根命令中。

## 中心服务原则

- 中心服务事实源、客户端连接、访问控制和敏感信息边界以 `架构.md` 的“中心服务连接与访问控制”为准。
- 桌面端、Web端、IDEA 插件访问智能体、会话、项目、任务、记忆、供应商和扩展能力状态时，必须遵守中心服务唯一入口边界。
- 中心服务不允许独立启动；开发、测试、验收和演示时，中心服务启停都必须通过桌面端或 `dev:desktop-shell` 拉起和停止，不能直接运行 `services/center` 或根独立中心服务启动脚本，避免在 `services/center/center-data` 等错误位置生成中心目录。
- `dev:frontend` 是前端 Vite 开发服务器的独立启动入口；需要前端热更新时先单独运行 `pnpm dev:frontend`。
- `dev:desktop-shell` 只启动桌面壳并由桌面壳拉起中心服务，不拉起前端 Vite 服务；重启桌面端或中心服务代码时只需重启 `dev:desktop-shell`。
- 执行 `dev:desktop-shell` 前必须先关闭之前的桌面壳和中心服务进程，确保重新拉起的是最新代码和最新内置插件构建产物，不能复用旧进程做本轮验收。
- 浏览器端验收必须使用 Chrome DevTools 按真实用户方式操作页面，包括点击、输入、选择、展开、提交和等待界面反馈；不能只用静态源码检查、直接调用接口或读取 DOM 状态替代人的操作路径。
- 浏览器端项目对话测试固定使用项目根目录 `项目对话测试` 文件夹；测试新增项目对话时必须先选择该文件夹，再进入项目内对话。

## 文件与资源规则

- 应用图标固定文件名为 `图标.png`。
- `图标.png` 用于 Electron 应用图标、系统托盘图标、任务栏图标、窗口图标和安装包图标。
- 项目身份文件固定为 `致心项目ID.md`。
- 中文文件名必须与磁盘真实文件名完全一致。
- 文档、注释和回复使用中文，文件使用 UTF-8 编码。

## 代码风格规则

- 新增或修改代码必须补中文注释。
- 方法或函数注释说明用途、关键逻辑、参数和返回值。
- 字段、接口字段、协议字段、状态码、枚举值必须单独注释来源、含义、格式、默认值或约束。
- 复杂逻辑和边界处理必须解释为什么这样处理。
- 多属性对象、数组、参数必须拆成多行。
- Vue 属性每个一行。
- CSS 声明一行一个。
- 单个代码文件不允许超过 1500 行；接近或超过限制时必须按职责拆分模块、组件、工具函数或样式文件，不能继续向大文件追加实现。
- 前端页面入口必须放在 `apps/frontend/src/views/页面/RouterIndex.vue`，并在 `apps/frontend/src/router.ts` 使用 `component: () => import("@views/页面/RouterIndex.vue")` 或等价别名动态导入注册对应 URL；不要在路由文件顶部静态导入页面组件。
- 前端页面专属弹框必须放在对应 `apps/frontend/src/views/页面/dialogs` 目录；只有跨页面复用弹框才放入领域组件目录或 `packages/ui`。
- Vue 页面、弹框和局部组件的专属样式优先写在当前 `.vue` 文件的 `<style scoped>` 中；全局 `styles.css` 只放主题变量、第三方基础覆盖、全局滚动条和跨入口根布局，不把单个页面的大段样式集中堆入全局文件。
- 前端路径别名需要在 Vite 和 IDE 可识别配置中同步维护，常用别名至少包括 `@`、`~`、`@views`、`@components`、`@stores` 和 `@api`。
- 桌面端、Web端桌面浏览器和插件页面的主工作区必须使用 flex 布局组织窗口、侧边栏、顶部栏、右侧状态栏、对话区和输入区，根容器固定当前视口高度并禁止页面级滚动；只有对话消息列表允许作为主滚动区域，其他局部列表如确需滚动必须限制在自身容器内。
- 不要用多个候选字段兜底猜测业务协议，例如 `row.a || row.b || row.c`。
- 默认值只能在需求、协议或业务规则明确时使用，并写清楚原因。
- 不要有无用的导入和url（只在测试里面才有的一样删除），如果有必须删除

## 开发流程规则

- 不运行测试或不构建时，最终说明必须明确写出未测试或未构建。
- 如果用户明确要求“不测试、不构建”，只能做静态自查，不运行测试和构建命令。
- 发现已有未跟踪文件或未提交改动时，不要擅自删除、回滚或覆盖无关内容。
- 需要删除文件、重置 Git、清理数据库等危险操作时，必须先征得用户明确确认。
- 系统中所有时间固定为中心服务本机时间，格式采用YYYY-MM-DD HH:mm:ss，如有特殊说明以特殊说明为准，否则需要矫正
- 中心服务在开发控制台中要有详细的日志过程方便sop审查，记录规则：只记录一头一尾，比如：命令的启动和结束，中间不断的输出不要
- 优先使用ideaMCP服务检索代码

## 测试规范

- 使用用户环境里面的node启动
- 执行`dev:desktop-shell`前必须先关闭之前的进程，保证最新代码生效
- 单点功能测试不允许添加没用url来测试
- 启动测试进程必须记录 `启动进程.md` 一行一个 {{pid}} = {{port}} = {{启动命令}} 方便管理进程
- 打开的浏览器页面也需要记录 `浏览器页面.md` 一行一个 {{pageId}} = {{pageUrl}} 方便复用页面
- 浏览器测试页面不要主动切换过去，避免打断用户使用

## 提交规范

- 不检验本文件直接提交
- 所有任务完成后做git处理
- gitignore 忽略的不要强制加入
- 发现有远端领先先拉取
- 工作区里面所有的改动全部自动推送
- 不校验`提示词模板.md`直接提交


# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
