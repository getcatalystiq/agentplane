-- Step 1: Add nullable column (brief ACCESS EXCLUSIVE lock, fast with no default)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS slug VARCHAR(100);

-- Step 2: Collision-safe backfill — appends -2, -3, etc. for duplicate slugs within same tenant
UPDATE agents a
SET slug = final_slug
FROM (
    SELECT
        id,
        CASE
            WHEN ROW_NUMBER() OVER (PARTITION BY tenant_id, base_slug ORDER BY created_at) = 1
                THEN base_slug
            ELSE base_slug || '-' || ROW_NUMBER() OVER (PARTITION BY tenant_id, base_slug ORDER BY created_at)::TEXT
        END AS final_slug
    FROM (
        SELECT id, tenant_id, created_at,
            NULLIF(
                TRIM(BOTH '-' FROM LOWER(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9\s-]', '', 'g'),
                        '\s+', '-', 'g'
                    )
                )),
                ''
            ) AS base_slug
        FROM agents
    ) named
) computed
WHERE a.id = computed.id;

-- Step 3: Fallback for names that produced empty slugs (all special chars)
UPDATE agents
SET slug = 'agent-' || id::TEXT
WHERE slug IS NULL;

-- Step 4: Enforce NOT NULL (metadata-only in PG12+ when no NULLs remain)
ALTER TABLE agents ALTER COLUMN slug SET NOT NULL;

-- Step 5: Format CHECK constraint
ALTER TABLE agents
    ADD CONSTRAINT agents_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$');

-- Step 6: Unique constraint (creates a btree index)
ALTER TABLE agents
    ADD CONSTRAINT agents_tenant_slug_unique UNIQUE (tenant_id, slug);

-- Step 7: Partial index for fast A2A routing lookups
CREATE INDEX IF NOT EXISTS idx_agents_a2a_slug
    ON agents(tenant_id, slug)
    WHERE a2a_enabled = true;
