# Markdown Authoring Guide

Conventions for writing markdown files rendered by Hilt's docs viewer. Follow these when creating or editing files in a Bridge vault.

## Heading Hierarchy

Hilt renders H1–H6 with a clear size scale. Use them in order — don't skip levels.

| Level | Use for | Example |
|-------|---------|---------|
| `#` H1 | Document title | `# Project Proposal` |
| `##` H2 | Major sections | `## Requirements` |
| `###` H3 | Subsections | `### Authentication` |
| `####` H4 | Sub-subsections | `#### OAuth Flow` |
| `#####` H5 | Detail groups within a section | `##### Step 1: Token Exchange` |
| `######` H6 | Minor labels (rendered uppercase) | `###### Notes` |

## Toggle Sections (Collapsible Content)

Use HTML `<details>` / `<summary>` to create Notion-style collapsible toggles. Hilt styles these as bordered cards with a chevron indicator.

### Basic toggle

```markdown
<details>
<summary>Section Title</summary>

Content here — full markdown supported (tables, lists, headings, etc.)

</details>
```

### Toggle with a heading in the summary

Wrap the summary text in a heading tag to get proper heading sizing:

```markdown
<details>
<summary><h3>Major Section — 40 pts</h3></summary>

Content...

</details>
```

The heading tag controls the font size. Use the appropriate level for the document hierarchy (H3, H4, etc.).

### Start expanded

Add `open` to show content by default:

```markdown
<details open>
<summary><h3>Expanded by Default</h3></summary>

This content is visible on load.

</details>
```

### Nesting toggles

Toggles can nest. Inner toggles render with a subtler border:

```markdown
<details>
<summary><h3>Parent Section</h3></summary>

Overview text...

<details>
<summary><h4>Child Section</h4></summary>

Detailed content...

</details>

</details>
```

### Important rules

1. **Blank lines required** — leave a blank line after `<summary>` and before `</details>`, otherwise the markdown parser won't process the content inside as markdown.
2. **Headings in summary are optional** — plain text works too: `<summary>Click to expand</summary>`
3. **Keep heading levels consistent** — if the parent toggle summary uses `<h3>`, child toggle summaries should use `<h4>`, and content headings inside should use `#####` (H5).

## Tables Without Headers

Markdown requires a header row, but you can leave it empty for headerless data tables:

```markdown
| | |
|---|---|
| Row 1 content | Status |
| Row 2 content | Status |
```

Hilt hides the empty header row automatically — no visible gap.

## Frontmatter

YAML frontmatter between `---` fences is extracted and displayed as a compact bar above the document content.

```markdown
---
status: in-progress
client: Acme Corp
icon: 🏠
due: 2026-04-15
---
```

### Common fields

| Field | Purpose |
|-------|---------|
| `status` | Project status: `considering`, `in-progress`, `complete`, `on-hold` |
| `icon` | Emoji displayed on project cards. Use the actual emoji character, not Unicode escapes. |
| `client` | Client name |
| `area` | Organizational area |
| `tags` | Comma-separated list: `[design, frontend, api]` |

### Emoji values

Always use the actual emoji character:

```yaml
icon: 🏠    # correct
icon: "\U0001F3E0"  # wrong — renders as literal text
```

## Wikilinks

Hilt resolves Obsidian-style wikilinks:

```markdown
[[filename]]           — links to a file by name
[[filename|Display]]   — custom display text
![[image.png]]         — embedded image
```

## Images and Media

Relative paths are resolved from the current file's directory. A `media/` subfolder is checked for bare filenames (Obsidian attachment convention).

Video files (`.mp4`, `.webm`, `.mov`) linked as images are automatically rendered as `<video>` elements with playback controls.
