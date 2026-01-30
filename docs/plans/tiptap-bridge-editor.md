# Replace MDXEditor with Tiptap in BridgeTaskPanel

## Scope

Create a new `BridgeTaskEditor` component using Tiptap, dedicated to the bridge task panel and notes. **Leave DocsEditor (MDXEditor) untouched** for the full document editor in DocsContentPane/StackContentPane.

This eliminates all MDXEditor workarounds in the bridge context: bracket escaping, trailing empty paragraphs, onChange-on-init, segment splitting for video, MutationObserver DOM hacks.

## Phases

### Phase 1: Core Tiptap Editor (this phase)

Replace MDXEditor with Tiptap for basic markdown editing — bullets, links, bold/italic, inline code. Video wikilinks render as raw text for now.

### Phase 2: Video Wikilink Extension (future)

Custom Tiptap Node for `![[video.mp4]]` wikilinks — atom node that renders inline `<video>` elements. Eliminates segment splitting entirely.

---

## Phase 1: Core Implementation

### Dependencies to Install

```
@tiptap/react            # React integration
@tiptap/starter-kit      # BulletList, OrderedList, Bold, Italic, Code, etc.
@tiptap/extension-link   # Clickable links
@tiptap/pm               # ProseMirror peer deps
tiptap-markdown           # Markdown ↔ ProseMirror serialization
```

### New Files

#### `src/components/bridge/BridgeTaskEditor.tsx` (~120 lines)

New lightweight editor component:
- **Props**: `markdown`, `onChange`, `readOnly`, `className`
- **Extensions**: StarterKit (heading disabled), Link (autolink), Markdown
- **Read/edit toggle**: `editor.setEditable(bool)` — no re-mount needed
- **onChange**: `editor.on('update', ...)` which only fires on user edits (not programmatic `setContent`)
- **Content sync**: `useEffect` watches `markdown` prop, calls `editor.commands.setContent(md)` when changed externally
- **No toolbar** — keyboard shortcuts only (bold, italic, etc.)
- **Theme**: CSS class toggles `dark-theme`/`light-theme`

### Files to Modify

#### `src/components/bridge/BridgeTaskPanel.tsx`

**Remove:**
- `dynamic()` DocsEditor import
- `cleanWikilinks()` function
- `VIDEO_WIKILINK_LINE_RE` regex, `VIDEO_EXTENSIONS` regex
- `ContentSegment` type, `segments` useMemo
- `hasUserEdited` ref + skip-first-onChange logic
- `resolveVideoUrl()` function
- Conditional view/edit rendering (segments vs single editor)

**Replace with:**
```tsx
<BridgeTaskEditor
  markdown={fullMarkdown}
  onChange={handleContentChange}
  readOnly={!isEditMode}
/>
```

Simplified `handleContentChange`:
```tsx
const handleContentChange = useCallback((markdown: string) => {
  if (markdown !== lastSavedDetails.current) {
    lastSavedDetails.current = markdown;
    onUpdateDetails(task.id, markdown.split("\n"));
  }
}, [task.id, onUpdateDetails]);
```

#### `src/components/bridge/BridgeNotes.tsx`

Same swap — replace DocsEditor with BridgeTaskEditor.

#### `src/app/globals.css`

Add Tiptap styles section using existing CSS variables for theme support. Keep existing `.docs-editor-compact` CSS for DocsEditor consumers.

#### `package.json`

Add 5 tiptap dependencies.

### Implementation Order

1. Install deps
2. Build BridgeTaskEditor component
3. Add CSS styles
4. Swap into BridgeTaskPanel, remove MDXEditor workaround code
5. Swap into BridgeNotes
6. Test all scenarios

### Key Design Decisions

**Why a separate component, not replacing DocsEditor?**
DocsEditor handles full documents with headings, tables, code blocks, frontmatter, toolbar, file tree wikilink navigation. That's a separate migration. The bridge task editor needs bullets, links, bold/italic — a much smaller surface.

**Markdown round-trip via `tiptap-markdown`:**
Adds `editor.storage.markdown.getMarkdown()` and markdown content setting. Uses `markdown-it` under the hood.

**No toolbar:**
Tiptap supports keyboard shortcuts natively (Cmd+B for bold, etc.). The bridge context never shows a toolbar.

### Verification

1. Open Bridge tab, click a task with details
2. View mode: rendered markdown with bullets and links
3. Edit mode: editable content, keyboard shortcuts work
4. Toggle view/edit — content preserved, no bracket escaping
5. Edit text, verify onChange fires and saves correctly
6. Check BridgeNotes still works
7. Verify DocsEditor in Docs tab is unaffected

---

## Phase 2: Video Wikilink Extension (future)

### New Files

#### `src/components/bridge/tiptap-extensions/video-wikilink.ts`

Custom Tiptap Node for `![[video.mp4]]`:
- `name: 'videoWikilink'`, `group: 'block'`, `atom: true`
- Attributes: `target` (filename), `src` (resolved API URL)
- Uses `ReactNodeViewRenderer` for `<video>` element
- Markdown serialization: emits `![[target]]`
- Markdown parsing: custom markdown-it inline rule
- Fallback: pre/post process `![[]]` ↔ HTML placeholder

#### `src/components/bridge/tiptap-extensions/VideoWikilinkView.tsx`

React NodeView that resolves video URL and renders `<video src={url} controls />`.

### BridgeTaskPanel Changes

- Remove remaining segment splitting if still present
- Pass `scopePath`/`currentFilePath` to BridgeTaskEditor for video resolution
- Video wikilinks render inline as atom nodes — no DOM hacks needed
