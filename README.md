# MSubGA

> Make subscription great again!

自托管的节点管理与订阅生成工具。以**节点池**为中心：导入各种格式的节点 → 自定义命名打标签 → 用真实代理内核测延迟 → 勾选节点挂上规则模板 → 产出可长期订阅的链接。

和 SubBoost 那类「订阅进 → 订阅出」的转换器不同，MSubGA 的数据模型围绕节点建：节点是一等公民，有自己的名字、标签和延迟历史，订阅只是节点池的一个视图。

## 它能做什么

**导入节点**
- 协议链接：VLESS / VMess / Trojan / Shadowsocks / Hysteria2 / TUIC / AnyTLS / HTTP(S) / SOCKS5
- 纯文本：`host:port:user:pass`、`host:port`、`user:pass@host:port`，以及逗号/空格/制表符分隔的变体
- 整段 base64 的节点列表，直接粘贴自动解码
- 一次粘一大段，混着来也行。解析失败的行会带着行号和原因列出来，不会让整批导入失败
- 按配置指纹去重，改过的名字不会被重复导入覆盖

**测延迟**
- **内核真实延迟**：起一个 mihomo 进程，实际连一次测速 URL。测得出「节点是否真能用」，不只是「服务器是否可达」
- **TCP 握手**：纯 Node 实现，快，但只说明服务器可达
- **先粗筛再精测**：先用 TCP 剔掉不可达的，再对活着的走内核
- 结果通过 SSE 实时推到界面，逐行刷新，不用等整批跑完
- 单个畸形节点不会拖垮整批：内核拒绝加载时会定位出坏节点单独标错，其余照测

**规则与订阅**
- 规则集：内置 16 个（广告拦截、国内域名/IP、Google、GitHub、Telegram、OpenAI 等，指向 MetaCubeX/meta-rules-dat 的 `.mrs`），也可以自己写内联规则
- 规则模板：可视化编辑策略组和规则顺序（拖拽排序），也可以切到 JSON 高级模式直接改。保存前实时校验
- 订阅：手动勾选节点，或写筛选条件让它动态求值；输出 Clash/Mihomo YAML 或 base64 链接列表，按客户端 UA 自动判断
- **用内核校验**：把生成结果丢给真正的 `mihomo -t` 跑一遍。这是「吐出去的配置一定能被客户端加载」的最后保证

## 快速开始

需要 **Node 22.13+**（数据库用的是 Node 内置的 `node:sqlite`，没有任何需要编译的原生依赖）。服务默认监听 **27981**。

```bash
npm install
npm run build
MSUBGA_PASSWORD=你的密码 npm start
```

开发模式（前端 5173，后端 27981，自动转发）：

```bash
npm run dev
```

## 部署到服务器

仓库自带一键部署脚本。第一次先把配置准备好：

```bash
git clone <你的仓库地址> /opt/MSubGA && cd /opt/MSubGA
cp .env.deploy.example .env.deploy && vi .env.deploy
```

之后每次更新只要一条命令，它会拉代码、装依赖、构建、重启、做健康检查：

```bash
./deploy.sh
```

其他用法：

```bash
./deploy.sh status      # 看运行状态
./deploy.sh stop        # 停服务
SKIP_PULL=1 ./deploy.sh # 不拉代码，只重新构建重启
```

### 反向代理

服务默认监听 `0.0.0.0:27981`，对外怎么暴露由你自己决定（nginx、Caddy、frp 都行）。
应用这边不需要反代做任何特殊配置：

- 会话 cookie 的 `Secure` 标记按「设置 → 站点 → 对外访问地址」判断，不依赖反代传 `X-Forwarded-Proto`
- 测速的 SSE 流自带 `X-Accel-Buffering: no`，nginx 认这个头，不用手动关 buffering

**唯一必须做的是把对外地址填对**（`.env.deploy` 里的 `MSUBGA_BASE_URL`，或部署后在设置页改），
订阅链接按它拼；填错的话客户端会拿到一个够不着的地址。

### 开机自启

```bash
sudo cp deploy/msubga.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now msubga
```

用了 systemd 之后，更新改成 `SKIP_START=1 ./deploy.sh && sudo systemctl restart msubga`。

### Docker

```bash
MSUBGA_PASSWORD=你的密码 MSUBGA_BASE_URL=https://你的域名 docker compose up -d
```

## 配置

全部通过环境变量，见 [.env.example](.env.example) 和 [.env.deploy.example](.env.deploy.example)。

| 变量 | 说明 |
| --- | --- |
| `PORT` / `HOST` | 监听地址，默认 `0.0.0.0:27981`。反代和本服务在同一台机器、且不想让内网直连，可以收紧成 `127.0.0.1` |
| `MSUBGA_PASSWORD` | 首次启动时设置管理员密码。设置过之后就不再生效，改密码走设置页 |
| `MSUBGA_BASE_URL` | 对外访问地址，订阅链接按它拼，也决定 cookie 要不要带 `Secure`。**跑在反代后面时必须填**。只在数据库里还没填过时生效 |
| `MSUBGA_DATA_DIR` | 数据目录，默认仓库根目录下的 `data/` |
| `MIHOMO_PATH` | 手动指定 mihomo 可执行文件；不填则在设置页点「自动下载」 |

## 两个要知道的前提

**测速位置 = 部署位置。** 服务跑在哪台机器上，测出来就是那台机器到节点的延迟。部署在 VPS 上测出的数字和你本机的体感无关。

**节点凭据在 SQLite 里是明文，订阅 token 泄露等于节点泄露。** token 是 32 字节随机串，可以在订阅列表里随时轮换（旧链接立刻失效）。字段级加密还没做。

## 项目结构

```
packages/
├─ core/      纯逻辑，零 IO：协议解析/序列化、批量导入、配置生成、模板校验
│             全部是纯函数，用 fixtures 单测，不需要起服务也不需要真节点
├─ server/    Hono + SQLite(Drizzle)：API、订阅出口、mihomo 集成、静态托管
└─ web/       React + Vite + Tailwind
```

`core` 独立成包是整个设计的支点——协议解析和配置生成这两块最容易出错的逻辑，可以脱离运行环境完整测试。

## 开发

```bash
npm test          # core 的单元测试
npm run typecheck # 三个包一起类型检查
npm run build     # core → web → server 依次构建
```

`core` 里改了 schema 之后要重新生成迁移：

```bash
npm run db:generate
```

### 测试覆盖的重点

- 每个协议的 `parseUri → toUri` 往返一致性，以及 `toClash` 的字段映射快照（reality / ws / grpc / h2 各种 transport 组合）
- 导入器对畸形输入的处理：截断的 base64、缺端口、端口越界、重复节点——都必须被收集成带行号的错误而不是抛出
- 模板校验器：空策略组、悬空引用、循环引用、缺 MATCH、MATCH 不在末尾
- 生成器：三个内置模板都要能产出内部自洽的配置（每个策略组成员都能被解析到、每条 RULE-SET 引用的 provider 都有定义）

## 许可

MIT
