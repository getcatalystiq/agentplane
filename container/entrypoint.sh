#!/bin/bash
set -euo pipefail

# AgentPlane Container Entrypoint
# Configures the Claude Agent SDK with injected skills, commands, and MCP servers

# =============================================================================
# Input Validation
# =============================================================================

# Validate TENANT_ID if provided (used for logging/debugging only)
if [ -n "${TENANT_ID:-}" ]; then
  if ! [[ "$TENANT_ID" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
    echo "ERROR: Invalid TENANT_ID format" >&2
    exit 1
  fi
fi

WORKSPACE="/home/agent/workspace"
CLAUDE_DIR="/home/agent/.claude"

# =============================================================================
# Setup Skills
# =============================================================================

if [ -n "${AGENT_SKILLS:-}" ]; then
  mkdir -p "$CLAUDE_DIR/skills"
  # Use printf to safely write content without shell interpretation
  printf '%s' "$AGENT_SKILLS" > "$CLAUDE_DIR/skills/injected.md"
  echo "Loaded skills from environment"
fi

# =============================================================================
# Setup Commands
# =============================================================================

if [ -n "${AGENT_COMMANDS:-}" ]; then
  mkdir -p "$CLAUDE_DIR/commands"
  printf '%s' "$AGENT_COMMANDS" > "$CLAUDE_DIR/commands/injected.md"
  echo "Loaded commands from environment"
fi

# =============================================================================
# Setup MCP Servers Configuration
# =============================================================================

if [ -n "${MCP_SERVERS:-}" ] && [ "$MCP_SERVERS" != "{}" ]; then
  # Validate JSON format before writing
  if ! printf '%s' "$MCP_SERVERS" | jq empty 2>/dev/null; then
    echo "ERROR: Invalid MCP_SERVERS JSON format" >&2
    exit 1
  fi

  # Write settings.json using jq to ensure valid JSON output
  jq -n --argjson servers "$MCP_SERVERS" '{"mcpServers": $servers}' > "$CLAUDE_DIR/settings.json"
  echo "Configured MCP servers"
fi

# =============================================================================
# Setup AI Provider
# =============================================================================

if [ -n "${BEDROCK_REGION:-}" ] && [ -n "${BEDROCK_MODEL:-}" ]; then
  # Validate region format
  if ! [[ "$BEDROCK_REGION" =~ ^[a-z]{2}-[a-z]+-[0-9]+$ ]]; then
    echo "ERROR: Invalid BEDROCK_REGION format" >&2
    exit 1
  fi
  export AWS_REGION="$BEDROCK_REGION"
  export CLAUDE_MODEL="$BEDROCK_MODEL"
  echo "Using AWS Bedrock: $BEDROCK_REGION / $BEDROCK_MODEL"
fi

# =============================================================================
# Execute Agent
# =============================================================================

cd "$WORKSPACE"

# If a prompt is provided via argument, run it
if [ -n "${1:-}" ]; then
  exec claude --print "$@"
fi

# Otherwise, start in interactive mode (for debugging)
exec claude
