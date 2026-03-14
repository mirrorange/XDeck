# File Manager Feature - Implementation Plan

## Overview
Add a full-featured file manager to XDeck with browsing, operations, transfer, preview, and modern UI.

## Stage 1-7: Core File Manager
**Status**: Complete

## Stage 8: Task Progress System & Advanced File Operations

### Stage 8.1: Backend Task Manager Service
**Goal**: A service that tracks long-running tasks (compress, extract, upload, download) and publishes progress events via EventBus
**Success Criteria**:
- `TaskManager` service with `SharedTaskManager` type (Arc-wrapped)
- Task lifecycle: create → progress updates → complete/failed/cancelled
- Tasks have: id, type, title, status, progress (0-100), message, created_at, updated_at
- EventBus integration: publishes `task.created`, `task.progress`, `task.completed`, `task.failed`
- RPC methods: `task.list`, `task.cancel`
- Integrate with `fs.compress` and `fs.extract` to report progress
**Tests**: Task creation, progress events published, completion/failure tracked
**Status**: Complete

### Stage 8.2: Backend Folder Upload/Download
**Goal**: Support uploading entire folders (preserving structure) and downloading folders as zip
**Success Criteria**:
- Upload endpoint accepts relative path per file to preserve directory structure
- New RPC method `fs.prepare_download` for folders: compresses to temp zip, returns download path
- Progress tracking for folder download preparation (zip compression)
- Temp file cleanup after download
**Tests**: Folder upload preserves structure, folder download creates valid zip
**Status**: Complete

### Stage 8.3: Frontend Task Store & Task List UI
**Goal**: Zustand store for tasks + floating task list panel showing progress
**Success Criteria**:
- `task-store.ts` with event subscriptions for task progress
- Task list panel (floating/docked) showing all active/recent tasks
- Progress bars for each task
- Cancel button for cancellable tasks
- Toast notifications for task completion/failure
- Integration with upload dialog for upload progress
**Tests**: Task list shows progress, updates in real-time, cancel works
**Status**: Not Started

### Stage 8.4: Frontend Folder Upload/Download
**Goal**: UI for folder upload and folder download with progress
**Success Criteria**:
- Upload dialog supports folder selection (webkitdirectory)
- Folder upload preserves directory structure
- Context menu "Download" on folders triggers zip preparation + download
- Progress shown in task list during zip preparation
**Tests**: Folder upload works, folder download works with progress
**Status**: Not Started

### Stage 8.5: Enhanced Drag-and-Drop
**Goal**: Better drag behavior across tabs, edge scrolling, multi-file indicators
**Success Criteria**:
- Drag to tab bar switches active tab (with delay), allowing cross-tab moves
- Drag to top/bottom edges triggers scroll
- Custom drag preview showing count + file names for multi-file drag
- Shared DnD utilities extracted from duplicated code
**Tests**: Cross-tab drag works, edge scroll works, multi-drag indicator shows
**Status**: Not Started

### Stage 8.6: Desktop Drag Upload
**Goal**: Drop files from desktop/OS file manager into the file browser to upload
**Success Criteria**:
- Drop zone overlay appears when dragging external files over browser
- Files dropped trigger upload to current directory
- Folders dropped trigger folder upload with structure preserved
- Progress shown in task list
**Tests**: Desktop file drop triggers upload, folder drop preserves structure
**Status**: Not Started

### Stage 8.7: Rectangle/Lasso Selection
**Goal**: Click and drag on empty space to select multiple files by area
**Success Criteria**:
- Mouse down on empty area starts selection rectangle
- Rectangle drawn with semi-transparent overlay
- Files intersecting rectangle are selected
- Works in both list and grid views
- Combines with Shift/Ctrl for additive selection
**Tests**: Rectangle selection works in both views, modifier keys combine
**Status**: Not Started

### Stage 8.8: Animations & Visual Polish
**Goal**: Smooth animations for file operations and transitions using motion library
**Success Criteria**:
- Install motion (framer-motion successor) or similar
- Animate file list entry/exit (add, delete, rename)
- Animate tab transitions
- Animate dialog open/close
- Animate drag previews
- Smooth layout transitions when switching view modes
**Tests**: Animations play smoothly, no janky layout shifts
**Status**: Not Started

### Stage 8.9: Responsive Layout
**Goal**: File manager adapts to different screen sizes
**Success Criteria**:
- Compact toolbar on small screens
- Grid view adjusts columns based on width
- Preview panel converts to modal/drawer on small screens
- Tab bar scrolls horizontally on overflow
- Touch-friendly targets on mobile
**Tests**: Layout works at 360px, 768px, 1024px, 1440px widths
**Status**: Not Started
