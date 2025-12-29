# Draft Injection Test Plan

## Objective
Automate testing of the draft session prompt injection feature to ensure prompts are correctly injected after Claude Code is ready.

## Success Criteria
Two consecutive draft sessions must:
1. Open terminal successfully
2. Load Claude Code
3. Have prompt injected AFTER Claude is ready (not before)
4. Receive a response from Claude

## Test Flow

### Setup
1. Navigate to Claude Kanban at `http://localhost:3000`
2. Take initial snapshot to understand UI structure

### Test Loop (repeat until 2 consecutive successes)

For each test iteration (test1, test2, test3...):

1. **Create Draft**
   - Click the "+" button in the "To Do" column to add a new draft
   - Enter prompt: "testN" (where N is the test number)
   - Confirm draft appears in the inbox

2. **Run Draft**
   - Click the "Run" button on the draft card
   - Verify terminal drawer opens

3. **Verify Sequence** (watch terminal output)
   - Terminal should show shell initializing
   - `claude` command should be executed
   - Wait for Claude Code to show its `>` prompt
   - THEN the test prompt should appear
   - Claude should start responding

4. **Success Criteria for Single Test**
   - [ ] Terminal opened
   - [ ] Claude Code loaded (saw welcome/init messages)
   - [ ] Prompt appeared AFTER Claude's `>` prompt
   - [ ] Claude started responding (output after prompt)

5. **Record Result**
   - Mark test as PASS or FAIL
   - If FAIL, note what went wrong

### Exit Conditions
- **Success**: 2 consecutive PASS results → stop testing
- **Max attempts**: Stop after 10 tests regardless

## Chrome DevTools MCP Tools to Use

- `take_snapshot` - Get page structure and element refs
- `click` - Click buttons (Add draft, Run)
- `fill` - Enter prompt text
- `wait_for` - Wait for text to appear
- `list_console_messages` - Check for errors
- `evaluate_script` - Check terminal content if needed

## Expected UI Elements

Based on the codebase:
- "To Do" column header with "+" button
- Draft cards with "Run" button (play icon)
- Terminal drawer on right side when session opened
- Terminal content area showing Claude Code output

## Test Output Format

```
Test 1: [PASS/FAIL] - Notes
Test 2: [PASS/FAIL] - Notes
...
Result: SUCCESS after N tests / FAILED after 10 attempts
```
