CREATE TABLE mk_contacts(
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT,
  source TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  course TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT ',',
  fields TEXT NOT NULL DEFAULT '{}',
  consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_open_at TEXT,
  last_click_at TEXT,
  token TEXT NOT NULL DEFAULT (lower(hex(randomblob(12)))),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX mk_contacts_email ON mk_contacts(email) WHERE email!='';
CREATE INDEX mk_contacts_token ON mk_contacts(token);
CREATE TABLE mk_lists(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE mk_list_members(list_id TEXT NOT NULL,contact_id TEXT NOT NULL,added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(list_id,contact_id));
CREATE INDEX mk_list_members_contact ON mk_list_members(contact_id);
CREATE TABLE mk_segments(id TEXT PRIMARY KEY,name TEXT NOT NULL,rules TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE mk_campaigns(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL DEFAULT 'draft',
  workspace_id TEXT NOT NULL DEFAULT 'women',
  from_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  subject_b TEXT NOT NULL DEFAULT '',
  ab_percent INTEGER NOT NULL DEFAULT 0,
  ab_hours INTEGER NOT NULL DEFAULT 4,
  ab_winner TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  ad_prefix INTEGER NOT NULL DEFAULT 1,
  audience TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT '',
  test_done_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  resume_at TEXT NOT NULL DEFAULT '',
  excluded TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE mk_sends(
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  email TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'A',
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at TEXT,
  bounced TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(campaign_id,contact_id)
);
CREATE INDEX mk_sends_email ON mk_sends(campaign_id,email);
CREATE INDEX mk_sends_status ON mk_sends(campaign_id,status);
CREATE INDEX mk_sends_contact ON mk_sends(contact_id);
CREATE TABLE mk_events(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,contact_id TEXT NOT NULL,event TEXT NOT NULL,link TEXT NOT NULL DEFAULT '',at TEXT NOT NULL);
CREATE INDEX mk_events_campaign ON mk_events(campaign_id,event);
CREATE INDEX mk_events_at ON mk_events(event,at);
