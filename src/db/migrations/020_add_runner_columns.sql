-- Runner on agents: explicit user choice (NULL = use default for model)
ALTER TABLE agents ADD COLUMN runner TEXT;

-- Runner on runs: records which runner actually executed (always populated for new runs)
ALTER TABLE runs ADD COLUMN runner TEXT DEFAULT 'claude-agent-sdk';
