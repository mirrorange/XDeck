# XDeck - 架构设计文档 (ADD)

> **版本**: v0.1.0
> **作者**: Orange
> **创建日期**: 2026-03-01
> **最后更新**: 2026-03-02
> **关联文档**: [PRD v0.1.1](./PRD.md)

---

## 目录

1. [引言](#1-引言)
2. [架构总览](#2-架构总览)
3. [分层架构设计](#3-分层架构设计)
4. [核心模块设计](#4-核心模块设计)
5. [通信协议设计](#5-通信协议设计)
6. [数据模型设计](#6-数据模型设计)
7. [安全架构](#7-安全架构)
8. [部署架构](#8-部署架构)
9. [关键技术决策](#9-关键技术决策)
10. [错误处理与可靠性](#10-错误处理与可靠性)
11. [可扩展性设计](#11-可扩展性设计)

---

## 1. 引言

### 1.1 文档目的

本文档是 XDeck 项目的架构设计文档 (Architecture Design Document)，旨在从技术实现角度详细描述系统的整体架构、模块划分、通信机制、数据模型和关键设计决策，为后续开发提供明确的技术指导。

### 1.2 架构目标

| 目标       | 描述                                                       | 度量指标                |
| ---------- | ---------------------------------------------------------- | ----------------------- |
| **轻量**   | 极低资源占用，适用于从树莓派到服务器的各种环境              | 空闲内存 < 30MB         |
| **跨平台** | 单一核心代码库支撑桌面版 (Tauri) 与服务器版 (Headless)     | 支持 macOS/Windows/Linux |
| **实时**   | WebSocket 双向通信，所有状态变更即时推送                    | 本地延迟 < 50ms         |
| **可扩展** | 模块化设计，各功能模块可独立迭代，便于后续增加新能力        | 新增模块不改动核心框架   |
| **安全**   | 多层安全机制，适用于本地开发和远程生产环境                  | 通信加密 + Token 认证    |
| **AI 原生** | MCP Server 独立组件，所有功能可通过 AI 调用                | 100% 功能 MCP 可达      |

### 1.3 约束条件

- 后端必须使用 Rust 以满足极低资源占用的目标
- 前端使用 React SPA，需兼容 Tauri WebView 和浏览器环境
- 嵌入式 SQLite 作为唯一数据存储，不引入外部数据库依赖
- 所有客户端-服务端通信统一使用 WebSocket (JSON-RPC 2.0)

---

## 2. 架构总览

### 2.1 系统上下文图 (C4 - Level 1)

```
                    ┌─────────────┐
                    │   开发者 /   │
                    │   运维人员   │
                    └──────┬──────┘
                           │ 使用
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌────────────┐ ┌─────────┐ ┌──────────┐
       │ Tauri 桌面版│ │ 浏览器   │ │ AI 客户端 │
       │            │ │ Web UI  │ │ (Claude…) │
       └─────┬──────┘ └────┬────┘ └────┬─────┘
             │              │           │
             │              │      ┌────▼──────┐
             │              │      │ MCP Server │
             │              │      └────┬───────┘
             └──────────┬───┴───────────┘
                        │ WebSocket (JSON-RPC 2.0)
                   ┌────▼────┐
                   │ XDeck   │
                   │ Daemon  │
                   └────┬────┘
                        │ 管理
         ┌──────┬───────┼───────┬──────┐
         ▼      ▼       ▼       ▼      ▼
      [Nginx] [进程] [Docker] [PTY] [Certbot]
```

### 2.2 核心设计原则

| 原则                 | 实践                                                               |
| -------------------- | ------------------------------------------------------------------ |
| **单一职责**         | 每个 Manager 只负责一个领域（Nginx/Process/Docker…）               |
| **统一通信接口**     | 所有客户端（Web UI / MCP Server）使用完全相同的 JSON-RPC API       |
| **事件驱动**         | 状态变更通过事件总线广播，客户端通过 WebSocket 订阅实时事件        |
| **无状态 API 层**    | WebSocket 会话仅保持连接和认证状态，业务状态持久化在 SQLite 中     |
| **优雅降级**         | Docker / Nginx 不可用时，Daemon 核心功能不受影响                   |

---

## 3. 分层架构设计

### 3.1 Daemon 内部分层

```
┌──────────────────────────────────────────────────┐
│                  API 层 (Axum)                   │
│  WebSocket Handler ──► JSON-RPC Router           │
│  REST Handler (health/static)                    │
├──────────────────────────────────────────────────┤
│               服务层 (Service Layer)              │
│  AuthService │ NodeService │ EventBus            │
├──────────────────────────────────────────────────┤
│              管理器层 (Manager Layer)             │
│  NginxMgr │ ProcessMgr │ DockerMgr │ PtyMgr     │
│  CertbotMgr │ SystemMonitor                      │
├──────────────────────────────────────────────────┤
│              基础设施层 (Infra Layer)             │
│  SQLite (rusqlite) │ Config (TOML) │ Logger      │
│  Process Spawner   │ FS Watcher    │ Scheduler   │
└──────────────────────────────────────────────────┘
```

### 3.2 各层职责

#### API 层

- **WebSocket Handler**: 接受 WebSocket 连接，管理会话生命周期，处理认证握手
- **JSON-RPC Router**: 解析 JSON-RPC 2.0 消息，根据 `method` 字段路由到对应的服务/管理器
- **REST Handler**: 提供 `/health` 健康检查端点和 Web UI 静态资源服务
- **中间件**: 认证校验、请求限流、操作审计日志

#### 服务层

- 承载跨模块的业务逻辑协调
- `AuthService`: 会话管理、Token 验证
- `NodeService`: 多节点注册、心跳、状态管理
- `EventBus`: 内部事件分发与 WebSocket 推送

#### 管理器层

- 每个管理器封装一个域的完整逻辑（生命周期、配置、状态）
- 管理器之间通过 `EventBus` 松耦合通信
- 管理器通过 trait 定义统一接口，便于测试和替换

#### 基础设施层

- 提供数据持久化、配置加载、日志记录、进程管理等基础能力
- 不包含业务逻辑

### 3.3 前端架构

```
┌────────────────────────────────────────────────┐
│                  React SPA                     │
├────────────────────────────────────────────────┤
│  Pages (路由页面)                               │
│  Dashboard │ Sites │ Processes │ Docker │ ...  │
├────────────────────────────────────────────────┤
│  Components (UI 组件)                           │
│  通用组件 │ 业务组件 │ 布局组件                  │
├────────────────────────────────────────────────┤
│  State Management (状态管理)                    │
│  Zustand Store │ React Query (WS 缓存)         │
├────────────────────────────────────────────────┤
│  Transport Layer (通信层)                       │
│  WebSocket Client │ JSON-RPC Client             │
│  ConnectionManager │ ReconnectStrategy          │
└────────────────────────────────────────────────┘
```

**关键设计决策**:

- 使用 **Zustand** 管理全局状态（节点信息、认证状态、UI 偏好）
- 使用封装的 **JSON-RPC Client** 处理请求/响应，支持超时、重试
- WebSocket 连接管理器实现自动重连（指数退避）
- 使用 **xterm.js** 实现 Web 终端
- `React Router v7` 管理路由，按功能模块进行代码分割 (lazy loading)

---

## 4. 核心模块设计

### 4.1 进程守护模块 (ProcessManager)

进程守护是 XDeck 的核心能力之一，负责管理用户定义的应用进程的完整生命周期。

#### 4.1.1 状态机

```
                    ┌─────────┐
          ┌─────────│ Created │
          │ start() └────┬────┘
          │              │
          ▼              ▼
     ┌─────────┐   ┌──────────┐    exit(0)    ┌─────────┐
     │ Starting │──►│ Running  │──────────────►│ Stopped │
     └─────────┘   └─────┬────┘               └────┬────┘
                         │                          │
                    exit(≠0)                   start()
                         │                          │
                         ▼                          │
                   ┌──────────┐    policy:always     │
                   │ Errored  │────────────────────►│
                   └──────┬───┘                     │
                          │ max_retries             │
                          ▼                         │
                   ┌────────────┐                   │
                   │ Failed     │◄──────────────────┘
                   │ (不再重启)  │     (手动恢复)
                   └────────────┘
```

#### 4.1.2 核心数据结构

```rust
pub struct ManagedProcess {
    pub id: String,              // UUID
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
    pub status: ProcessStatus,
    pub restart_policy: RestartPolicy,
    pub pid: Option<u32>,
    pub cpu_usage: f32,
    pub memory_bytes: u64,
    pub uptime: Duration,
    pub restart_count: u32,
    pub group: Option<String>,
    pub auto_start: bool,
    pub created_at: DateTime<Utc>,
}

pub enum ProcessStatus {
    Created, Starting, Running, Stopped, Errored, Failed,
}

pub struct RestartPolicy {
    pub strategy: RestartStrategy, // Always | OnFailure | Never
    pub max_retries: Option<u32>,
    pub delay: Duration,
    pub backoff_multiplier: f64,   // 指数退避倍数
}
```

#### 4.1.3 日志管道

```
子进程 stdout/stderr
        │
        ▼
  ┌───────────────┐
  │  Log Splitter  │──────► [日志文件: 按大小/日期轮转]
  │  (tokio mpsc)  │
  └───────┬───────┘
          │
          ▼
  ┌───────────────┐
  │  Log Buffer    │──────► [WebSocket 实时推送给订阅的客户端]
  │  (ring buffer) │
  └───────────────┘
```

- 使用 `tokio::process::Command` 以异步方式管理子进程
- stdout/stderr 通过 `mpsc` channel 分流到文件写入和内存缓冲
- Ring buffer 保留最近 N 行日志，供新连接的客户端快速获取近期日志
- 日志文件按配置的大小 (默认 50MB) 或日期进行轮转

#### 4.1.4 输入解析模型（Parse-First）

ProcessManager 的输入处理采用“解析优先”而非“业务前手动校验”：

```
JSON params
    │ serde 反序列化
    ▼
RawRequest
    │ try_parse()
    ▼
ParsedRequest (强类型 + 业务可用值)
    │
    ▼
Manager 业务逻辑
```

- 基础约束由 `nutype` 新类型表达（如非空、最小值、范围）
- 资源类约束在 parse 阶段完成（命令存在、工作目录存在且为目录）
- 解析阶段支持 **Error Accumulation**：一次返回多个字段错误，避免用户多轮提交
- 错误输出统一为 `BadRequestWithDetails`，并在 JSON-RPC `error.data.details` 提供结构化详情
- 当前已在 `process.create` 与 `process.logs` 路径中落地

### 4.2 Nginx 管理模块 (NginxManager)

#### 4.2.1 配置生成架构

```
用户输入 (站点配置)
        │
        ▼
┌────────────────┐
│ Config Template │── Tera 模板引擎
│ Engine         │
└───────┬────────┘
        │ 生成
        ▼
┌────────────────┐
│ Config Validator│── nginx -t 语法检查
└───────┬────────┘
        │ 通过
        ▼
┌────────────────┐
│ Config Writer   │── 原子写入 + 备份旧版本
└───────┬────────┘
        │
        ▼
  nginx -s reload
```

#### 4.2.2 配置目录结构

```
/etc/xdeck/nginx/               # XDeck 管理的 Nginx 配置根目录
├── nginx.conf                   # 主配置（include sites-enabled）
├── sites-available/             # 所有站点配置
│   ├── example.com.conf
│   └── api.example.com.conf
├── sites-enabled/               # 已启用的站点（符号链接）
│   └── example.com.conf -> ../sites-available/example.com.conf
├── snippets/                    # 可复用配置片段 (SSL, security headers…)
│   ├── ssl-params.conf
│   └── proxy-params.conf
└── backups/                     # 配置备份（按时间戳）
    └── 20260301_120000/
```

### 4.3 Docker 管理模块 (DockerManager)

#### 4.3.1 与 Docker 通信

```
DockerManager
      │
      ▼
┌──────────────┐
│ bollard crate │──► Docker Engine API (Unix Socket / TCP)
│ (Docker SDK)  │    /var/run/docker.sock
└──────────────┘
```

- 使用 `bollard` crate 通过 Docker Engine API 与 Docker 守护进程通信
- 支持 Unix Socket (本地) 和 TCP (远程) 两种连接方式
- Docker Compose 操作通过调用 `docker compose` CLI 实现 (兼容性更好)
- 使用 Docker Event Stream 监听容器状态变更，通过 EventBus 推送

### 4.4 PTY 管理模块 (PtyManager)

```
前端 xterm.js ◄──── WebSocket ────► PtyManager ──► PTY (伪终端)
  (终端渲染)        (双向字节流)      (portable-pty)    (shell)
```

- 使用 `portable-pty` crate 跨平台创建伪终端
- 每个 PTY 会话对应一个唯一 ID，支持多客户端共享同一会话
- WebSocket 消息中使用 Binary Frame 传输终端原始数据，减少编码开销
- 终端窗口大小变更 (resize) 通过 JSON-RPC 通知传递

### 4.5 Certbot/ACME 管理模块 (CertbotManager)

```
CertbotManager
      │
      ├──► certbot CLI (subprocess)
      │    ├── HTTP-01 验证 (需要 80 端口)
      │    └── DNS-01 验证 (API 调用 DNS 提供商)
      │
      └──► 证书监控调度器 (Scheduler)
           └── 每日检查证书到期时间
               └── 到期前 30 天自动续期
```

### 4.6 系统监控模块 (SystemMonitor)

```rust
pub struct SystemStatus {
    pub cpu_usage: f32,           // 总 CPU 使用率 (%)
    pub cpu_cores: usize,
    pub memory_total: u64,        // 总内存 (bytes)
    pub memory_used: u64,
    pub disk_partitions: Vec<DiskPartition>,
    pub network_interfaces: Vec<NetworkInterface>,
    pub uptime: Duration,
    pub load_average: [f64; 3],   // 1/5/15 分钟
    pub os_info: OsInfo,
}
```

- 使用 `sysinfo` crate 采集系统指标
- 默认每 2 秒采集一次，通过 EventBus 推送到前端
- 历史数据按 1 分钟粒度存入 SQLite，保留 24 小时

---

## 5. 通信协议设计

### 5.1 WebSocket 连接生命周期

```
Client                              Daemon
  │                                   │
  │──── HTTP Upgrade /ws ────────────►│
  │◄─── 101 Switching Protocols ─────│
  │                                   │
  │──── auth.login {token/pass} ────►│
  │◄─── auth.login result ───────────│
  │                                   │
  │──── subscribe {topics} ─────────►│  (订阅事件)
  │◄─── OK ──────────────────────────│
  │                                   │
  │──── method.call ────────────────►│  (业务请求)
  │◄─── method.result ───────────────│
  │                                   │
  │◄─── event notification ──────────│  (服务端推送)
  │                                   │
  │──── Ping ───────────────────────►│  (每 30s)
  │◄─── Pong ────────────────────────│
  │                                   │
```

### 5.2 JSON-RPC 方法命名规范

方法名采用 `模块.动作` 的点分格式：

```
# 前缀            示例方法
system.*          system.status, system.info
auth.*            auth.login, auth.logout, auth.refresh
process.*         process.list, process.start, process.stop, process.restart, process.logs
nginx.*           nginx.status, nginx.reload, nginx.config.get, nginx.config.set
site.*            site.list, site.create, site.delete, site.update
cert.*            cert.list, cert.apply, cert.renew
docker.container.* docker.container.list, docker.container.start, docker.container.stop
docker.compose.*  docker.compose.up, docker.compose.down
docker.image.*    docker.image.list, docker.image.pull
node.*            node.list, node.add, node.remove, node.heartbeat
pty.*             pty.create, pty.resize, pty.close
event.*           event.subscribe, event.unsubscribe
```

### 5.3 事件推送命名规范

```
event.process.status_changed    # 进程状态变更
event.process.log               # 进程日志输出
event.docker.container.state    # 容器状态变更
event.system.metrics            # 系统指标更新
event.cert.expiring             # 证书即将到期
event.node.online               # 节点上线
event.node.offline              # 节点离线
```

### 5.4 错误码设计

| 范围          | 类别         | 示例                                    |
| ------------- | ------------ | --------------------------------------- |
| -32700~-32600 | JSON-RPC 标准 | -32700 Parse error, -32601 Method not found |
| 1000~1999     | 认证错误     | 1001 Unauthorized, 1002 Token expired   |
| 2000~2999     | 进程管理     | 2001 Process not found, 2002 Already running |
| 3000~3999     | Nginx/站点   | 3001 Config invalid, 3002 Port conflict |
| 4000~4999     | Docker       | 4001 Docker not available, 4002 Container not found |
| 5000~5999     | 证书         | 5001 ACME challenge failed              |
| 6000~6999     | 节点管理     | 6001 Node unreachable                   |

`INVALID_PARAMS (-32602)` 推荐错误数据结构：

```json
{
  "details": [
    { "field": "name", "message": "must not be empty" },
    { "field": "restart_policy.delay_ms", "message": "must be greater than 0" }
  ]
}
```

---

## 6. 数据模型设计

### 6.1 SQLite 数据库架构

```sql
-- 用户与认证
CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,       -- argon2 哈希
    role        TEXT NOT NULL DEFAULT 'admin', -- admin | operator | readonly
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE api_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token_hash  TEXT UNIQUE NOT NULL,  -- SHA-256 哈希，原文仅创建时展示
    name        TEXT NOT NULL,
    expires_at  TEXT,
    created_at  TEXT NOT NULL
);

-- 进程守护
CREATE TABLE processes (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    command         TEXT NOT NULL,
    args            TEXT NOT NULL DEFAULT '[]',  -- JSON array
    cwd             TEXT NOT NULL,
    env             TEXT NOT NULL DEFAULT '{}',  -- JSON object
    restart_policy  TEXT NOT NULL DEFAULT '{}',  -- JSON object
    auto_start      INTEGER NOT NULL DEFAULT 1,
    group_name      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- 站点管理
CREATE TABLE sites (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    site_type     TEXT NOT NULL,       -- static | reverse_proxy
    domain        TEXT NOT NULL,
    config        TEXT NOT NULL,       -- JSON: 站点完整配置
    ssl_enabled   INTEGER NOT NULL DEFAULT 0,
    cert_id       TEXT REFERENCES certificates(id),
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- SSL 证书
CREATE TABLE certificates (
    id            TEXT PRIMARY KEY,
    domain        TEXT NOT NULL,
    cert_path     TEXT NOT NULL,
    key_path      TEXT NOT NULL,
    issuer        TEXT NOT NULL,       -- letsencrypt | custom
    expires_at    TEXT NOT NULL,
    auto_renew    INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);

-- Docker Compose 项目
CREATE TABLE compose_projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    directory     TEXT NOT NULL,       -- docker-compose.yml 所在目录
    description   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- 远程节点
CREATE TABLE nodes (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    address       TEXT NOT NULL,       -- ws://host:port
    token_hash    TEXT NOT NULL,
    is_local      INTEGER NOT NULL DEFAULT 0,
    group_name    TEXT,
    last_seen_at  TEXT,
    created_at    TEXT NOT NULL
);

-- 系统监控历史 (按分钟粒度)
CREATE TABLE system_metrics (
    timestamp     TEXT NOT NULL,
    cpu_usage     REAL NOT NULL,
    memory_used   INTEGER NOT NULL,
    disk_read     INTEGER,
    disk_write    INTEGER,
    net_rx        INTEGER,
    net_tx        INTEGER,
    PRIMARY KEY (timestamp)
);

-- 操作审计日志
CREATE TABLE audit_logs (
    id            TEXT PRIMARY KEY,
    user_id       TEXT,
    method        TEXT NOT NULL,      -- JSON-RPC method
    params        TEXT,               -- 请求参数 (脱敏)
    result_code   INTEGER,
    ip_address    TEXT,
    created_at    TEXT NOT NULL
);
```

### 6.2 数据库策略

- **WAL 模式**: 启用 Write-Ahead Logging，防止写入中断导致数据损坏
- **迁移管理**: 内嵌 schema migration，Daemon 启动时自动检查并执行数据库迁移
- **监控数据清理**: 定时清理超过 24 小时的系统指标数据，审计日志保留 90 天
- **备份**: 提供手动触发的 SQLite 在线备份功能

---

## 7. 安全架构

### 7.1 认证流程

```
首次启动
  │
  ▼
┌─────────────────────┐
│ 强制设置管理员密码    │──► 创建 admin 用户 (argon2 哈希)
└─────────────────────┘

Web UI 登录                           MCP Server / API Token
  │                                       │
  ▼                                       ▼
username + password                   预共享 Token
  │                                       │
  ▼                                       ▼
auth.login ──► argon2 verify          WS Connect ──► Token Hash 比对
  │                                       │
  ▼                                       ▼
返回 Session Token (JWT)              认证通过，建立会话
  │
  ▼
后续请求携带 JWT (WS 首消息)
```

### 7.2 安全分层

| 层级     | 措施                                                       |
| -------- | ---------------------------------------------------------- |
| 传输层   | 生产环境强制 TLS/WSS；本地开发允许 WS                      |
| 认证层   | Admin 密码 (argon2)、API Token (SHA-256)、JWT Session       |
| 授权层   | RBAC: admin (完全控制)、operator (操作)、readonly (只读)    |
| 请求层   | 速率限制 (令牌桶算法)；输入解析 (parse-first) + 参数边界约束 |
| MCP 层   | 独立的 Token 认证；可配置 Tool 级别的权限白名单             |
| 审计层   | 所有写操作记录审计日志                                      |

---

## 8. 部署架构

### 8.1 服务器版 (Headless)

```
┌────────────────────────────────────────────┐
│                Linux Server                │
│                                            │
│  systemd ──► xdeck-daemon                  │
│              ├── :9210 WebSocket API       │
│              ├── :9210 Web UI (SPA)        │
│              └── SQLite DB                 │
│                                            │
│  (可选) xdeck-mcp                          │
│              ├── stdin/stdout ◄──► AI      │
│              └── ws://localhost:9210 ──► Daemon │
│                                            │
│  浏览器 ──► https://server:9210            │
└────────────────────────────────────────────┘
```

### 8.2 桌面版 (Tauri)

```
┌──────────────────────────────────────┐
│           Tauri Application          │
│                                      │
│  ┌────────────┐  ┌────────────────┐  │
│  │  WebView    │  │   Sidecar      │  │
│  │  (React UI) │  │  xdeck-daemon  │  │
│  │             │  │  (127.0.0.1)   │  │
│  └──────┬──────┘  └───────┬────────┘  │
│         │  ws://localhost  │           │
│         └─────────────────┘           │
│                                      │
│  (可选) Sidecar: xdeck-mcp           │
│  系统托盘 常驻                        │
└──────────────────────────────────────┘
```

### 8.3 端口与地址规划

| 服务         | 默认端口/地址    | 说明                     |
| ------------ | ---------------- | ------------------------ |
| Daemon HTTP  | `0.0.0.0:9210`   | WebSocket + Web UI + API |
| Daemon 本地  | `127.0.0.1:9210` | 桌面版仅监听 loopback    |
| MCP stdio    | stdin/stdout     | AI 客户端本地通信        |
| MCP SSE      | `0.0.0.0:9211`   | AI 远程通信 (可选)       |

---

## 9. 关键技术决策

### 9.1 技术选型决策记录

#### ADR-001: 后端语言选择 Rust

- **背景**: 需要极低内存占用 + 跨平台编译 + 高并发异步 I/O
- **决策**: 选择 Rust + Tokio 异步运行时
- **理由**: 对比 Go (GC 暂停、内存占用更高)，Rust 无 GC 且与 Tauri 生态统一
- **权衡**: 开发效率相对较低，团队学习成本较高

#### ADR-002: 统一 WebSocket 通信而非 REST

- **背景**: 需要实时推送状态变更（进程状态、系统指标、日志流）
- **决策**: 所有客户端-Daemon 通信统一使用 WebSocket + JSON-RPC 2.0
- **理由**: 避免维护 REST + WebSocket 两套 API；JSON-RPC 天然支持双向通信和事件推送
- **保留**: `/health` REST 端点用于基础健康检查；Web UI SPA 通过 HTTP 提供静态资源

#### ADR-003: MCP Server 作为独立进程

- **背景**: MCP Server 需要桥接 AI 协议 (stdio/SSE) 与 Daemon (WebSocket)
- **决策**: MCP Server 作为独立可执行文件，通过 WebSocket 连接 Daemon
- **理由**: 解耦 AI 协议与核心 Daemon，MCP Server 可独立升级/部署；复用与 Web UI 相同的 API，无需维护额外接口
- **权衡**: 多一个进程的管理成本，但通过 Sidecar 机制可自动管理

#### ADR-004: 嵌入式 SQLite 而非 PostgreSQL

- **背景**: 需要持久化存储，但必须保持零外部依赖
- **决策**: 使用 SQLite (via rusqlite)，单文件数据库
- **理由**: 零部署成本；对于单节点管理面板的数据量 SQLite 完全足够；WAL 模式提供良好的并发读性能
- **权衡**: 不适合多节点共享数据库场景 (但各节点本身就是独立的 Daemon)

#### ADR-005: 前端状态管理选择 Zustand

- **背景**: 需要轻量级全局状态管理，与 WebSocket 实时数据集成
- **决策**: 使用 Zustand 管理全局状态
- **理由**: API 简洁，体积小 (< 1KB)，与 React 深度集成，不需要 Provider 包装

#### ADR-006: 输入约束从 Validate 模式迁移到 Parse 模式

- **背景**: 手工 `validate_*` 逻辑分散在业务入口，难以复用且容易遗漏边界条件
- **决策**: 采用 `RawRequest -> ParsedRequest` 两阶段模型，使用 `nutype` 表达可组合约束
- **理由**: 类型本身携带约束，输入在进入业务前即归一化和拒绝，错误边界更清晰

---

## 10. 错误处理与可靠性

### 10.1 Daemon 可靠性

| 场景                  | 处理策略                                                 |
| --------------------- | -------------------------------------------------------- |
| Daemon 异常崩溃       | systemd/launchd 自动拉起；启动时从 SQLite 恢复进程状态   |
| SQLite 写入中断       | WAL 模式保证数据一致性；启动时自动 checkpoint             |
| 被管理进程崩溃        | 按 RestartPolicy 自动重启；超过上限发送告警事件          |
| WebSocket 连接中断    | 客户端自动重连 (指数退避 1s-30s)；重连后恢复事件订阅     |
| Nginx 配置错误        | 写入前 `nginx -t` 校验；失败不写入，保留上一个正确配置   |
| Docker 守护进程不可用 | DockerManager 进入降级模式，API 返回明确错误而不崩溃     |

### 10.2 进程状态恢复

```
Daemon 启动
    │
    ▼
从 SQLite 加载所有 auto_start=true 的进程定义
    │
    ▼
检查每个进程的 PID 是否仍在运行 (/proc/<pid> 或 kill -0)
    │
    ├── PID 存在 ──► 重新 attach（监控但不重启）
    │
    └── PID 不存在 ──► 按照重启策略重新启动
```

### 10.3 参数错误聚合

- 对 `process.create`、`process.logs` 采用聚合报错策略
- 单次请求可返回多个字段错误，减少“修一个错再看到下一个错”的交互成本
- 字段级错误通过 JSON-RPC `error.data.details` 传递，前端可直接映射到表单项

---

## 11. 可扩展性设计

### 11.1 Manager Trait 抽象

所有管理器实现统一 trait，便于新增功能模块：

```rust
#[async_trait]
pub trait Manager: Send + Sync {
    /// 模块名称，用于 JSON-RPC 路由前缀
    fn name(&self) -> &str;

    /// 初始化模块（启动时调用）
    async fn init(&self, ctx: &AppContext) -> Result<()>;

    /// 处理 JSON-RPC 请求
    async fn handle_rpc(
        &self,
        method: &str,         // 去除模块前缀后的方法名
        params: Value,
        ctx: &RequestContext,
    ) -> Result<Value>;

    /// 优雅关闭
    async fn shutdown(&self) -> Result<()>;
}
```

新增功能模块只需：
1. 实现 `Manager` trait
2. 在 Daemon 启动时注册到 JSON-RPC Router
3. 定义对应的 SQLite migration (如需持久化)

### 11.2 事件总线 (EventBus)

```rust
pub struct EventBus {
    subscribers: DashMap<String, Vec<mpsc::Sender<Event>>>,
}

pub struct Event {
    pub topic: String,       // e.g. "process.status_changed"
    pub payload: Value,
    pub timestamp: DateTime<Utc>,
}
```

- 使用 `tokio::sync::broadcast` 或 `mpsc` 实现
- 发布-订阅模式：Manager 发布事件 → EventBus 分发 → WebSocket Handler 推送给客户端
- 支持 Topic 通配符订阅 (e.g. `process.*`)
