# Process Schedule Integration

## Scope

Daemon 已完成进程计划任务能力的后端实现，前端目前还未接入。

本次后端改动将“进程守护”和“计划任务”统一放在同一个 `process` 模型中：

- `mode = "daemon"`: 现有守护进程模式
- `mode = "schedule"`: 新的计划任务模式

## 新增字段

`process.get` / `process.list` / `process.create` / `process.update` 现在支持以下新增字段：

```json
{
  "mode": "daemon | schedule",
  "schedule": {
    "type": "once | daily | weekly | interval"
  },
  "schedule_overlap_policy": "ignore | restart | start_new",
  "schedule_state": {
    "next_run_at": "2026-03-25T09:30:00+08:00",
    "last_triggered_at": "2026-03-25T09:00:00+08:00",
    "last_skipped_at": null,
    "trigger_count": 3
  }
}
```

## `schedule` 结构

一次性任务：

```json
{
  "type": "once",
  "run_at": "2026-03-26T09:30:00+08:00"
}
```

每日固定时间：

```json
{
  "type": "daily",
  "hour": 9,
  "minute": 30
}
```

每周固定时间：

```json
{
  "type": "weekly",
  "weekdays": ["monday", "wednesday", "friday"],
  "hour": 9,
  "minute": 30
}
```

间隔任务：

```json
{
  "type": "interval",
  "every_seconds": 300
}
```

## 行为约定

- `auto_start` 在 `schedule` 模式下表示“计划是否启用”。
- `auto_start = true` 时，Daemon 启动后会自动恢复该计划。
- `auto_start = false` 时，不会自动调度，但仍可通过 `process.start` 手动立即运行一次。
- `process.start` 在 `schedule` 模式下表示“立即触发一次运行”，不是启动常驻守护。
- `process.stop` 会停止当前正在运行的实例，但不会自动关闭该计划；要暂停计划，请调用 `process.update` 把 `auto_start` 改成 `false`。
- `process.restart` 在 `schedule` 模式下等价于“停止当前运行实例后立即触发一次”。

## Overlap 策略

当计划触发时旧实例仍在运行：

- `ignore`: 忽略本次触发，推进到下一次调度时间
- `restart`: 停止旧实例并立即启动新实例
- `start_new`: 保留旧实例，同时新增一个实例执行本次任务

`start_new` 会产生额外的运行实例索引。此类实例索引可能大于 `instance_count - 1`，前端不要假设实例索引一定落在固定范围内，展示时请始终以 `instances[]` 实际返回结果为准。

## 时间语义

- `once.run_at` 需要传 RFC3339 时间字符串。
- `daily` / `weekly` 的时间按 Daemon 所在机器的本地时区解释。
- `interval.every_seconds` 单位为秒。

## 事件

新增事件主题：

`event.process.schedule_triggered`

示例：

```json
{
  "process_id": "proc-123",
  "action": "started | ignored | restarted | started_new",
  "due_at": "2026-03-25T09:30:00+08:00",
  "triggered_at": "2026-03-25T09:30:01+08:00",
  "overlap_policy": "restart",
  "instance": 1,
  "running_instances": [0],
  "next_run_at": "2026-03-25T10:30:00+08:00"
}
```

说明：

- `instance` 只会在真正启动了一个新运行时出现
- `running_instances` 只会在 `ignore` 场景里出现

现有事件 `event.process.status_changed` 与 `event.process.log` 不变，计划任务运行时仍通过这两个事件更新实例状态和日志。

## 前端接入建议

创建/编辑表单建议新增以下分组：

1. 进程模式
   - `daemon`
   - `schedule`

2. 计划配置
   - 一次性
   - 每日固定时间
   - 每周固定时间
   - 间隔

3. 重叠策略
   - 忽略
   - 重启
   - 启动新实例

4. 启用状态
   - 复用现有 `auto_start`
   - 在 `schedule` 模式下文案建议改成“启用计划”

列表/详情页建议新增展示：

- `mode`
- 人类可读的计划描述
- `schedule_state.next_run_at`
- `schedule_state.last_triggered_at`
- `schedule_state.trigger_count`

## 推荐 RPC 示例

创建计划任务：

```json
{
  "method": "process.create",
  "params": {
    "name": "backup-job",
    "mode": "schedule",
    "command": "/usr/local/bin/backup.sh",
    "args": [],
    "cwd": "/srv/app",
    "env": {},
    "restart_policy": {
      "strategy": "never",
      "max_retries": null,
      "delay_ms": 1000,
      "backoff_multiplier": 2.0
    },
    "auto_start": true,
    "log_config": {
      "max_file_size": 10485760,
      "max_files": 5
    },
    "instance_count": 1,
    "pty_mode": false,
    "schedule": {
      "type": "weekly",
      "weekdays": ["sunday"],
      "hour": 3,
      "minute": 0
    },
    "schedule_overlap_policy": "ignore"
  }
}
```

暂停计划：

```json
{
  "method": "process.update",
  "params": {
    "id": "proc-123",
    "auto_start": false
  }
}
```

恢复计划：

```json
{
  "method": "process.update",
  "params": {
    "id": "proc-123",
    "auto_start": true
  }
}
```

立即执行一次：

```json
{
  "method": "process.start",
  "params": {
    "id": "proc-123"
  }
}
```

## 当前已知限制

- `daily` / `weekly` 暂时只按 Daemon 本地时区运行，还没有单任务独立时区字段。
- `start_new` 产生的额外实例会通过 `instances[]` 返回，但这些额外实例目前没有单独的“历史归档”概念。
- 前端若仍沿用固定 `instance_count` 渲染实例页签，可能会漏掉 `start_new` 产生的额外实例；请改为以 `instances[]` 为准。
