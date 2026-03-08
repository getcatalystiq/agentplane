#!/usr/bin/env bash
#
# Validate plugin file formats:
#   - SKILL.md: valid YAML frontmatter
#   - commands/*.md: valid YAML frontmatter
#   - agents/*.md: valid YAML frontmatter
#   - plugin.json: valid JSON with required fields
#   - .mcp.json: valid JSON with mcpServers key
#   - hooks.json: valid JSON
#
# Usage: ./scripts/validate-plugins.sh [--changed-only]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

error() {
  echo -e "${RED}ERROR:${NC} $1" >&2
  ERRORS=$((ERRORS + 1))
}

warn() {
  echo -e "${YELLOW}WARN:${NC} $1" >&2
}

ok() {
  echo -e "${GREEN}OK:${NC} $1"
}

# If --changed-only, only validate files that are staged or modified
CHANGED_ONLY=false
CHANGED_FILES=""
if [[ "${1:-}" == "--changed-only" ]]; then
  CHANGED_ONLY=true
  CHANGED_FILES=$(cd "$REPO_ROOT" && git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
  if [[ -z "$CHANGED_FILES" ]]; then
    echo "No staged files to validate."
    exit 0
  fi
fi

should_check() {
  local file="$1"
  if [[ "$CHANGED_ONLY" == "false" ]]; then
    return 0
  fi
  local rel
  rel="${file#$REPO_ROOT/}"
  echo "$CHANGED_FILES" | grep -qF "$rel"
}

# --- Validate YAML frontmatter in .md files ---
validate_frontmatter() {
  local file="$1"
  local type="$2"

  if ! should_check "$file"; then
    return
  fi

  # Must start with --- on the very first line (no leading whitespace)
  local first_line
  first_line=$(head -1 "$file")
  if [[ "$first_line" != "---" ]]; then
    error "$type '$file': must start with '---' on line 1 (got '${first_line}')"
    return
  fi

  # Find closing --- (must be at column 0, not indented)
  local closing_line
  closing_line=$(awk 'NR > 1 && /^---\s*$/ { print NR; exit }' "$file")
  if [[ -z "$closing_line" ]]; then
    error "$type '$file': no closing '---' found for frontmatter"
    return
  fi

  # Extract frontmatter and check YAML keys are not indented (top-level)
  local frontmatter
  frontmatter=$(sed -n "2,$((closing_line - 1))p" "$file")

  # Check that 'name' key exists
  if ! echo "$frontmatter" | grep -qE '^name:'; then
    error "$type '$file': frontmatter missing 'name' field"
    return
  fi

  # Check that 'description' key exists
  if ! echo "$frontmatter" | grep -qE '^description:'; then
    error "$type '$file': frontmatter missing 'description' field"
    return
  fi

  # Check no top-level keys have leading whitespace
  local indented_keys
  indented_keys=$(echo "$frontmatter" | grep -nE '^\s+[a-zA-Z_-]+\s*:' || true)
  if [[ -n "$indented_keys" ]]; then
    if echo "$frontmatter" | grep -qE '^\s+name:'; then
      error "$type '$file': 'name' key is indented — top-level YAML keys must not have leading spaces"
      return
    fi
    if echo "$frontmatter" | grep -qE '^\s+description:'; then
      error "$type '$file': 'description' key is indented — top-level YAML keys must not have leading spaces"
      return
    fi
  fi

  ok "$type '$file'"
}

# --- Validate JSON files ---
validate_json() {
  local file="$1"
  local type="$2"

  if ! should_check "$file"; then
    return
  fi

  if ! python3 -m json.tool "$file" > /dev/null 2>&1; then
    error "$type '$file': invalid JSON"
    return
  fi

  ok "$type '$file'"
}

validate_plugin_json() {
  local file="$1"

  if ! should_check "$file"; then
    return
  fi

  if ! python3 -m json.tool "$file" > /dev/null 2>&1; then
    error "plugin.json '$file': invalid JSON"
    return
  fi

  # Check required fields
  local content
  content=$(cat "$file")
  for field in name version description; do
    if ! echo "$content" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
      error "plugin.json '$file': missing required field '$field'"
      return
    fi
  done

  # Validate semver format
  local version
  version=$(echo "$content" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)
  if ! echo "$version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    error "plugin.json '$file': version '$version' is not valid semver (expected X.Y.Z)"
    return
  fi

  ok "plugin.json '$file'"
}

validate_mcp_json() {
  local file="$1"

  if ! should_check "$file"; then
    return
  fi

  if ! python3 -m json.tool "$file" > /dev/null 2>&1; then
    error ".mcp.json '$file': invalid JSON"
    return
  fi

  local content
  content=$(cat "$file")
  if ! echo "$content" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'mcpServers' in d" 2>/dev/null; then
    error ".mcp.json '$file': missing 'mcpServers' key"
    return
  fi

  ok ".mcp.json '$file'"
}

# --- Run validations ---
echo "Validating plugins..."
echo ""

# SKILL.md files
for f in "$REPO_ROOT"/plugins/*/skills/*/SKILL.md; do
  [[ -f "$f" ]] && validate_frontmatter "$f" "SKILL.md"
done

# Command files
for f in "$REPO_ROOT"/plugins/*/commands/*.md; do
  [[ -f "$f" ]] && validate_frontmatter "$f" "command"
done

# Agent files
for f in "$REPO_ROOT"/plugins/*/agents/*.md; do
  [[ -f "$f" ]] && validate_frontmatter "$f" "agent"
done

# plugin.json files
for f in "$REPO_ROOT"/plugins/*/.claude-plugin/plugin.json; do
  [[ -f "$f" ]] && validate_plugin_json "$f"
done

# .mcp.json files
for f in "$REPO_ROOT"/plugins/*/.mcp.json; do
  [[ -f "$f" ]] && validate_mcp_json "$f"
done

# hooks.json files
for f in "$REPO_ROOT"/plugins/*/hooks.json; do
  [[ -f "$f" ]] && validate_json "$f" "hooks.json"
done

# marketplace.json
if [[ -f "$REPO_ROOT/.claude-plugin/marketplace.json" ]]; then
  validate_json "$REPO_ROOT/.claude-plugin/marketplace.json" "marketplace.json"
fi

echo ""
if [[ $ERRORS -gt 0 ]]; then
  echo -e "${RED}Validation failed with $ERRORS error(s).${NC}"
  exit 1
else
  echo -e "${GREEN}All plugin files are valid.${NC}"
  exit 0
fi
