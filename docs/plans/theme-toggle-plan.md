# Theme Toggle Implementation Plan

Add dark/light/system mode toggle to Hilt with a complete light theme variant.

## Overview

**Current State**: Hardcoded dark theme via `<html className="dark">` with no switching infrastructure.

**Goal**: Three-mode theme system (dark/light/system) with:
- Persistent user preference in localStorage
- System preference detection via `prefers-color-scheme`
- Smooth theme transitions
- Complete light color palette

## Implementation Steps

### Phase 1: Theme Infrastructure

#### 1.1 Create Theme Hook (`src/hooks/useTheme.ts`)

```typescript
type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';
```

Responsibilities:
- Read/write localStorage key `hilt-theme`
- Listen to `prefers-color-scheme` media query changes
- Resolve 'system' to actual dark/light based on OS preference
- Apply `dark` or `light` class to `<html>` element
- Prevent flash of wrong theme (FOUC) via inline script

#### 1.2 Create Theme Provider (`src/components/ThemeProvider.tsx`)

- Client component wrapping the app
- Provides theme context to children
- Handles SSR hydration (no theme mismatch)
- Injects inline script in `<head>` to set initial theme before React hydrates

#### 1.3 Update Layout (`src/app/layout.tsx`)

- Remove hardcoded `className="dark"`
- Wrap children with `ThemeProvider`
- Add `suppressHydrationWarning` to `<html>` (for inline script)

### Phase 2: CSS Variables & Light Theme

#### 2.1 Restructure `globals.css`

Current structure:
```css
:root {
  --background: #0a0a0a;
  --foreground: #fafafa;
}
```

New structure:
```css
/* Default (light) theme */
:root {
  --background: #ffffff;
  --foreground: #0f172a;
  /* ... all semantic colors */
}

/* Dark theme */
.dark {
  --background: #0a0a0a;
  --foreground: #fafafa;
  /* ... all semantic colors */
}

/* System preference (when no class applied) */
@media (prefers-color-scheme: dark) {
  :root:not(.light):not(.dark) {
    /* dark values */
  }
}
```

#### 2.2 Define Semantic Color Variables

Create consistent naming for all UI colors:

```css
:root {
  /* Backgrounds */
  --bg-primary: #ffffff;
  --bg-secondary: #f8fafc;
  --bg-tertiary: #f1f5f9;
  --bg-elevated: #ffffff;

  /* Borders */
  --border-default: #e2e8f0;
  --border-subtle: #f1f5f9;
  --border-strong: #cbd5e1;

  /* Text */
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #94a3b8;
  --text-inverted: #ffffff;

  /* Interactive */
  --interactive-default: #3b82f6;
  --interactive-hover: #2563eb;
  --interactive-active: #1d4ed8;

  /* Status Colors */
  --status-active: #10b981;
  --status-active-bg: #d1fae5;
  --status-active-border: #6ee7b7;

  --status-todo: #3b82f6;
  --status-todo-bg: #dbeafe;
  --status-todo-border: #93c5fd;

  --status-starred: #f59e0b;
  --status-starred-bg: #fef3c7;

  /* Surfaces (cards, panels) */
  --surface-card: #ffffff;
  --surface-card-hover: #f8fafc;
  --surface-panel: #f8fafc;

  /* Scrollbar */
  --scrollbar-track: #f1f5f9;
  --scrollbar-thumb: #cbd5e1;
  --scrollbar-thumb-hover: #94a3b8;
}

.dark {
  /* Backgrounds */
  --bg-primary: #0a0a0a;
  --bg-secondary: #18181b;
  --bg-tertiary: #27272a;
  --bg-elevated: #18181b;

  /* Borders */
  --border-default: #27272a;
  --border-subtle: #18181b;
  --border-strong: #3f3f46;

  /* Text */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;
  --text-inverted: #0a0a0a;

  /* Interactive */
  --interactive-default: #3b82f6;
  --interactive-hover: #60a5fa;
  --interactive-active: #93c5fd;

  /* Status Colors */
  --status-active: #10b981;
  --status-active-bg: rgba(16, 185, 129, 0.1);
  --status-active-border: rgba(16, 185, 129, 0.2);

  --status-todo: #3b82f6;
  --status-todo-bg: rgba(59, 130, 246, 0.1);
  --status-todo-border: rgba(59, 130, 246, 0.2);

  --status-starred: #fbbf24;
  --status-starred-bg: rgba(251, 191, 36, 0.1);

  /* Surfaces */
  --surface-card: #18181b;
  --surface-card-hover: #27272a;
  --surface-panel: #18181b;

  /* Scrollbar */
  --scrollbar-track: #18181b;
  --scrollbar-thumb: #3f3f46;
  --scrollbar-thumb-hover: #52525b;
}
```

#### 2.3 Update MDXEditor Theme

The `.dark-theme` block in globals.css needs a `.light-theme` counterpart:

```css
.light-theme {
  --accentBase: #3b82f6;
  --accentBgSubtle: #eff6ff;
  --accentBg: #dbeafe;
  /* ... complete light palette for editor */
}
```

### Phase 3: Theme Toggle UI

#### 3.1 Create `ThemeToggle.tsx` Component

Location: `src/components/ThemeToggle.tsx`

Design:
- Three-state toggle button
- Icons: Sun (light), Moon (dark), Monitor (system)
- Dropdown menu with explicit labels
- Accessible (keyboard navigation, ARIA)

```tsx
// Options shown in dropdown
const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];
```

#### 3.2 Add to Status Bar

Location: `src/components/Board.tsx` (status bar section)

Placement: Right side, after search input

```tsx
{/* Right controls */}
<div className="flex items-center gap-2">
  <FilterDropdown ... />
  <SearchInput ... />
  <ThemeToggle />  {/* NEW */}
</div>
```

### Phase 4: Component Color Migration

#### 4.1 Migration Strategy

Two approaches (choose based on scope):

**Option A: CSS Variables Only** (Recommended)
- Replace hardcoded Tailwind colors with CSS variable references
- Use arbitrary value syntax: `bg-[var(--bg-secondary)]`
- Smaller diff, easier to review

**Option B: Tailwind Dark Mode Classes**
- Use Tailwind's `dark:` variant throughout
- More idiomatic Tailwind
- Much larger diff (every color needs light + dark variant)

**Recommendation**: Use Option A (CSS variables) for backgrounds, borders, and text. Keep Tailwind colors for status/accent colors that stay consistent.

#### 4.2 Component Migration Checklist

| Component | Estimated Changes | Priority |
|-----------|------------------|----------|
| `Board.tsx` | ~20 color refs | High |
| `SessionCard.tsx` | ~30 color refs | High |
| `Column.tsx` | ~15 color refs | High |
| `InboxCard.tsx` | ~15 color refs | High |
| `TerminalDrawer.tsx` | ~10 color refs | High |
| `Terminal.tsx` | ~5 color refs | Medium |
| `PlanEditor.tsx` | ~5 color refs + theme class | High |
| `ViewToggle.tsx` | ~10 color refs | Medium |
| `Sidebar.tsx` | ~10 color refs | Medium |
| `TreeView.tsx` | ~10 color refs | Medium |
| `ScopeBreadcrumbs.tsx` | ~10 color refs | Medium |
| Other scope components | ~20 color refs total | Low |

#### 4.3 Example Migration

Before:
```tsx
<div className="bg-zinc-900 border-b border-zinc-800 text-zinc-100">
```

After:
```tsx
<div className="bg-[var(--bg-primary)] border-b border-[var(--border-default)] text-[var(--text-primary)]">
```

### Phase 5: Special Considerations

#### 5.1 Terminal (xterm.js)

xterm.js has its own theming API. Need to:
1. Create light and dark xterm themes
2. Apply theme dynamically when toggle changes
3. Update `Terminal.tsx` to listen to theme context

```typescript
const lightTerminalTheme = {
  background: '#ffffff',
  foreground: '#1f2937',
  cursor: '#1f2937',
  // ... full palette
};

const darkTerminalTheme = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  cursor: '#fafafa',
  // ... full palette
};
```

#### 5.2 MDXEditor

MDXEditor theme is controlled via CSS class on wrapper:
- Currently: `<MDXEditor className="dark-theme" />`
- Change to: `<MDXEditor className={resolvedTheme === 'dark' ? 'dark-theme' : 'light-theme'} />`

#### 5.3 Scrollbar Styling

Scrollbar colors in globals.css use hardcoded colors. Update to use CSS variables:

```css
::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}
::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
}
```

#### 5.4 Custom Animations/Transitions

Add smooth theme transition:
```css
html {
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

But disable during initial load to prevent flash.

### Phase 6: Testing Checklist

- [ ] Theme persists across page refreshes
- [ ] System preference changes trigger update (when set to 'system')
- [ ] No flash of wrong theme on initial load
- [ ] All text has sufficient contrast in both themes
- [ ] Cards, borders, and surfaces are distinct in light theme
- [ ] Terminal readable in both themes
- [ ] PlanEditor (MDXEditor) renders correctly in both themes
- [ ] Scrollbars visible in both themes
- [ ] Live indicators (pulsing dots) visible in light theme
- [ ] Selection states clear in both themes
- [ ] Hover states clear in both themes

## File Changes Summary

### New Files
- `src/hooks/useTheme.ts` - Theme state management
- `src/components/ThemeProvider.tsx` - Context provider
- `src/components/ThemeToggle.tsx` - Toggle UI component

### Modified Files
- `src/app/layout.tsx` - Add provider, remove hardcoded class
- `src/app/globals.css` - Add light theme variables, restructure
- `src/components/Board.tsx` - Add toggle to status bar
- `src/components/Terminal.tsx` - Dynamic xterm theme
- `src/components/PlanEditor.tsx` - Dynamic MDXEditor theme class
- All component files - Migrate colors to CSS variables

## Estimated Scope

- **New code**: ~200 lines
- **Modified code**: ~500 lines (mostly color replacements)
- **Risk level**: Low (visual changes only, no logic changes)
- **Rollback**: Easy (revert to hardcoded dark)

## Open Questions

1. **Toggle style**: Dropdown menu vs segmented control vs icon cycle?
2. **Transition animation**: Instant vs fade (200ms)?
3. **Terminal theme**: Match app theme or independent setting?
4. **Color palette**: Pure white (#fff) or slightly warm (#fafafa)?
