ALTER TABLE workspaces ADD COLUMN sender_address TEXT NOT NULL DEFAULT '';
CREATE TRIGGER lead_assignment_capacity_insert BEFORE INSERT ON leads
WHEN NEW.assignee_id IS NOT NULL AND NEW.stage NOT IN ('won','irrelevant') AND
(SELECT COUNT(*) FROM leads WHERE workspace_id=NEW.workspace_id AND assignee_id=NEW.assignee_id AND stage NOT IN ('won','irrelevant')) >=
(SELECT capacity FROM members WHERE workspace_id=NEW.workspace_id AND user_id=NEW.assignee_id)
BEGIN SELECT RAISE(ABORT,'ASSIGNEE_FULL'); END;
CREATE TRIGGER lead_assignment_capacity_update BEFORE UPDATE OF assignee_id,stage ON leads
WHEN NEW.assignee_id IS NOT NULL AND NEW.stage NOT IN ('won','irrelevant') AND
(OLD.assignee_id IS NOT NEW.assignee_id OR OLD.stage IN ('won','irrelevant')) AND
(SELECT COUNT(*) FROM leads WHERE workspace_id=NEW.workspace_id AND assignee_id=NEW.assignee_id AND stage NOT IN ('won','irrelevant') AND id<>NEW.id) >=
(SELECT capacity FROM members WHERE workspace_id=NEW.workspace_id AND user_id=NEW.assignee_id)
BEGIN SELECT RAISE(ABORT,'ASSIGNEE_FULL'); END;
