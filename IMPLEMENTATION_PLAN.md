# File Manager Feature - Implementation Plan

## Overview
Add a full-featured file manager to XDeck with browsing, operations, transfer, preview, and modern UI.

## Stage 1: Backend File System RPC Handlers
**Goal**: Core file system read operations exposed via JSON-RPC
**Success Criteria**:
- `fs.list` — list directory entries with metadata (name, size, mtime, permissions, owner)
- `fs.stat` — get detailed info for a single path
- `fs.get_home` — return user home directory
- Path traversal protection (resolve symlinks, reject `..` escape)
**Tests**: RPC calls return correct data, path traversal is blocked
**Status**: Not Started

## Stage 2: Frontend File Browser (Basic)
**Goal**: Navigable file browser page with list/grid views and multi-tab support
**Success Criteria**:
- `/files` route with sidebar navigation entry
- Zustand store for file browser state (tabs, current directory, entries)
- List view and icon/grid view toggle
- Breadcrumb navigation
- Column sorting (name, size, date)
- Multi-tab support (add/close/switch tabs)
**Tests**: Page renders, navigation works, views toggle
**Status**: Not Started

## Stage 3: Backend File Operations
**Goal**: File manipulation RPC methods
**Success Criteria**:
- `fs.create_dir` — create directory (with parents)
- `fs.rename` — rename/move file or directory
- `fs.copy` — copy file or directory
- `fs.move` — move file or directory
- `fs.delete` — delete file or directory (recursive option)
- `fs.chmod` — change permissions (Linux/macOS)
- `fs.chown` — change owner (Linux/macOS)
- `fs.search` — find files by name pattern (recursive option)
**Tests**: Operations succeed, permissions work, search returns results
**Status**: Not Started

## Stage 4: Frontend File Operations
**Goal**: UI for all file operations
**Success Criteria**:
- Context menu (right-click) with all operations
- Rename inline editing
- New folder dialog
- Delete confirmation dialog
- Copy/Move modal with destination picker
- Permission editing dialog (Linux/macOS)
- Search bar with results display
- Keyboard shortcuts (Delete, F2, Ctrl+C/V)
**Tests**: All operations accessible via UI, keyboard shortcuts work
**Status**: Not Started

## Stage 5: WebSocket File Transfer
**Goal**: Dedicated WebSocket endpoint for file upload/download
**Success Criteria**:
- `/ws/files` WebSocket endpoint with auth
- Upload protocol: chunked binary upload with progress
- Download protocol: chunked binary download with progress
- Batch upload/download (folders) with automatic tar.gz compression
- Upload/download progress tracking
- Frontend upload/download UI with progress bars
**Tests**: Single file upload/download works, folder transfer works
**Status**: Not Started

## Stage 6: Compression & Search
**Goal**: Server-side compression/decompression and file search
**Success Criteria**:
- `fs.compress` — compress files/dirs to zip or tar.gz
- `fs.decompress` — extract zip, tar, tar.gz, tar.bz2
- `fs.search` — recursive file search with pattern matching
- Frontend UI for compress/decompress actions
- Search results display with navigation
**Tests**: Compress/decompress round-trips, search finds files
**Status**: Not Started

## Stage 7: File Preview
**Goal**: Preview common file types in-browser
**Success Criteria**:
- Text/code preview using CodeMirror with syntax highlighting
- Image preview (jpg, png, gif, svg, webp)
- Video preview (mp4, webm)
- Audio preview (mp3, wav, ogg)
- File content served via RPC (base64) or dedicated HTTP endpoint
**Tests**: Preview opens for each file type
**Status**: Not Started

## Stage 8: Advanced UI & Interactions
**Goal**: Polish interactions to match modern file managers
**Success Criteria**:
- Drag-and-drop to move files between folders
- Drag between tabs
- Rectangle/lasso selection
- Multi-select with Shift+Click, Ctrl+Click
- Drag to upload from desktop
- Smooth animations (framer-motion or similar)
- Responsive layout
**Tests**: All interactions feel natural and responsive
**Status**: Not Started
