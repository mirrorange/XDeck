use std::path::PathBuf;
use std::sync::Arc;

use bytes::Bytes;
use tokio::fs;
use uuid::Uuid;

use super::*;
use crate::db;
use crate::error::AppError;
use crate::services::event_bus::EventBus;
use crate::services::task_manager;

async fn test_manager() -> (SharedUploadManager, PathBuf) {
    let pool = db::connect_in_memory().await.unwrap();
    db::run_migrations(&pool).await.unwrap();

    let temp_root = std::env::temp_dir().join(format!("xdeck-upload-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root).await.unwrap();
    let dest_dir = temp_root.join("dest");
    fs::create_dir_all(&dest_dir).await.unwrap();

    let task_manager = task_manager::new_shared(Arc::new(EventBus::new(32)));
    let manager = new_shared(pool, task_manager, temp_root.join("sessions")).unwrap();

    (manager, dest_dir)
}

#[tokio::test]
async fn create_append_resume_and_complete_upload_session() {
    let (manager, dest_dir) = test_manager().await;
    let dest_path = dest_dir.to_string_lossy().to_string();

    let session = manager
        .create_session(CreateUploadSessionRequest {
            dest_path: dest_path.clone(),
            files: vec![UploadFileDescriptor {
                name: "hello.txt".into(),
                size: 11,
                relative_path: None,
                last_modified: None,
            }],
        })
        .await
        .unwrap();

    assert_eq!(session.total_files, 1);
    assert_eq!(session.uploaded_bytes, 0);

    let file = session.files.first().unwrap().clone();
    let first = manager
        .append_chunk(&session.id, &file.id, 0, Bytes::from_static(b"hello "))
        .await
        .unwrap();
    assert_eq!(first.uploaded_bytes, 6);
    assert_eq!(first.session_uploaded_bytes, 6);

    let resumed = manager.get_session(&session.id).await.unwrap();
    assert_eq!(resumed.uploaded_bytes, 6);
    assert_eq!(resumed.files[0].uploaded_bytes, 6);

    manager
        .append_chunk(&session.id, &file.id, 6, Bytes::from_static(b"world"))
        .await
        .unwrap();
    let completed = manager.complete_session(&session.id).await.unwrap();

    assert_eq!(completed.status, UploadSessionStatus::Completed);
    let content = fs::read_to_string(dest_dir.join("hello.txt"))
        .await
        .unwrap();
    assert_eq!(content, "hello world");
}

#[tokio::test]
async fn append_chunk_rejects_wrong_offset() {
    let (manager, dest_dir) = test_manager().await;
    let dest_path = dest_dir.to_string_lossy().to_string();

    let session = manager
        .create_session(CreateUploadSessionRequest {
            dest_path,
            files: vec![UploadFileDescriptor {
                name: "offset.txt".into(),
                size: 4,
                relative_path: None,
                last_modified: None,
            }],
        })
        .await
        .unwrap();

    let file = session.files.first().unwrap().clone();
    let err = manager
        .append_chunk(&session.id, &file.id, 2, Bytes::from_static(b"ab"))
        .await
        .unwrap_err();

    match err {
        AppError::BadRequest(message) => {
            assert!(message.contains("Offset mismatch"));
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn complete_session_preserves_folder_structure() {
    let (manager, dest_dir) = test_manager().await;
    let dest_path = dest_dir.to_string_lossy().to_string();

    let session = manager
        .create_session(CreateUploadSessionRequest {
            dest_path,
            files: vec![UploadFileDescriptor {
                name: "nested.txt".into(),
                size: 4,
                relative_path: Some("folder/sub/nested.txt".into()),
                last_modified: None,
            }],
        })
        .await
        .unwrap();

    let file = session.files.first().unwrap().clone();
    manager
        .append_chunk(&session.id, &file.id, 0, Bytes::from_static(b"nest"))
        .await
        .unwrap();
    manager.complete_session(&session.id).await.unwrap();

    let content = fs::read_to_string(dest_dir.join("folder/sub/nested.txt"))
        .await
        .unwrap();
    assert_eq!(content, "nest");
}
