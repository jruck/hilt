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

### Toggle with heading-level sizing

Use the `data-level` attribute to set the summary's font size to match a heading level. Wrap the text in `<b>` for bold weight.

**Important:** Do NOT use heading tags (`<h3>`, `<h4>`, etc.) inside `<summary>` — browsers treat block elements inside `<summary>` as invalid HTML and will hoist them out, breaking the toggle.

```markdown
<details>
<summary data-level="3"><b>Major Section — 40 pts</b></summary>

Content...

</details>
```

Available levels:

| `data-level` | Matches | Font size |
|---|---|---|
| `"2"` | H2 | 1.429em |
| `"3"` | H3 | 1.286em |
| `"4"` | H4 | 1.1em |
| `"5"` | H5 | 1em |

### Start expanded

Add `open` to show content by default:

```markdown
<details open>
<summary data-level="3"><b>Expanded by Default</b></summary>

This content is visible on load.

</details>
```

### Nesting toggles

Toggles can nest. Inner toggles render with a subtler border:

```markdown
<details>
<summary data-level="3"><b>Parent Section</b></summary>

Overview text...

<details>
<summary data-level="4"><b>Child Section</b></summary>

Detailed content...

</details>

</details>
```

### Important rules

1. **Blank lines required** — leave a blank line after `<summary>` and before `</details>`, otherwise the markdown parser won't process the content inside as markdown.
2. **Use `data-level` + `<b>`, not heading tags** — `<summary data-level="3"><b>Title</b></summary>`, never `<summary><h3>Title</h3></summary>`.
3. **Keep levels consistent** — if the parent toggle uses `data-level="3"`, child toggles should use `data-level="4"`, and content headings inside should use `#####` (H5).

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
