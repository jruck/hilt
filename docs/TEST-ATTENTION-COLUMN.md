# Testing the Needs Attention Column

Manual test scenarios to verify the "Needs Attention" column and status badges work correctly.

## Prerequisites

1. Hilt running (`npm run dev:all`)
2. Board view open in browser at http://localhost:3000
3. A terminal ready to start Claude Code sessions

---

## Test 1: Waiting for Approval (Tool Use)

**Goal**: Create a session that's waiting for tool approval.

**Note**: File operations may be auto-approved depending on your config. Use one of these alternatives that typically require approval:

### Option A: Bash Command (usually needs approval)
```bash
claude "run this shell command: ls -la /tmp && echo 'test complete'"
```

### Option B: Git Push (guaranteed to need approval)
```bash
claude "push the current branch to origin"
```

### Option C: Network Request
```bash
claude "fetch the contents of https://httpbin.org/get"
```

### Option D: Force approval mode
```bash
claude --no-dangerously-skip-permissions "create a file called test.txt"
```

**Steps**:
1. Open a terminal in any project folder
2. Run one of the commands above
3. **DO NOT** approve the tool use - just leave it waiting

**Expected Outcome**:
- Session appears in "Needs Attention" column
- Card shows amber "Needs Approval" badge with alert icon
- Card also appears with pulsing green dot (running)

**Cleanup**: Press `Ctrl+C` to cancel the session.

---

## Test 2: Waiting for Input (Question Asked)

**Goal**: Create a session where Claude asked a question and is waiting for response.

**Steps**:
1. Open a terminal in any project folder
2. Run: `claude "I want to refactor something but I'm not sure what approach to take. What are my options for organizing utility functions?"`
3. Wait for Claude to finish responding (it will ask clarifying questions)

**Expected Outcome**:
- Session appears in "Needs Attention" column
- Card shows blue "Waiting" badge with message icon
- No pulsing dot (not actively running)

**Cleanup**: Type `exit` or close terminal.

---

## Test 3: Working State (Processing)

**Goal**: Create a session that's actively working.

**Steps**:
1. Open a terminal in any project folder
2. Run: `claude "explain the theory of relativity in extreme detail, covering all aspects"`
3. Observe while Claude is generating response

**Expected Outcome**:
- Session stays in "Active" column (not Attention)
- Card shows emerald "Working" badge with spinning loader
- Pulsing green dot visible

**Note**: This state is transient - it will change to "waiting_for_input" once Claude finishes.

---

## Test 4: Idle State (No Badge)

**Goal**: Verify idle sessions don't show badges or appear in Attention.

**Steps**:
1. Find any session that hasn't been touched in 5+ minutes
2. Or wait 5 minutes after completing Test 2

**Expected Outcome**:
- Session stays in its original column (Active/Recent)
- No status badge shown
- No pulsing dot

---

## Test 5: Transition from Approval to Input

**Goal**: Verify status updates when you approve a tool.

**Steps**:
1. Start Test 1 (waiting for approval)
2. Verify session is in "Needs Attention" with amber badge
3. Approve the tool use (press Enter or 'y')
4. Wait for Claude to finish

**Expected Outcome**:
- Badge changes from amber "Needs Approval" to blue "Waiting"
- Session may briefly show "Working" during processing
- Session remains in "Needs Attention" (now waiting for input)

---

## Debugging

If badges don't appear:

1. **Check derivedState is populated**: Open browser DevTools, Network tab, look at `/api/sessions` response. Each session should have a `derivedState` object.

2. **Check JSONL is being parsed**: The SessionWatcher should be reading `~/.claude/projects/*/sessions/*.jsonl` files.

3. **Check WebSocket events**: In DevTools Console, look for `session:updated` events being received.

4. **Check the 5-minute threshold**: Sessions idle for 5+ minutes show as `idle` (no badge). Recent activity is required.

---

## Expected Column Behavior

| Derived Status | Badge | Column |
|----------------|-------|--------|
| `working` | Emerald "Working" (spinner) | Active |
| `waiting_for_approval` | Amber "Needs Approval" | Needs Attention |
| `waiting_for_input` | Blue "Waiting" | Needs Attention |
| `idle` | None | Original column |

---

## Notes

- The "Needs Attention" column is **virtual** - sessions aren't stored with "attention" status
- Sessions are filtered into Attention based on real-time `derivedState`
- A session can only be in one column at a time (Attention takes priority over Active)
- The column is **locked** - you cannot drag sessions in or out
