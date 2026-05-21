#!/bin/bash

# PostToolUse hook that reminds about documentation updates
# Triggered after Edit or Write tool calls

# Read hook input from stdin
input=$(cat)

# Extract details from hook input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# Skip if editing documentation files themselves
if echo "$file_path" | grep -qE '^.*/docs/.*\.md$|CLAUDE\.md$|README\.md$|CHANGELOG\.md$'; then
  exit 0
fi

# Skip if not a source file
if ! echo "$file_path" | grep -qE '\.(ts|tsx|js|jsx|json)$'; then
  exit 0
fi

# Output reminder to stderr (shown to agent)
cat << 'EOF'

📝 Remember to update documentation:
   • docs/CHANGELOG.md - Add entry under [Unreleased]
   • docs/ARCHITECTURE.md - If system design changed
   • docs/API.md - If API routes changed
   • docs/DATA-MODELS.md - If types changed
   • docs/DESIGN-PHILOSOPHY.md - If UI/UX patterns were refined or new preferences learned

EOF

exit 0
