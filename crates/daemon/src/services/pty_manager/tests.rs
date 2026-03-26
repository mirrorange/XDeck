use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;

use super::manager::PtyManager;
use super::session::ScrollbackBuffer;
use super::types::{
    CreatePtyRequest, PtySessionExitedEvent, PtySessionType, PtySessionTypeLabel,
    PTY_SESSION_EXITED_TOPIC,
};
use crate::services::event_bus::EventBus;

fn manager_for_test() -> Arc<PtyManager> {
    PtyManager::new(Arc::new(EventBus::default()), Duration::from_secs(30 * 60))
}

fn shell_command() -> String {
    if cfg!(windows) {
        "cmd.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

#[cfg(unix)]
fn cat_command() -> String {
    "/bin/cat".to_string()
}

fn exit_command_request(exit_code: i32) -> CreatePtyRequest {
    if cfg!(windows) {
        CreatePtyRequest {
            name: Some("exit-session".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec!["/C".to_string(), format!("exit {}", exit_code)],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        }
    } else {
        CreatePtyRequest {
            name: Some("exit-session".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec!["-lc".to_string(), format!("exit {}", exit_code)],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        }
    }
}

#[test]
fn test_scrollback_buffer_capacity() {
    let mut buf = ScrollbackBuffer::new(8);
    buf.push(b"1234");
    buf.push(b"5678");
    buf.push(b"90");
    assert_eq!(buf.get_all(), b"34567890");
}

#[tokio::test]
async fn test_create_and_close_session() {
    let manager = manager_for_test();
    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("test-session".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    assert_eq!(created.name, "test-session");
    assert!(manager.get_session(&created.session_id).is_some());

    manager.close_session(&created.session_id).await.unwrap();
    assert!(manager.get_session(&created.session_id).is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn test_session_write_and_read() {
    let manager = manager_for_test();
    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("cat-session".to_string()),
            session_type: PtySessionType::ProcessDaemon {
                process_id: "proc-1".to_string(),
            },
            command: cat_command(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    let session = manager.get_session_handle(&created.session_id).unwrap();
    let mut rx = session.subscribe_output();

    session.write(b"hello-pty\n").unwrap();

    let received = tokio::time::timeout(Duration::from_secs(3), async move {
        loop {
            let data = rx.recv().await.unwrap_or_else(|_| Bytes::new());
            if String::from_utf8_lossy(&data).contains("hello-pty") {
                break true;
            }
        }
    })
    .await
    .unwrap();

    assert!(received);
    manager.close_session(&created.session_id).await.unwrap();
}

#[tokio::test]
async fn test_client_count_tracking() {
    let manager = manager_for_test();
    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("client-count-session".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    let session = manager.get_session_handle(&created.session_id).unwrap();
    assert_eq!(session.client_count(), 0);

    session.client_connected("client-1").unwrap();
    session.client_connected("client-2").unwrap();
    assert_eq!(session.client_count(), 2);

    session.client_disconnected("client-1").unwrap();
    assert_eq!(session.client_count(), 1);
    session.client_disconnected("client-2").unwrap();
    assert_eq!(session.client_count(), 0);

    manager.close_session(&created.session_id).await.unwrap();
}

#[tokio::test]
async fn test_multi_client_resize_uses_minimum_size() {
    let manager = manager_for_test();
    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("multi-client-resize".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            cols: 120,
            rows: 40,
        })
        .await
        .unwrap();

    let session = manager.get_session_handle(&created.session_id).unwrap();
    session.client_connected("client-1").unwrap();
    session.resize_for_client("client-1", 120, 40).unwrap();

    session.client_connected("client-2").unwrap();
    session.resize_for_client("client-2", 80, 24).unwrap();

    let info = session.info();
    assert_eq!(info.cols, 80);
    assert_eq!(info.rows, 24);

    session.client_disconnected("client-2").unwrap();

    let info = session.info();
    assert_eq!(info.cols, 120);
    assert_eq!(info.rows, 40);

    manager.close_session(&created.session_id).await.unwrap();
}

#[tokio::test]
async fn test_idle_timeout_detection() {
    let manager = manager_for_test();
    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("idle-session".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    let session = manager.get_session_handle(&created.session_id).unwrap();
    session.client_connected("client-1").unwrap();
    session.client_disconnected("client-1").unwrap();

    assert!(!session.is_idle_timeout(Duration::from_secs(1)));
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert!(session.is_idle_timeout(Duration::from_millis(10)));

    manager.close_session(&created.session_id).await.unwrap();
}

#[tokio::test]
async fn test_session_created_event_contains_session_info() {
    let manager = manager_for_test();
    let mut events = manager.event_bus.subscribe();

    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("event-payload-session".to_string()),
            session_type: PtySessionType::Terminal,
            command: shell_command(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    let event = tokio::time::timeout(Duration::from_secs(3), events.recv())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(event.topic, "pty.session_created");
    assert_eq!(event.payload["session_id"], created.session_id);
    assert_eq!(event.payload["name"], created.name);
    assert_eq!(event.payload["command"], created.command);
    assert_eq!(event.payload["cols"], created.cols);
    assert_eq!(event.payload["rows"], created.rows);
    assert_eq!(event.payload["session_type"], "terminal");

    manager.close_session(&created.session_id).await.unwrap();
}

#[tokio::test]
async fn test_session_exit_publishes_event() {
    let manager = manager_for_test();
    let mut events = manager.event_bus.subscribe();

    let created = manager.create_session(exit_command_request(7)).await.unwrap();

    let exit_event = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.topic == PTY_SESSION_EXITED_TOPIC {
                return serde_json::from_value::<PtySessionExitedEvent>(event.payload).unwrap();
            }
        }
    })
    .await
    .unwrap();

    assert_eq!(exit_event.session_id, created.session_id);
    assert_eq!(exit_event.session_type, PtySessionTypeLabel::Terminal);
    assert_eq!(exit_event.exit_code, 7);
    assert!(!exit_event.success);
}

#[tokio::test]
async fn test_terminal_session_exit_closes_session() {
    let manager = manager_for_test();
    let mut events = manager.event_bus.subscribe();

    let created = manager.create_session(exit_command_request(0)).await.unwrap();

    let closed_session_id = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.topic == "pty.session_closed" {
                return event.payload["session_id"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap();
            }
        }
    })
    .await
    .unwrap();

    assert_eq!(closed_session_id, created.session_id);
    assert!(manager.get_session(&created.session_id).is_none());
}

#[tokio::test]
async fn test_process_daemon_session_exit_closes_session() {
    let manager = manager_for_test();
    let mut events = manager.event_bus.subscribe();

    let created = manager
        .create_session(CreatePtyRequest {
            name: Some("process-exit-session".to_string()),
            session_type: PtySessionType::ProcessDaemon {
                process_id: "proc-exit".to_string(),
            },
            command: exit_command_request(0).command,
            args: exit_command_request(0).args,
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    let closed_session_id = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.topic == "pty.session_closed" {
                return event.payload["session_id"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap();
            }
        }
    })
    .await
    .unwrap();

    assert_eq!(closed_session_id, created.session_id);
    assert!(manager.get_session(&created.session_id).is_none());
}
