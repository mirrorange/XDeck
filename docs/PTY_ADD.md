# PTY 管理模块 - 架构设计文档

> **版本**: v0.1.0
> **作者**: Orange
> **创建日期**: 2026-03-05
> **关联文档**: [PRD v0.1.1](./PRD.md) · [ADD v0.1.0](./ADD.md)

---

## 目录

1. [概述](#1-概述)
2. [功能范围](#2-功能范围)
3. [架构设计](#3-架构设计)
4. [后端设计](#4-后端设计)
5. [通信协议设计](#5-通信协议设计)
6. [前端设计](#6-前端设计)
7. [数据模型](#7-数据模型)
8. [安全与可靠性](#8-安全与可靠性)
9. [关键技术决策](#9-关键技术决策)

---

## 1. 概述

### 1.1 文档目的

本文档描述 XDeck 的 **PTY 管理模块** 架构设计，涵盖两个核心功能：

1. **系统终端** — 通过 Web 界面提供完整的 shell 交互体验
2. **PTY 进程守护** — 以 PTY 模式启动被守护进程，支持实时交互

两者共享同一套 PTY 基础设施（PtyManager），但在会话生命周期和使用场景上有所区别。

### 1.2 设计目标

| 目标 | 描述 | 度量指标 |
|------|------|----------|
| **低延迟** | 终端输入 → 输出的端到端延迟极低 | 本地 < 20ms |
| **会话持久** | 离开页面不终止 PTY，回来恢复上下文 | 会话存活直到显式关闭 |
| **多客户端共享** | 多个浏览器标签/用户可共享同一会话 | 输出同步广播 |
| **跨平台** | macOS / Linux / Windows 均可使用 | portable-pty 保证 |
| **安全** | PTY 会话受认证保护 | 只有已认证用户可连接 |

---

## 2. 功能范围

### 2.1 系统终端

用户在 Web UI 中打开一个完整的 shell 会话，类似 SSH：

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 创建会话 | 创建 PTY 并启动默认 shell（bash/zsh/pwsh） | P0 |
| 终端交互 | 通过 xterm.js 进行完整的双向交互 | P0 |
| 多标签页 | 前端支持同时打开多个终端标签 | P0 |
| 会话持久化 | 关闭页面后会话不销毁，重新打开恢复 | P0 |
| 多客户端共享 | 多个浏览器/用户可连接同一 PTY 会话 | P1 |
| 终端调整大小 | 浏览器窗口变化时同步 PTY 大小 | P0 |
| 会话列表 | 查看所有活跃的 PTY 会话列表 | P0 |
| 关闭会话 | 显式关闭并销毁 PTY 会话 | P0 |

### 2.2 PTY 进程守护

通过 PTY 启动被守护进程，支持交互操作：

| 功能 | 描述 | 优先级 |
|------|------|--------|
| PTY 模式启动 | 进程以 PTY 模式启动，替代 pipe 模式 | P1 |
| 连接到 PTY | 前端连接到正在运行的 PTY 进程 | P1 |
| 输入发送 | 通过 ATY 向被守护进程发送交互式输入 | P1 |
| 日志保留 | PTY 输出同时流入日志管道 | P1 |

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      前端 (React)                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Terminal     │  │  Terminal     │  │  Process     │   │
│  │  Tab 1       │  │  Tab 2       │  │  PTY View    │   │
│  │  (xterm.js)  │  │  (xterm.js)  │  │  (xterm.js)  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         └──────────────────┼─────────────────┘           │
│                            │ WebSocket (Binary + Text)   │
└────────────────────────────┼─────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────┐
│                     Daemon (Rust)                         │
│                            │                              │
│  ┌─────────────────────────▼────────────────────────┐    │
│  │              PTY WebSocket Handler                │    │
│  │  /ws/pty/{session_id}                             │    │
│  │  • 认证校验                                       │    │
│  │  • Binary Frame ←→ PTY I/O                       │    │
│  │  • Text Frame ←→ 控制消息 (resize, etc.)          │    │
│  └───────────────────────┬──────────────────────────┘    │
│                          │                                │
│  ┌───────────────────────▼──────────────────────────┐    │
│  │                  PtyManager                       │    │
│  │  • 管理所有 PTY 会话生命周期                       │    │
│  │  • HashMap<SessionId, PtySession>                 │    │
│  │  • 创建 / 调整大小 / 关闭 / 列表                   │    │
│  └───────────────────────┬──────────────────────────┘    │
│                          │                                │
│  ┌───────────────────────▼──────────────────────────┐    │
│  │                  PtySession                       │    │
│  │  • portable-pty MasterPty                         │    │
│  │  • 输出广播 (broadcast channel)                    │    │
│  │  • 滚动回看缓冲区 (scrollback buffer)              │    │
│  │  • 连接客户端计数                                  │    │
│  └───────────────────────┬──────────────────────────┘    │
│                          │                                │
│  ┌───────────────────────▼──────────────────────────┐    │
│  │              portable-pty                          │    │
│  │  • 跨平台 PTY 创建                                │    │
│  │  • Reader / Writer 分离                           │    │
│  │  • 窗口大小调整                                    │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 3.2 关键设计决策

#### ADR-PTY-001: 独立 WebSocket 端点而非复用 JSON-RPC

- **背景**: PTY 数据是高频二进制字节流，JSON-RPC 适合低频结构化请求/响应
- **决策**: PTY 会话使用独立的 WebSocket 端点 `/ws/pty/{session_id}`
- **理由**:
  - Binary Frame 直接传输终端原始字节，避免 Base64 编码开销
  - JSON-RPC 的请求-响应模型不适合流式数据
  - PTY 连接独立于 JSON-RPC 连接的生命周期
- **权衡**: 前端需维护两套 WebSocket 连接（RPC + PTY），但职责分离清晰

#### ADR-PTY-002: PTY 管理 API 通过 JSON-RPC 暴露

- **背景**: PTY 的创建、列表、关闭等操作是低频的管理操作
- **决策**: PTY 生命周期管理（create/list/close）通过现有 JSON-RPC 路由
- **理由**: 复用现有的认证、路由、错误处理基础设施。与其他管理操作风格一致
- **数据流**: 前端先 RPC `pty.create` 获取 session_id → 再发起 PTY WebSocket 连接

#### ADR-PTY-003: 会话持久化 — 与客户端断开后保持存活

- **背景**: 用户关闭浏览器标签不应终止正在运行的终端会话
- **决策**: PTY 会话在 PtyManager 中存活，直到被显式关闭或超时（可配置）
- **理由**: 类似 tmux / screen 的体验；支持断线重连和多客户端共享
- **超时策略**: 无客户端连接时，系统终端默认 30 分钟超时；PTY 进程守护的 PTY 跟随进程生命周期

#### ADR-PTY-004: 输出广播 + Scrollback Buffer

- **背景**: 多客户端共享同一 PTY 时，需要广播输出；新连接的客户端需要看到历史输出
- **决策**: 使用 `tokio::sync::broadcast` 广播输出 + Ring Buffer 保留最近 N 字节滚动回看
- **理由**:
  - broadcast channel 天然支持多消费者
  - Scrollback buffer 让新连接的客户端不会看到空白屏幕
- **默认尺寸**: Scrollback buffer 默认 64KB

---

## 4. 后端设计

### 4.1 模块结构

```
crates/daemon/src/
├── services/
│   ├── pty_manager.rs         # PtyManager + PtySession
│   └── ...
├── rpc/
│   ├── pty_handlers.rs        # JSON-RPC handlers (pty.create/list/close)
│   └── ...
└── api/
    ├── mod.rs                 # 路由注册
    ├── websocket.rs           # 现有 JSON-RPC WebSocket
    └── pty_websocket.rs       # PTY 专用 WebSocket handler
```

### 4.2 PtyManager

```rust
/// 管理所有 PTY 会话的生命周期。
pub struct PtyManager {
    /// 活跃的 PTY 会话 (session_id → PtySession)
    sessions: DashMap<String, Arc<PtySession>>,
    /// 事件总线引用，用于发布会话状态变更事件
    event_bus: SharedEventBus,
    /// 空闲超时时间（无客户端连接时）
    idle_timeout: Duration,
}

impl PtyManager {
    /// 创建新的 PTY 会话。
    /// 启动指定的 shell 命令并返回 session_id。
    pub async fn create_session(&self, req: CreatePtyRequest) -> Result<PtySessionInfo>;

    /// 列出所有活跃的 PTY 会话。
    pub fn list_sessions(&self) -> Vec<PtySessionInfo>;

    /// 获取指定会话的信息。
    pub fn get_session(&self, session_id: &str) -> Option<PtySessionInfo>;

    /// 调整指定会话的终端大小。
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()>;

    /// 关闭并销毁指定的 PTY 会话。
    pub async fn close_session(&self, session_id: &str) -> Result<()>;

    /// 获取会话的 Arc 引用（供 WebSocket handler 使用）。
    pub fn get_session_handle(&self, session_id: &str) -> Option<Arc<PtySession>>;

    /// 启动空闲会话回收循环（后台任务）。
    pub fn start_idle_reaper(&self);
}
```

### 4.3 PtySession

```rust
/// 一个活跃的 PTY 会话。
pub struct PtySession {
    /// 唯一会话 ID (UUID)
    pub id: String,

    /// 会话名称（可选，用户自定义或自动生成）
    pub name: String,

    /// 会话类型：系统终端 或 进程守护 PTY
    pub session_type: PtySessionType,

    /// PTY writer (用于向 PTY 发送输入)
    /// 使用 Mutex 保护，因为多个 WebSocket 客户端可能同时写入
    writer: Mutex<Box<dyn Write + Send>>,

    /// 输出广播发送端
    output_tx: broadcast::Sender<Bytes>,

    /// Scrollback buffer (Ring buffer，保留最近的输出)
    scrollback: Mutex<ScrollbackBuffer>,

    /// PTY master (用于 resize 等控制操作)
    master: Mutex<Box<dyn MasterPty + Send>>,

    /// 子进程句柄
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,

    /// 当前连接的客户端数量
    client_count: AtomicU32,

    /// 最后一个客户端断开的时间（用于空闲超时）
    last_client_disconnect: Mutex<Option<Instant>>,

    /// 终端大小
    size: Mutex<PtySize>,

    /// 创建时间
    pub created_at: DateTime<Utc>,
}

pub enum PtySessionType {
    /// 系统终端（shell 会话）
    Terminal,
    /// 进程守护 PTY（关联到某个 process_id）
    ProcessDaemon { process_id: String },
}

impl PtySession {
    /// 向 PTY 写入数据（用户输入）。
    pub fn write(&self, data: &[u8]) -> Result<()>;

    /// 订阅 PTY 输出流。返回 broadcast Receiver。
    pub fn subscribe_output(&self) -> broadcast::Receiver<Bytes>;

    /// 获取 scrollback buffer 中的历史数据。
    pub fn get_scrollback(&self) -> Vec<u8>;

    /// 调整终端大小。
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()>;

    /// 增加客户端连接计数。
    pub fn client_connected(&self);

    /// 减少客户端连接计数。当归零时记录断开时间。
    pub fn client_disconnected(&self);

    /// 检查会话是否已空闲超过指定时长。
    pub fn is_idle_timeout(&self, timeout: Duration) -> bool;
}
```

### 4.4 ScrollbackBuffer

```rust
/// Ring buffer，保留最近 N 字节的 PTY 输出。
/// 用于新客户端连接时回放历史内容。
struct ScrollbackBuffer {
    buf: VecDeque<u8>,
    capacity: usize,
}

impl ScrollbackBuffer {
    fn new(capacity: usize) -> Self;

    /// 追加数据。超出容量时丢弃最旧的数据。
    fn push(&mut self, data: &[u8]);

    /// 获取缓冲区中的所有数据。
    fn get_all(&self) -> Vec<u8>;

    /// 清空缓冲区。
    fn clear(&mut self);
}
```

### 4.5 PTY 输出读取循环

PtySession 创建时，启动一个后台 tokio 任务从 PTY reader 持续读取输出，广播给所有订阅者：

```rust
/// 后台任务：持续从 PTY 读取输出并广播。
async fn pty_output_loop(
    reader: Box<dyn Read + Send>,
    output_tx: broadcast::Sender<Bytes>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
) {
    // 将同步 Read 包装为异步（tokio::task::spawn_blocking 或 AsyncFd）
    let mut async_reader = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,             // EOF
                Ok(n) => {
                    let data = Bytes::copy_from_slice(&buf[..n]);
                    // 写入 scrollback buffer
                    scrollback.lock().push(&data);
                    // 广播给所有客户端
                    let _ = output_tx.send(data);
                }
                Err(_) => break,
            }
        }
    });
}
```

> **注意**: `portable-pty` 的 reader 是同步 `std::io::Read`，需要通过
> `spawn_blocking` 桥接到 tokio 异步世界。

### 4.6 PTY WebSocket Handler

独立于 JSON-RPC 的 WebSocket 端点，专门处理 PTY 数据流：

```
GET /ws/pty/{session_id}?token={jwt_token}

- 认证：通过 query parameter 中的 JWT token 验证身份
- 连接后：
  1. 发送 scrollback buffer 历史数据 (Binary Frame)
  2. 进入双向数据循环：
     - Binary Frame (client → server): 用户输入 → PtySession.write()
     - Binary Frame (server → client): PTY 输出 → broadcast 订阅
     - Text Frame (client → server): 控制消息 (JSON)
       { "type": "resize", "cols": 120, "rows": 40 }
```

```rust
/// PTY WebSocket upgrade handler.
pub async fn pty_ws_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Query(params): Query<PtyWsParams>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // 1. 验证 JWT token
    // 2. 验证 session_id 存在
    // 3. 升级 WebSocket
    ws.on_upgrade(move |socket| handle_pty_socket(socket, session_id, state))
}

async fn handle_pty_socket(
    socket: WebSocket,
    session_id: String,
    state: AppState,
) {
    let session = state.pty_manager.get_session_handle(&session_id);
    // ... 获取 session, 发送 scrollback, 进入读写循环
}
```

### 4.7 与 ProcessManager 集成

PTY 进程守护模式需要与现有 ProcessManager 集成：

```
ProcessManager                     PtyManager
     │                                  │
     │  process.create(pty_mode=true)    │
     │──────────────────────────────────►│ create_session(ProcessDaemon)
     │                                  │   └─ openpty() + spawn_command()
     │◄──────────────────────────────────│ return session_id
     │                                  │
     │  // 进程的 stdout/stderr 通过     │
     │  // PTY 统一输出                  │
     │                                  │
     │  // 日志管道挂载到 PTY 输出广播   │
     │  // (subscriber 写入日志文件)      │
     │                                  │
     │  process.stop()                   │
     │──────────────────────────────────►│ close_session()
     │                                  │
```

在 `ProcessDefinition` 中新增字段：

```rust
pub struct ProcessDefinition {
    // ... 现有字段 ...
    /// 是否以 PTY 模式启动进程
    pub pty_mode: bool,
}
```

当 `pty_mode=true` 时：
- ProcessManager 调用 PtyManager 创建一个 `ProcessDaemon` 类型的 PTY 会话
- PTY 的输出广播自动连接到日志管道（替代原来的 stdout/stderr pipe）
- 进程的 stdin 通过 PTY session 的 write 方法发送

---

## 5. 通信协议设计

### 5.1 JSON-RPC 方法 (管理操作)

通过现有 JSON-RPC WebSocket 连接调用：

```
pty.create          # 创建 PTY 会话
pty.list            # 列出所有 PTY 会话
pty.get             # 获取指定会话信息
pty.resize          # 调整终端大小
pty.close           # 关闭 PTY 会话
```

#### pty.create

```json
// 请求 - 系统终端
{
    "jsonrpc": "2.0",
    "id": "req-001",
    "method": "pty.create",
    "params": {
        "name": "My Terminal",          // 可选，自动生成
        "shell": "/bin/zsh",            // 可选，使用默认 shell
        "cwd": "/home/user/project",    // 可选，使用默认 home
        "env": { "TERM": "xterm-256color" }, // 可选，额外的环境变量
        "cols": 80,                     // 初始列数
        "rows": 24                      // 初始行数
    }
}

// 响应
{
    "jsonrpc": "2.0",
    "id": "req-001",
    "result": {
        "session_id": "a1b2c3d4-...",
        "name": "My Terminal",
        "shell": "/bin/zsh",
        "cols": 80,
        "rows": 24,
        "created_at": "2026-03-05T12:00:00Z"
    }
}
```

#### pty.list

```json
// 请求
{
    "jsonrpc": "2.0",
    "id": "req-002",
    "method": "pty.list"
}

// 响应
{
    "jsonrpc": "2.0",
    "id": "req-002",
    "result": {
        "sessions": [
            {
                "session_id": "a1b2c3d4-...",
                "name": "My Terminal",
                "session_type": "terminal",
                "shell": "/bin/zsh",
                "cols": 120,
                "rows": 40,
                "client_count": 2,
                "created_at": "2026-03-05T12:00:00Z"
            },
            {
                "session_id": "e5f6g7h8-...",
                "name": "web-server PTY",
                "session_type": "process_daemon",
                "process_id": "proc-xyz",
                "cols": 80,
                "rows": 24,
                "client_count": 0,
                "created_at": "2026-03-05T12:05:00Z"
            }
        ]
    }
}
```

#### pty.resize

```json
// 请求
{
    "jsonrpc": "2.0",
    "id": "req-003",
    "method": "pty.resize",
    "params": {
        "session_id": "a1b2c3d4-...",
        "cols": 120,
        "rows": 40
    }
}
```

#### pty.close

```json
// 请求
{
    "jsonrpc": "2.0",
    "id": "req-004",
    "method": "pty.close",
    "params": {
        "session_id": "a1b2c3d4-..."
    }
}
```

### 5.2 PTY WebSocket 协议 (数据流)

独立 WebSocket 端点: `GET /ws/pty/{session_id}?token={jwt}`

| 方向 | Frame 类型 | 内容 |
|------|-----------|------|
| Server → Client | Binary | PTY 输出原始字节 |
| Client → Server | Binary | 用户键盘输入原始字节 |
| Client → Server | Text (JSON) | 控制消息 |

控制消息格式：

```json
// resize
{ "type": "resize", "cols": 120, "rows": 40 }
```

连接流程：

```
Client                              Daemon
  │                                   │
  │── RPC: pty.create ───────────────►│  (通过 JSON-RPC WS)
  │◄── session_id ───────────────────│
  │                                   │
  │── WS: /ws/pty/{session_id}?token ►│  (新 WebSocket)
  │◄── Binary: scrollback data ──────│  (历史输出)
  │                                   │
  │── Binary: user input ────────────►│  → PtySession.write()
  │◄── Binary: pty output ───────────│  ← broadcast subscriber
  │                                   │
  │── Text: {"type":"resize",...} ───►│  → PtySession.resize()
  │                                   │
  │── WS Close ──────────────────────►│  (断开，但 PTY 继续存活)
  │                                   │
```

### 5.3 事件推送

通过现有 EventBus + JSON-RPC WebSocket 推送：

```
event.pty.session_created       # 新 PTY 会话创建
event.pty.session_closed        # PTY 会话关闭
event.pty.session_client_count  # 客户端连接数变更
```

### 5.4 错误码

| 错误码 | 名称 | 描述 |
|--------|------|------|
| 7001 | PTY_SESSION_NOT_FOUND | 指定的 PTY 会话不存在 |
| 7002 | PTY_CREATE_FAILED | PTY 创建失败（系统错误） |
| 7003 | PTY_SHELL_NOT_FOUND | 指定的 shell 程序不存在 |
| 7004 | PTY_SESSION_CLOSED | PTY 会话已关闭 |
| 7005 | PTY_WRITE_FAILED | 向 PTY 写入失败 |

---

## 6. 前端设计

### 6.1 组件结构

```
web/app/
├── routes/
│   └── terminal.tsx              # /terminal 路由页面
├── components/
│   ├── terminal/
│   │   ├── TerminalPage.tsx      # 终端页面容器（标签管理）
│   │   ├── TerminalTab.tsx       # 单个终端标签 (xterm.js 实例)
│   │   ├── TerminalTabBar.tsx    # 标签栏 UI
│   │   └── ProcessPtyView.tsx    # 进程守护 PTY 查看器
│   └── ...
├── stores/
│   └── terminal-store.ts         # PTY 会话状态管理 (Zustand)
└── lib/
    └── pty-client.ts             # PTY WebSocket 客户端封装
```

### 6.2 TerminalPage 布局

```
┌─────────────────────────────────────────────────┐
│ [Tab 1: My Terminal] [Tab 2: Dev Server] [＋]    │  ← TerminalTabBar
├─────────────────────────────────────────────────┤
│                                                  │
│  $ ls -la                                        │
│  total 32                                        │
│  drwxr-xr-x  5 user staff  160 Mar  5 12:00 .   │  ← TerminalTab
│  drwxr-xr-x 10 user staff  320 Mar  5 11:00 ..  │     (xterm.js)
│  -rw-r--r--  1 user staff 1024 Mar  5 12:00 foo  │
│  $ _                                             │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 6.3 xterm.js 集成

每个 TerminalTab 组件：

1. 创建 xterm.js `Terminal` 实例
2. 加载 `FitAddon` 自动适配容器尺寸
3. 加载 `WebLinksAddon` 支持可点击链接
4. 通过 `pty-client.ts` 建立 PTY WebSocket 连接
5. 双向绑定：
   - `terminal.onData()` → WebSocket Binary 发送
   - WebSocket Binary 接收 → `terminal.write()`
   - `terminal.onResize()` → WebSocket Text 发送 resize 命令
6. 组件卸载时断开 WebSocket（但不关闭 PTY 会话）

### 6.4 PtyClient (前端)

```typescript
/**
 * PTY WebSocket 客户端。
 * 管理与单个 PTY 会话的 WebSocket 连接。
 */
export class PtyClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private token: string;
  private onData?: (data: ArrayBuffer) => void;
  private onClose?: () => void;

  constructor(sessionId: string, token: string);

  /** 建立 WebSocket 连接 */
  connect(): void;

  /** 断开 WebSocket 连接（不关闭 PTY 会话） */
  disconnect(): void;

  /** 发送用户输入 (Binary) */
  sendInput(data: string | Uint8Array): void;

  /** 发送 resize 命令 */
  sendResize(cols: number, rows: number): void;

  /** 注册输出数据回调 */
  onOutput(handler: (data: ArrayBuffer) => void): void;
}
```

### 6.5 Zustand Store

```typescript
interface TerminalStore {
  // 活跃的 PTY 会话列表（从服务端拉取）
  sessions: PtySessionInfo[];

  // 当前打开的终端标签
  tabs: TerminalTab[];

  // 当前激活的标签 ID
  activeTabId: string | null;

  // Actions
  fetchSessions(): Promise<void>;
  createSession(opts?: CreatePtyOptions): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  openTab(sessionId: string): void;
  closeTab(tabId: string): void;
  setActiveTab(tabId: string): void;
}
```

### 6.6 进程详情页 PTY 集成

在现有进程详情/日志区域，当进程以 `pty_mode=true` 运行时，显示 xterm.js 终端视图替代纯文本日志：

```
进程列表 → 点击 PTY 进程 → 显示 TerminalTab（而非 LogViewer）
```

---

## 7. 数据模型

### 7.1 PTY 会话无需持久化

PTY 会话是纯内存态：

- 会话数据存储在 `PtyManager.sessions: DashMap` 中
- PTY 会话不跨 Daemon 重启存活（Daemon 重启后所有会话自动销毁）
- **理由**: PTY 会话是临时的交互式资源，持久化价值不大；需要持久化的是 ProcessDefinition 中的 `pty_mode` 字段

### 7.2 数据库变更

`processes` 表新增字段：

```sql
ALTER TABLE processes ADD COLUMN pty_mode INTEGER NOT NULL DEFAULT 0;
```

---

## 8. 安全与可靠性

### 8.1 安全措施

| 措施 | 描述 |
|------|------|
| **JWT 认证** | PTY WebSocket 连接通过 query parameter 携带 JWT token，服务端验证后才允许连接 |
| **会话隔离** | 每个 PTY 会话有唯一 ID，只有知道 session_id + 有效 token 才能连接 |
| **输入审计** | 可选：记录 PTY 会话的输入操作到审计日志 |
| **资源限制** | 限制每用户最大 PTY 会话数（默认 10），防止资源耗尽 |

### 8.2 可靠性

| 场景 | 处理策略 |
|------|----------|
| **客户端断连** | PTY 会话继续存活，等待重连或空闲超时回收 |
| **PTY 进程退出** | 检测到 EOF 后标记会话为已关闭，通知已连接客户端 |
| **Daemon 重启** | 所有 PTY 会话丢失；PTY 进程守护的进程如果 auto_start=true，会以 PTY 模式重新启动 |
| **broadcast 落后** | 客户端如果处理速度跟不上 PTY 输出速度，broadcast receiver 会 lag，旧消息被丢弃 |

### 8.3 资源管理

- **空闲回收**: 后台任务定期扫描无客户端连接的 PTY 会话，超过 idle_timeout 后自动关闭
- **内存控制**: Scrollback buffer 限制大小（默认 64KB），broadcast channel 容量限制（默认 256 条消息）
- **进程终止**: 关闭 PTY 会话时，先发送 SIGHUP 给子进程，等待优雅退出，超时后 SIGKILL

---

## 9. 关键技术决策

### 9.1 技术选型

| 技术 | 选型 | 理由 |
|------|------|------|
| PTY 库 | `portable-pty` | 跨平台、API 简洁、社区活跃（wezterm 维护） |
| 终端前端 | `xterm.js` | 行业标准、VS Code 使用、功能完善 |
| 数据传输 | WebSocket Binary Frame | 零编码开销、低延迟 |
| 多客户端 | `tokio::sync::broadcast` | 天然多消费者、无锁读 |
| 历史回放 | VecDeque ring buffer | 简单高效、固定内存 |
| 同步 → 异步 | `spawn_blocking` | portable-pty reader 是同步的，需要桥接 |

### 9.2 依赖变更

Cargo.toml 新增：

```toml
portable-pty = "0.8"    # 跨平台 PTY
bytes = "1"             # Bytes 类型，用于高效的二进制数据传递
```

package.json 新增：

```json
"@xterm/xterm": "^5.5.0",
"@xterm/addon-fit": "^0.10.0",
"@xterm/addon-web-links": "^0.11.0"
```
