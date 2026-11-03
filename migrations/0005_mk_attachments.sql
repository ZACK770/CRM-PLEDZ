CREATE TABLE mk_attachments(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL DEFAULT 'application/octet-stream',size INTEGER NOT NULL DEFAULT 0,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX mk_attachments_campaign ON mk_attachments(campaign_id);
