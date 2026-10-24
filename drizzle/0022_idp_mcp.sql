-- Using the MCP server is delegated like every other administrative right. It confers nothing
-- by itself: an agent connected through it acts with the person's other permissions. No role
-- is given it; Master Admin covers the new key through its wildcard.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('managed-permission-idp-mcp', 'idp:mcp', 'Use the MCP server', 'Connect an AI agent to this identity provider. The agent can only do what the person''s other permissions allow.', true)
ON CONFLICT ("key") DO NOTHING;
