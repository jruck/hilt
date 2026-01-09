# Fix: False "Unsaved Changes" on File Load

## Problem
When loading a markdown file in the Docs viewer, it immediately shows "unsaved changes" with a Save button, even in read mode.

## Root Cause
1. MDXEditor fires `onChange` after initial content load (normalizes whitespace, trailing newlines, etc.)
2. The `onChange` handler in DocsContentPane is always active, even in read mode
3. This sets `editedContent` in useDocs, causing `hasUnsavedChanges` to become true
4. Additionally, `processedMarkdown()` converts wikilinks to markdown links, further altering content

## Solution
Only propagate `onChange` events when in edit mode. In read mode, there should be no way for the editor to trigger unsaved changes.

## Implementation

### File: `src/components/docs/DocsContentPane.tsx`

**Change at line 229:**

Before:
```tsx
<DocsEditor
  markdown={displayContent}
  onChange={(newContent) => onContentChange(newContent)}
  readOnly={!isEditMode}
  ...
```

After:
```tsx
<DocsEditor
  markdown={displayContent}
  onChange={isEditMode ? (newContent) => onContentChange(newContent) : undefined}
  readOnly={!isEditMode}
  ...
```

## Why This Works
- In read mode, `onChange` is `undefined`, so MDXEditor's internal normalization doesn't trigger any state updates
- `editedContent` stays `null` in read mode
- `hasUnsavedChanges` remains `false` until the user actually edits in edit mode
- When switching to edit mode, `onChange` becomes active and subsequent edits are tracked

## Testing
1. Load a markdown file → should NOT show unsaved changes or Save button
2. Switch to edit mode → should NOT immediately show unsaved changes
3. Make an actual edit → should show unsaved changes and Save button
4. Save → unsaved indicator should disappear
5. Switch to read mode without saving → should prompt for confirmation
