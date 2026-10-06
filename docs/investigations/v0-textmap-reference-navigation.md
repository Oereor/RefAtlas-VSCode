# V0 TextMap reference navigation — implementation report

日期：2026-10-06。范围：仅 `AvatarName.Hash → TextMapCHS`。

## 实现与工程结构

这是独立的 TypeScript VS Code desktop extension。`src/context.ts` 识别来源，
`src/textmap.ts` 完成可取消查找与小缓存，`src/extension.ts` 注册原生 Hover 和
Definition provider。另有单元测试、只读 smoke、Extension Host 集成测试、F5 配置。
没有迁移旧 Electron/Svelte 代码，也没有 Language Server、worker、child process、
数据库、索引或自定义 UI。测试启动脚本启动已安装的 VS Code；扩展运行时不启动子进程。

唯一运行时依赖 `jsonc-parser@3.3.1` 解决标准 JSON 结构、字符串解码和 token offset
问题。开发依赖只有 TypeScript、Node 和 VS Code 类型。Node 内置测试工具负责单元测试；
本机 VS Code 自带 extension-test 入口负责集成测试，无需下载另一份 VS Code。
安装已通过 `127.0.0.1:7890` 代理完成；项目 `.npmrc` 固定该代理并关闭自动更新通知，
未修改用户级 npm/Git/system proxy 配置。

来源必须属于 workspace folder，且相对路径精确为 `ExcelOutput/AvatarConfig.json`。
使用 `parseTree` 的结构、parent 链和 offsets，要求 numeric node 的路径是根数组成员
对象的直接 `AvatarName.Hash`。解析错误、字符串 hash、错误字段/文件/嵌套均无结果。
hash 身份始终来自 `text.slice(offset, offset + length)`，不读取 numeric AST value，
也不通过 `Number`/`parseInt` 构造 key。库内部的 numeric AST 表示不参与引用身份。

目标 URI 由来源所属 workspace folder 加 `TextMap/TextMapCHS.json` 得到。
未打开目标使用 Node 异步 UTF-8 read stream（64 KiB chunk）和逐行读取；已打开目标
使用 `TextDocument.lineAt`，包含未保存内容。scanner 检查每行根成员的
string-key、冒号、string-value 和分隔符，以解码后的 key 做 `===` 比较。
每 256 行显式让出事件循环；取消时关闭 readline/stream，并释放监听。

该查找只支持当前快照的 flat object / 一行一个 member 布局。命中时提前停止，
验证访问过的前缀及匹配行；不审计未读后缀、整文件语法或全局重复 key。
不支持的布局返回单独结果并写 Output Channel，不退回全量解析。

成功项缓存最多 64 个，key 包含 target URI、版本和原始 hash。
磁盘版本使用 size、mtime、ctime、inode，读取前后检查；编辑器版本包含 document
实例标识和 version，避免关闭/重开时版本号复用。查找期间编辑、打开或关闭目标时
丢弃结果。取消（包括最后一次 stat 期间）、缺失和失败均不缓存。
状态区分不适用、target missing、key missing、cancelled、changed、unsupported layout、failure。

Hover 使用不受信任的 `MarkdownString.appendText` 展示文本、`TextMapCHS` 和完整 hash；
数据里的 Markdown 按普通文本转义。Definition 返回真实 `vscode.Location`，范围从
key 开始到字符串 value 的闭引号结束，使用 UTF-16 行列。原生 JSON 功能仍启用。

正常 Node UTF-8 stream 解码保留 chunk 边界的多字节字符和字符串内 U+FEFF，
scanner 解码 JSON 转义。没有复制旧 segmented decoder，没有进行旧 FEFF 修复，
也没有宣称全 TextMap fidelity audit。

## 验证与实际效果

- `npm test`：12 项测试全部通过。覆盖来源规则、原始大整数、exact/相似/escaped key、
  中文与转义、UTF-16 range、LF/CRLF、BOM/字符串内 FEFF、64 KiB UTF-8 分块边界、
  missing/error/layout 区分、缓存版本/上限、取消/关闭 generator/释放 stream listener。
- `npm run smoke`：只读真实 `/0/AvatarName/Hash` 的
  `6186714091647966180`，解析得到 `三月七`。
  目标为第 **11233** 行，VS Code 0-based range 是 **(11232, 2)–(11232, 30)**，
  精确截取 `"6186714091647966180": "三月七"`。
- `npm run test:extension`：在 VS Code **1.140.0** / Node **24.21.0** 上通过。
  通过 `vscode.executeHoverProvider` 验证真实“三月七”及完整 hash，
  通过 `vscode.executeDefinitionProvider` 验证 URI、行和目标文本。
- 实际执行 `editor.action.revealDefinition`，断言 active editor 切换到真实 TextMap，
  selection 位于第 11233 行。**原生 Go to Definition 已实际触发并验证。**
- 实际执行 `editor.action.peekDefinition`，并提供可选 45 秒检查停顿。
  **原生 Peek 命令调用已完成，但 widget 的视觉呈现未确认。** Computer Use 的
  `list_windows` 在停顿期间未发现沙箱运行的 VS Code 窗口，无法截图检查。
  不把 provider 结果或命令成功等同于视觉验收。
- Multi-root 测试验证第二个 workspace 的引用指向自身 TextMap。
  未保存修改测试验证 Hover 文本及 Definition 行随编辑变化；仅修改新项目内的
  disposable fixture，并撤销关闭，真实 dataset 从未编辑或保存。

## 性能观察与问题

最终复测的单次观察如下，不是 SLA 或 cold disk benchmark：

| 路径 | 首次 | 缓存 | RSS 增量 | 5 ms 定时器最大实际间隔 |
| --- | ---: | ---: | ---: | ---: |
| 只读核心 smoke | 32.75 ms | 0.60 ms | 15.06 MiB | 6.59 ms |
| Extension Host 原生 Hover 执行链 | 172.67 ms | 15.97 ms | 13.70 MiB | 20.24 ms |

核心 smoke 的 RSS 采样还包含 Location 文本复核；Hover 执行链包含来源 AST 解析和
VS Code provider 调度，不是纯 TextMap 查找时间。没有显式强制 GC。
该样本 hash 位于文件较早位置，不能外推末尾/missing key 或所有编辑器操作的耗时。
已用长 buffered fixture 验证定期让出事件循环和取消，未观察到本次查找明显的持续
Extension Host 阻塞；这里也没有对 UI 响应作完整审计。

原生导航打开约 50 MiB TextMap 后，Extension Host 全流程 RSS 相对初始值增加约
246.19 MiB（另一次测量约 107 MiB，受 GC 等影响）。这是编辑器打开整份目标后的
观察，不能归因为 64 项 resolver cache，也不宣称只有 streaming 的内存成本。

测试 profile 中 VS Code 自身记录了 argv.json 写权限、Jump List、内建 agent/chat
及 Peek 关闭附近的 `InstantiationService has been disposed` 日志；测试断言均通过。
45 秒 Peek 停顿的那次运行未出现该 dispose 日志。结合窗口无法检查的限制，
Peek 外观仍需在正常用户桌面的 F5 Development Host 中 review。

现有结果证明这一条 Hover/Definition 链可以通过轻量基础设施工作；正式浏览体验的
产品判断留给 review。当前没有引入更复杂基础设施的依据；不建立索引或第二种引用。

## Changed files 与只读审计

新增工程/开发配置：`.gitignore`、`.npmrc`、`.vscode/launch.json`、`.vscode/tasks.json`、
`AGENTS.md`、`package.json`、`package-lock.json`、`tsconfig.json`。
新增实现/验证：`src/context.ts`、`src/textmap.ts`、`src/extension.ts`、`src/smoke.ts`、
`src/test/context.test.ts`、`src/test/textmap.test.ts`、`src/test/extensionSuite.ts`、
`scripts/test-extension.cjs`、本报告。更新 `README.md`。
现有 `LICENSE` 和 `.gitattributes` 未修改。

新仓库状态为 `M README.md` 和上述新增未跟踪文件，均未暂存/提交。
`dist/`、`node_modules/`、`.npm-cache/`、`.test-artifacts/` 被忽略。
未 commit/push，未创建 branch/PR/issue，未发布或归档旧仓库。

开始和结束的 `git status --porcelain --untracked-files=all` 均显示：
`../RefAtlas/` **clean**、`../TurnBasedGameData/` **clean**；两者 `git diff --quiet`
均 exit 0。Git 的 ownership 检查使用单次命令 `-c safe.directory=...`，未修改全局配置。
这次只读 smoke 的数据位置、range 和测试观察都针对仓库当前快照。

V0 完成后停止，等待本地 review。
