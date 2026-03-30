CREATE TABLE IF NOT EXISTS process_runtime_instances (
    process_id TEXT NOT NULL,
    instance_idx INTEGER NOT NULL,
    pid INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    PRIMARY KEY (process_id, instance_idx)
);
