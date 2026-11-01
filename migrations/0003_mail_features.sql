CREATE TABLE message_templates(
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'service',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(workspace_id,id)
);
CREATE TABLE message_attachments(
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  message_id TEXT,
  template_id TEXT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(workspace_id,id)
);
CREATE INDEX attach_message ON message_attachments(workspace_id,message_id);
CREATE INDEX attach_template ON message_attachments(workspace_id,template_id);
ALTER TABLE messages ADD COLUMN scheduled_at TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN auto_reply_text TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN auto_reply INTEGER NOT NULL DEFAULT 0;
