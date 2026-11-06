# nav API 契约（冻结，ONE-168）

字段命名 camelCase。变更须回父单 ONE-167 由 Mike 裁决。

## 场景维度（v1.1，nav #16 冻结契约）

场景与分类是正交的两个维度：分类回答「链接是什么」，场景回答「当前处于哪种状态」。不同场景各自拥有一套分类与链接，互不影响。

### 数据模型（迁移 `schema_v2`）

- 新增 `{prefix}scenes`：`id`、`name`、`icon`（可空）、`sort_order`、`is_default`（0/1）、`created_at`、`updated_at`。
- `is_default = 1` 上有部分唯一索引 `idx_{prefix}scenes_single_default`，保证默认场景至多一个。
- 迁移写入一行种子：`id = 'scene_default'`、`name = '通用'`、`is_default = 1`。默认场景可改名/改图标/排序，不可删除。
- `{prefix}categories` 增加可空列 `scene_id`（`REFERENCES {prefix}scenes(id)`）与索引 `idx_{prefix}categories_scene_id`；存量分类在迁移中回填默认场景。列可空是 SQLite `ALTER TABLE ADD COLUMN` 的限制，所有 DTO 都会把 `NULL`/悬空 id 归一化为默认场景 id。
- 迁移只增不删，由账本保证只执行一次；表名/索引名随 `TABLE_PREFIX` 三态（未配置=`nav_`、自定义值、显式置空）变化。

### 语义

- 每个分类属于且只属于一个场景；链接**没有**场景字段，其场景由所属分类唯一决定。
- 分类的 `sort_order` 表示**场景内**排序；链接保持原有全局排序语义不变。
- 默认场景只认 `is_default = 1`，不按 id 或名字「通用」查找；`is_default` 只读，API 不提供转移默认场景的能力。
- 搜索引擎不属于任何场景，全场景共用；`visibility` 逻辑完全不变。
- `/api/public`、`/api/private` 返回可见场景（口径见下节「场景可见性」），以及各场景下按既有可见性规则可见的分类；除可见性层外，服务端不按场景切换裁剪，场景切换由客户端本地过滤。
- DTO 形状：`SceneDto{id,name,icon,sortOrder,isDefault,visibility}`；后台场景额外返回 `AdminSceneDto = SceneDto + {createdAt,updatedAt}`；分类 DTO 增加 `sceneId`。

## 场景可见性（v1.2，nav #19 冻结契约）

### 数据模型（迁移 `schema_v3`）

- `{prefix}scenes` 新增 `visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private'))`，与分类同名属性同口径。
- 存量行由列默认值取 `public`（含种子默认场景），因此升级后的默认场景仍是公开的。
- 迁移只增不删、由账本保证只执行一次；`ADD COLUMN` 无 `IF NOT EXISTS`，重放安全与 `schema_v2` 的 `categories.scene_id` 同口径（账本已记录即跳过，绝不重复 `ALTER`）。表名随 `TABLE_PREFIX` 三态变化。

### 语义（两层取与）

- 有效可见性 = **场景公开 AND 分类公开**。私有场景整个空间对外不存在：场景本身、它下面的全部分类（无论分类自身标记）、以及这些分类下的链接，都不进入未登录可见数据。
- 分类自身 `visibility` 保留不动，不做级联改写；公开场景内继续按分类自身 `visibility` 过滤；链接没有独立可见性，跟随分类。
- 登录（所有者）视角全量可见：`/api/private` 返回全部场景（场景 DTO 带 `visibility` 与 `isDefault`）与全部分类；分类 DTO 形状不变（没有 `visibility`/`isDefault`，前端靠「全量里有、公开列表里没有」判断私有）。
- 未登录数据里不得出现私有场景的名称、图标、id 等任何字段（图标注册表 `GET /api/icon` 同口径）。
- 私有场景不得被设为默认：设默认操作遇私有 → 400 `{"error":…}`；默认场景不得改为私有：更新 `visibility` 若当前为默认且目标 `private` → 400，须先移默认。`isDefault` 机制沿用 v1.1，本版不动。
- 删场景时分类迁入默认场景的既有流程不受影响：分类私有标记保留，由上面的取与规则保证不外露。

## 公开

### GET /api/public

200 JSON。有效可见性 = 场景公开 AND 分类公开（两层取与，见「场景可见性」）：只含公开场景、公开分类与公开链接（分类内嵌其公开链接）；私有场景、私有分类、私有链接、以及「private 分类下的 public 链接」完全不出现。响应 `Cache-Control: public, max-age=60`。

```json
{
  "categories": [
    {
      "id": "uuid",
      "name": "分类名",
      "icon": null,
      "sortOrder": 0,
      "sceneId": "scene_default",
      "links": [
        {
          "id": "uuid",
          "categoryId": "uuid",
          "title": "标题",
          "url": "https://…",
          "iconUrl": null,
          "description": null,
          "sortOrder": 0
        }
      ]
    }
  ],
  "scenes": [
    {
      "id": "scene_default",
      "name": "通用",
      "icon": null,
      "sortOrder": 0,
      "isDefault": true,
      "visibility": "public"
    }
  ],
  "searchEngines": [
    {
      "id": "uuid",
      "name": "Google",
      "urlTemplate": "https://www.google.com/search?q={q}",
      "icon": null,
      "sortOrder": 0,
      "isDefault": true
    }
  ],
  "settings": {
    "siteTitle": "nav",
    "backgroundUrl": "",
    "wallpaperSource": "bing",
    "logoUrl": "",
    "columns": 0,
    "searchNewTab": true,
    "linkStyle": "classic"
  }
}
```

`scenes`：按 `sortOrder, createdAt` 排序。`/api/public` **只含 `visibility = 'public'` 的场景**（私有场景整个空间对外不存在：场景、其下分类与链接都不出现）；`/api/private` 返回全量场景。两者都包含「只有私有分类的公开场景」。分类的 `sceneId` 为该分类所属场景，`NULL`/悬空 id 会归一化为默认场景 id。

`wallpaperSource`：首页壁纸来源，`bing`（默认，Bing 每日壁纸）| `custom`（用 `backgroundUrl` 自定义图）。存量库无此键时按 `bing` 返回。

`linkStyle`：首页链接样式，`classic`（默认）| `compact` | `wide`。存量库无此键（或存量值不在枚举内）时按 `classic` 返回。

### GET /api/wallpaper/today

同源代理 Bing 每日壁纸（无鉴权，公共页未登录也要取图）。
- 200：图片二进制，`Content-Type: image/*`；`Cache-Control: public, max-age=<到下一个北京时间零点的秒数>`。
- 回源失败时回退到昨日缓存图（同样 200）；连昨日缓存也无 → `502 {"error":"wallpaper unavailable"}`。
- 服务端按北京时间自然日缓存当天图（内部缓存条目多保留一天以支持次日回退）；不向上游透传 `content-length` / `x-msedge-ref` / `nel` / `report-to` 等头。

### GET /api/icon

worker 端图标解析器：服务端读目标站 HTML 的 `<link rel="icon">` 声明、探测根文件，抓到后缓存并**直接回图字节**。无鉴权（公共页未登录也要显示图标）。前端在 `iconUrl` 非空时直接用它、不请求本端点；首字圆仍是最终兜底。
- 入参 `url`：必填，`encodeURIComponent` 后的绝对 URL（链接的 `url` 或搜索引擎 `urlTemplate` 去掉 `{q}`）。服务端只用它的 host 与 scheme，**不使用 path/query**。
- 缺失/非法（非 http/https、带账号密码、非默认端口、**内网/回环/保留地址**）→ `400 {"error":"url must be an absolute http(s) URL"}`，`Cache-Control: no-store` —— 这类目标在参数校验阶段就被拒，不进注册表。
- **站点注册表**：host 必须已登记在本站数据里 —— 公开链接与搜索引擎的 host 匿名可取；链接的可见性取**更严一方**（私有链接、或私有分类/私有场景下的 public 链接，都需要有效会话），否则按未登记处理。未登记 → `404 {"error":"icon not found"}`，`Cache-Control: public, max-age=3600`，**不发起任何外部请求**（本端点不是开放代理）。同一 host 有多条链接时注册表优先 https。
- **解析顺序**（全部限定在登记的 origin）：`GET https://{host}/` 读 HTML 里 `rel` 含 `icon` / `apple-touch-icon` 的 `<link>`（svg > png > ico，`sizes` 大者优先；相对路径按该 HTML 的真实地址解，含跟随重定向后的路径；声明落在其他 host 的一律忽略）→ 命中即取该图 → 否则依次探测 `/favicon.ico`、`/favicon.svg`、`/favicon.png`、`/apple-touch-icon.png` → 全失败记为「无图」。
- **出网约束**：只请求上述 origin 的根路径与固定根文件；`redirect: "manual"` 自己管重定向 —— **只跟随同一个 host 内的 3xx（最多 2 跳；允许 http→https 升级，禁止降级到 http）**，`Location` 落到别的 host（含子域、CDN）、非默认端口、带账号密码、解析失败或超出跳数，一律视为该候选失败（不扩大出网边界）；单次 5s 超时、一次解析总预算 8s；HTML 读 256KB、图标读 512KB 上限；带 `user-agent: nav-favicon/1`。
- 成功 `200`：图标原始字节，`content-type` 为按魔数嗅探出的真实类型（`image/png` / `image/jpeg` / `image/webp` / `image/gif` / `image/svg+xml` / `image/x-icon`），`cache-control: public, max-age=86400`，`x-content-type-options: nosniff`；**不透传任何上游响应头**。
- 成功与失败响应均带 `vary: Cookie`：同一 URL 匿名可能是 404、带会话才是 200，共享缓存不得把会话结果回给匿名访客。
- **SVG 防护**：第三方 SVG 可能带 `<script>` / 事件属性，因此图标响应一律带 `content-security-policy: default-src 'none'; sandbox` —— `<img>` 加载不受影响，但直接导航到本端点也不会在本站 origin 下执行第三方脚本。
- 无图标 `404 {"error":"icon not found"}` + `cache-control: public, max-age=3600`。
- **缓存**：R2 对象 `_cache/favicons/{host}`（保留前缀，不经 `GET /assets/*` 公开），`customMetadata` 记 `{status:"ok"|"none", fetchedAt, mime?, sourceUrl?}`。「有图」30 天、「无图」7 天视为新鲜；过期时先回旧结果、后台重抓（`waitUntil`），**不用定时任务**；同一 host 的并发解析合并为一次。**刷新失败时保留已在用的好图（只顺延 `fetchedAt`），不会因一次上游抖动把图标降级成负缓存**。R2 未绑定或读写失败时降级为「现抓现发、不缓存」。
- 不读也不改写 `links.icon_url`。

## 私有

### GET /api/private

需有效会话 Cookie（`nav_session`，HttpOnly / Secure / SameSite=Lax）。未登录一律：
- 状态 `401`
- Body `{"error":"unauthorized"}`
- Header `Cache-Control: no-store`

已登录返回与 `/api/public` **同结构**的全量数据（公开 + 私有），`Cache-Control: no-store`。

## 鉴权（/api/auth/*）

| 方法 | 路径                   | 说明                                                                                                                                                                                                                         |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/auth/setup`      | `{"enabled":true}` 表示可创建所有者                                                                                                                                                                                          |
| POST | `/api/auth/setup`      | header `X-Setup-Secret`；body `{username, password}`（password ≥ 8）→ 201 并下发会话，附 `tablePrefix` 与 `migrations:[{name,status}]`（账本迁移结果）；已有账号 → 403；表前缀冲突 → 409 `{"error":"table prefix conflict"}` |
| POST | `/api/auth/login`      | body `{username, password}` → `{success, user}`；若已启用 TOTP → `{requires2fa:true, tempToken}`；失败 401 `{"error":"invalid credentials","remainingAttempts":N}`；连续失败 5 次锁定 15 分钟 → 429                          |
| POST | `/api/auth/2fa/verify` | body `{tempToken, code}`（TOTP 6 位）→ 200 并下发会话；错误码 401                                                                                                                                                            |
| POST | `/api/auth/logout`     | 吊销当前会话                                                                                                                                                                                                                 |
| GET  | `/api/auth/session`    | 会话探测：`{"authenticated":true,"userId":…}`；未登录 401 JSON                                                                                                                                                               |

Passkey（WebAuthn，/api/auth/passkey/*，@simplewebauthn/server v14）：

| 方法       | 路径                                                         | 说明                                              |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------- |
| POST       | `/register/options`                                          | 登录后注册 passkey 的 options（rpID = 请求 host） |
| POST       | `/register/verify`                                           | 校验注册响应，落库 `passkey_credentials`          |
| POST       | `/authenticate/options`                                      | 免登录取断言 options（可带 `{username}`）         |
| POST       | `/authenticate/verify`                                       | 校验断言，成功即建会话                            |
| GET/DELETE | `/credentials`                                               | 查看 / 清除 passkey                               |
| GET        | `/totp`、POST `/totp/setup`、`/totp/enable`、`/totp/disable` | TOTP 管理（disable 需再输密码）                   |

登录失败锁定：`login_attempts` 表按 username+IP 计数，5 次失败锁定 15 分钟；`/2fa/verify` 对同一 tempToken 连续 5 次错误即作废。

## 后台（/api/admin/*，全部需会话，未登录 401 JSON `{"error":"unauthorized"}`）

### 场景

- `GET /api/admin/scenes` → `{scenes:[AdminSceneDto]}`（按 `sortOrder, createdAt` 排序，含默认场景，每项带 `visibility`/`isDefault`）
- `POST /api/admin/scenes` body `{name, icon?, sortOrder?, visibility?}` → 201 `AdminSceneDto`
  - `name` 去空格后不可为空，否则 400 `{"error":"name is required"}`；`icon` 非字符串按 `null`；省略 `sortOrder` 时追加到末尾（现有 `MAX(sort_order)+1`）。
  - `visibility`：`public`（缺省）| `private`，其他值 → 400 `{"error":"visibility must be 'public' or 'private'"}`。
  - `isDefault` 只读，传入会被忽略；场景名不做库级唯一约束。例外：`isDefault: true` 与 `visibility: 'private'` 同时出现 → 400 `{"error":"private scene cannot be set as default"}`（私有场景不得为默认）。
- `PUT /api/admin/scenes/:id` body `{name?, icon?, sortOrder?, visibility?}` → 更新后的 `AdminSceneDto`
  - `name` 去空格后不可为空，否则 400 `{"error":"name must not be empty"}`；`isDefault` 静默忽略；不存在 → 404 `{"error":"not found"}`。
  - `visibility` 非法值 → 400 `visibility must be 'public' or 'private'`；当前是默认场景而目标 `private` → 400 `{"error":"default scene cannot be private"}`（须先移默认；被拒时整个更新不落库）。私有场景上请求 `isDefault: true` → 400 `private scene cannot be set as default`。
- `DELETE /api/admin/scenes/:id` → `{success:true}`
  - 默认场景 → 400 `{"error":"default scene cannot be deleted"}`；不存在 → 404 `{"error":"not found"}`。
  - 非默认场景：在**单个 `db.batch` 事务**里，先把该场景的全部分类移动到默认场景，`sort_order` 追加到默认场景现有分类之后（以默认场景内 `MAX(sort_order)+1` 为基数，保持分类相对顺序），再删除场景（SQL 层带 `is_default = 0` 守卫）；链接随分类走，不搬不改。
- `POST /api/admin/scenes/reorder` body `{ids:[…]}`（顺序即 `sortOrder`）→ `{success:true}`

### 分类

- `GET /api/admin/categories` → `{categories:[{id,name,icon,sortOrder,visibility,sceneId,createdAt,updatedAt}]}`（全量，不按场景裁剪）
- `POST /api/admin/categories` body `{name, icon?, sortOrder?, visibility?, sceneId?}`（visibility: `public`|`private`）→ 201 `{id,…}`（含 `sceneId`）
  - 省略 `sceneId` 时归入默认场景；显式传入但场景不存在 → 400 `{"error":"sceneId does not exist"}`。
- `PUT /api/admin/categories/:id`（字段同上，部分更新）→ 更新后对象（含 `sceneId`）
  - 改 `sceneId` 即把整个分类移到目标场景（不另开端点）；链接随分类走，不删不改。`sceneId` 不存在 → 400 `{"error":"sceneId does not exist"}`。
  - 移场景时若同时给了 `sortOrder` 则以它为准；未给 `sortOrder` 时追加到目标场景末尾（目标场景内 `MAX(sort_order)+1`），不会与目标场景现有排序撞号。
- `DELETE /api/admin/categories/:id` → `{success:true}`（级联删除其链接）
- `POST /api/admin/categories/reorder` body `{ids:[…]}`（顺序即场景内 sortOrder；客户端只提交当前场景的分类全集，服务端不按场景校验）→ `{success:true}`

### 链接

- `GET /api/admin/links` → `{links:[{id,categoryId,title,url,iconUrl,description,sortOrder,visibility,createdAt,updatedAt}]}`
- `POST /api/admin/links` body `{title, url, categoryId, iconUrl?, description?, sortOrder?, visibility?}` → 201 `{id}`
- `PUT /api/admin/links/:id`（部分更新）→ 更新后对象
  - `categoryId` 不存在 → 400 `{"error":"categoryId does not exist"}`；改 `categoryId` 即把链接搬到目标分类（不另开端点，链接的 `sortOrder` 仍是**全局**序号，不是分类内序号）。
  - 搬分类时若同时给了 `sortOrder` 则以它为准；未给 `sortOrder` 时落到目标分类末尾（全表 `MAX(sort_order)+1`，与分类跨场景搬家同一口径），不会与现有排序撞号；`categoryId` 传的是原分类（未变）时不动顺序。
- `DELETE /api/admin/links/:id` → `{success:true}`
- `POST /api/admin/links/reorder` body `{ids:[…]}` → `{success:true}`

### 搜索引擎

- `GET /api/admin/search-engines` → `{searchEngines:[{id,name,urlTemplate,icon,sortOrder,isDefault}]}`
- `POST /api/admin/search-engines` body `{name, urlTemplate(含 {q}), icon?, sortOrder?, isDefault?}` → 201 `{id}`
- `PUT /api/admin/search-engines/:id` → `{id}`（设 `isDefault:true` 会自动清掉其他默认）
- `DELETE /api/admin/search-engines/:id` → `{success:true}`
- `POST /api/admin/search-engines/reorder` body `{ids:[…]}` → `{success:true}`

### 站点设置

- `GET /api/admin/settings` → `{siteTitle, backgroundUrl, wallpaperSource, logoUrl, columns, searchNewTab, linkStyle}`
- `PUT /api/admin/settings` body 可含 `{siteTitle, backgroundUrl, wallpaperSource(bing|custom), logoUrl, columns(0–12), searchNewTab(boolean), linkStyle(classic|compact|wide)}` → 更新后对象

主题（设深色/浅色）**不在**站点设置里：深浅色只由访客本机偏好（顶栏主题按钮，`localStorage` 键 `nav.visitor-theme`）决定，没有偏好时跟随系统外观。`PUT` 传 `theme` 不生效（白名单外的键一律忽略）；存量的 `settings.theme` 行不删不迁移，只是停产不用。

`searchNewTab`：搜索是否在新标签页打开。存储键 `search_new_tab`，值 `"1"`/`"0"`（同 `totp_enabled` 的 KV 布尔惯例）；库中**无此键**（存量库）时按 `true` 返回。写入只接受布尔值，非布尔返回 400 `searchNewTab must be a boolean`。

`wallpaperSource`：首页壁纸来源。存储键 `wallpaper_source`，值 `"bing"`/`"custom"`；库中**无此键**（存量库）时按 `bing` 返回。写入只接受 `bing`/`custom`，其他值返回 400 `wallpaperSource must be 'bing' or 'custom'`。

`linkStyle`：首页链接样式。存储键 `link_style`，值 `"classic"`/`"compact"`/`"wide"`；库中**无此键**（存量库）时按 `classic` 返回，存量脏值同样归一为 `classic`（不改写库行）。写入只接受这三个字符串值（非字符串一律拒绝），其他值返回 400 `linkStyle must be 'classic', 'compact' or 'wide'`，且一次被拒的请求不会写入同包的任何设置键。

`columns` 允许 `0–12`，其中 `0` 表示**未配置**（用默认值）：`0` 原样存入并原样返回，不会被替换成默认列数。`GET /api/admin/settings` 对未配置的库返回 `columns: 0`，所以 `0–12` 都能往返提交；超出范围返回 400 `columns must be between 0 and 12`。

`backgroundUrl` / `logoUrl` 的值可以是外链 URL，也可以是本地上传路径（`/assets/…`，见下节）。`/assets/…` 被替换成**任何**其他值时，旧 R2 对象自动删除；外链旧值一律不删。

`setup_page_enabled`（setup 页面开关）**不在**站点设置白名单内，也不出现在 `SiteSettingsDto` / `/api/public` 输出；它只走下面的系统管理端点。

### 资源（上传图片，ONE-444）

上传对象存在 R2 桶 `nav-assets`（Worker 绑定名 `R2`；`ASSETS` 已被 Workers Static Assets 占用）。对象键 `assets/{purpose}/{uuid}.{ext}`，公开路径 `/assets/{key}`（因此实际形如 `/assets/assets/background/…`，为父单冻结的字面规则）。
- `POST /api/admin/assets`（需会话，`multipart/form-data`）
  - 字段：`file`（必填）、`purpose`（必填，`background` | `logo` | `icon`）。
  - 双重校验：声明的 Content-Type 必须是 `image/png` / `image/jpeg` / `image/webp` / `image/gif` / `image/svg+xml` / `image/x-icon`（也接受 `image/vnd.microsoft.icon`）之一，**且**文件头魔数与之相符；SVG 无魔数，改为校验内容前缀（允许 BOM/空白后）为 `<?xml` 或 `<svg>`。扩展名由校验出的类型决定（png/jpg/webp/gif/svg/ico），不信任文件名。
  - 大小：`background` ≤ 5MB；`logo`、`icon` ≤ 1MB。
  - 201 `{ "path": "/assets/assets/{purpose}/{uuid}.{ext}" }`
  - 400 `{"error":"…"}`：purpose 非法/缺失、缺 file、Content-Type 不支持、内容与声明不符、空文件；413 `{"error":"…"}`：超出该用途上限（文案含实际字节数与上限）。
  - 环境未绑定 R2 → 503 `{"error":"asset storage unavailable: …"}`（不崩）。
- `GET /assets/*`（公开读，无鉴权；`*` 即对象键）
  - 200：正确 `Content-Type`；`Cache-Control: public, max-age=31536000, immutable`；`X-Content-Type-Options: nosniff`（SVG 固定 `image/svg+xml`，不会被当 HTML 解析）。
  - 对象不存在或环境未绑定 R2 → 404。
- `DELETE /api/admin/assets`（需会话）body `{ "key": "assets/{purpose}/{uuid}.{ext}" }`（也接受公开路径形式）→ `{ "success": true }`；缺 key → 400；未绑定 R2 → 503。

自动清旧：`PUT /api/admin/settings` 中 `backgroundUrl` 或 `logoUrl` 从某个 `/assets/…` 值被替换成别的值（外链或新上传路径）时，旧 R2 对象被删除；旧值为外链时不删。

### 系统管理（`/api/admin/setup`、`/api/admin/system*`，需会话）

- `POST /api/admin/setup` → 免密钥跑账本迁移，响应形状与 `POST /api/setup` 完全一致（含 409 冲突形状）
- `GET /api/admin/system` → `{tablePrefix, setupPageEnabled, ledger}`（`ledger` 为账本已记录迁移名，按应用顺序）
- `PUT /api/admin/system/setup-page` body `{enabled: boolean}`（严格布尔，非布尔 400 `{"error":"enabled must be a boolean"}`）→ `{setupPageEnabled}`

## Setup（`/api/setup/*`）

- `GET /api/setup/state` → 无鉴权，`Cache-Control: no-store`，`{enabled, ownerExists, tablePrefix}`；不含任何密钥/哈希。`ownerExists` = `{prefix}users` 行数 > 0（表不存在按 `false`）。`enabled`：未初始化恒 `true`；已初始化时只有 `{prefix}settings.setup_page_enabled = '1'` 为开，缺省（无此行）与 `'0'` 均为关。
- `GET /api/setup/status` → 同一逻辑/同一载荷的兼容别名（SPA 已迁到 `state`）。
- `POST /api/setup` → header `X-Setup-Secret`（只走请求头，无 GET/查询参数形态）；密钥缺失/占位符 → 500 `{"error":"server misconfigured"}`，不匹配 → 403；按来源 IP 每 10 分钟最多 3 次，超限 429（带 `Retry-After` 与 `retryAfterSeconds`）。动作只有账本迁移（不建用户、不改密码、不删表）：200 `{success, tablePrefix, migrations:[{name,status}], ownerExists}`，前缀冲突 409 `{"error":"table prefix conflict","detail":…}`。
- setup 页面开关**只门控页面**，不门控 `POST /api/setup` 与 `POST /api/auth/setup`（密钥即门闩）。

## 说明

- 图标自动抓取由 worker 做：见上方 `GET /api/icon`（服务端解析 + R2 缓存 + 直接回图）。前端只在 `iconUrl` 为空时请求该端点，失败回退首字圆；后端仍只存 `iconUrl` 字段。
- 点击计数、服务健康状态为预留字段，v1 不实现（SPEC 第 5 节）。
- 会话 Cookie `nav_session`：HS256 JWT 签名 + `sessions` 表吊销，7 天有效。
