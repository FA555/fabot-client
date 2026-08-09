这本是一个 private 项目，仅供自己使用。2026.7.12 凌晨 publish（改为 public）。

# fa-bot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/main.ts
```

## 审计统计

Bot 使用 Bun SQLite 将审计元数据保存在 `data/audit.sqlite`。审计记录不包含聊天正文、AI Prompt、回复正文或昵称，只记录用户和会话标识、功能名称、消息长度、执行结果、耗时及 token 等统计字段。

只有 `config/whitelist.yaml` 中标记为 `super: true` 的用户可以通过私聊查询：

```text
/audit                       # 全部历史总览
/audit.time(7d)              # 最近 7 天总览
/audit.plugins.time(7d)      # 最近 7 天各功能明细
/audit.ai.time(1d)           # 最近 1 天 AI 明细
```

参数使用与其他插件一致的点式链式格式，顺序无关，例如 `/audit.time(1d).ai` 等价于 `/audit.ai.time(1d)`。时间范围支持 `h`、`d` 和 `w`。审计命令及其回复与其他插件一样计入统计；当前查询的回复会在发送成功后入库，因此从下一次查询开始可见。

可选环境变量：

```text
AUDIT_DB_PATH=data/audit.sqlite
BOT_HOST=127.0.0.1
WEBHOOK_TOKEN=replace-with-a-random-secret
EMERGENCY_WEBHOOK_BASE=https://example.com/replace-with-a-rotated-key
EMERGENCY_ALLOWED_USER_IDS=123456789
EMERGENCY_TARGET_USER_ID=123456789
WHITELIST_PATH=config/whitelist.yaml
```

服务默认只监听 `127.0.0.1`。如果需要通过 `BOT_HOST=0.0.0.0` 等配置对外监听，必须同时配置 `WEBHOOK_TOKEN`，并让 NapCat 反向 HTTP 请求携带 `Authorization: Bearer <token>`。否则管理命令的用户身份只能依赖未经 HTTP 鉴权的事件字段。

Emergency 推送默认关闭。只有同时配置 HTTPS webhook 和 `EMERGENCY_ALLOWED_USER_IDS` 后才启用，权限按发送者 QQ 号判断，不继承群白名单。旧版本源码中出现过的推送凭据应在服务端立即轮换。

## 访问控制

用户、群聊白名单和插件策略统一保存在 `config/whitelist.yaml`，修改后重启生效。`WHITELIST_PATH` 可以指定其他访问控制文件。

```yaml
private:
  - name: admin
    id: 123456789
    super: true

group:
  - name: example-group
    id: 987654321

plugin_policy:
  version: 1
  defaults:
    enabled: true
  plugins:
    ai:
      modes:
        private:
          observe: false
        group:
          observe: true
  rules:
    - id: only-handle-in-group
      match:
        chat_type: group
        chat_ids: [987654321]
      plugins:
        "*":
          enabled: false
        handle:
          enabled: true
```

`private` 和 `group` 决定哪些用户或群可以进入消息处理流程；`plugin_policy` 决定消息进入后可以运行哪些插件。规则从上到下执行，后匹配的规则覆盖先匹配的规则。同一配置块中 `"*"` 先应用，具体插件随后覆盖。`invoke` 控制插件响应，`observe` 控制后台观察，`enabled` 同时控制两者。未知插件、未知字段或非法 ID 会阻止服务启动。

审计数据默认永久保留，不会自动清理；`/audit` 默认查询全部历史。数据库文件权限会设为 `0600`。生产环境应使用 SQLite 在线备份工具，或停服后连同 WAL 文件一起备份；不要在服务运行时仅复制 `data/audit.sqlite`，也不要把数据库提交到 Git。

统计口径：

- 活跃用户：时间范围内发送过有效消息的去重用户数。
- 功能调用：消息被某个插件接受并开始执行。
- 回应消息：至少成功投递一条回复的去重入站消息数。
- 发出消息：NapCat 确认成功投递的用户链路及后台功能消息总数，不包含 Cron 主动消息。
- AI 生成：AI Provider 成功返回非空结果。
- AI 回答：AI 生成成功且至少成功投递一次。

入站 webhook 采用 at-most-once 处理：相同消息 ID 的重投会被忽略。插件或投递失败会保留在审计数据中，但不会自动重放，以免重复执行 Emergency、Handle 等非幂等副作用。

This project was created using `bun init` in bun v1.1.29. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
