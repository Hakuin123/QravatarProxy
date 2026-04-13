# QavatarProxy

基于 Cloudflare Worker 的头像中转服务，适用于所有采用 Gravatar 的评论系统。

对于注册了 Gravatar 的用户直接代理其头像；对于未注册 Gravatar 但存在于 QQ 哈希库中的用户，返回其 QQ 头像。所有对外请求（Gravatar / 腾讯）均由 Worker 发起，**客户端仅与你自己的域名通信**。

## 工作流程

```
GET /avatar/:hash
      │
      ▼
请求 Gravatar（d=404 探测）
      │
      ├─ 非 404 ──→ 代理返回 Gravatar 头像
      │
      └─ 404
            │
            ▼
        查询 KV（QQ 哈希库）
            │
            ├─ 命中 ──→ 代理返回 QQ 头像
            │
            └─ 未命中 ──→ 代理返回 Gravatar 默认头像 / 重定向至自定义默认头像
```

## 部署

### 0. 初始化

将 `wrangler-example.toml` 重命名为 `wrangler.toml`

### 1. 创建 KV Namespace

```bash
wrangler kv namespace create QAVATAR
```

将输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "QAVATAR"
id = "YOUR_KV_NAMESPACE_ID"
```

### 2. 设置环境变量

管理接口鉴权密钥通过 Secret 注入，不写入配置文件：

```bash
wrangler secret put ADMIN_SECRET
```

Gravatar 自定义参数（可选）在 `wrangler.toml` 中配置，格式为 URL query string：

```toml
[vars]
GRAVATAR_EXTRA_PARAMS = "d=mp&r=g"
```

### 3. 部署

```bash
wrangler deploy
```

### 4. 配置路由（复用已有域名）

如需挂载到已有域名的子路径（域名须托管于 Cloudflare）：

```toml
routes = [
  { pattern = "api.example.com/avatar/*", zone_name = "example.com" }
]
```

### 5. 配置 Twikoo

在 Twikoo 管理面板中将 `GRAVATAR_CDN` 设置为：

```
https://your.domain/avatar
```

## 管理接口

### 录入 QQ 邮箱映射

仅支持 QQ 数字邮箱（`数字@qq.com`），自动计算 SHA256 并存入 KV。

```bash
curl -X POST https://your.domain/avatar/admin/add \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email": "123456789@qq.com"}'
```

也支持在请求体中传入 `key` 字段作为鉴权方式：

```bash
curl -X POST https://your.domain/avatar/admin/add \
  -H "Content-Type: application/json" \
  -d '{"email": "123456789@qq.com", "key": "YOUR_SECRET"}'
```

**响应示例：**

```json
{
  "ok": true,
  "email": "123456789@qq.com",
  "hash": "abc123...",
  "type": "qq",
  "qq": "123456789"
}
```

## 环境变量一览

| 变量                    | 配置方式               | 说明                                                         |
| ----------------------- | ---------------------- | ------------------------------------------------------------ |
| `ADMIN_SECRET`          | `wrangler secret put`  | 管理接口鉴权密钥                                             |
| `DEFAULT_AVATAR_URL`    | `wrangler.toml [vars]` | 自定义默认头像 URL，配置后替代 Gravatar 默认头像             |
| `GRAVATAR_EXTRA_PARAMS` | `wrangler.toml [vars]` | 追加到 Gravatar fallback 请求的参数，格式为 URL query string |

## Cloudflare 免费套餐说明

KV 读取仅在 Gravatar 返回 404 时触发，对有 Gravatar 的用户**零 KV 消耗**，在[免费套餐限制](https://developers.cloudflare.com/kv/platform/limits/)（100,000 次 Reads/天）下可稳定运行。

## License

MIT
