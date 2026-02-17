# Competitive Analysis Agent

Analyze a competitor tool and generate a structured report.

## Usage

```
Analyze this competitor: [URL]
```

## Instructions

When given a URL to analyze, perform the following research and generate a report:

### 1. Discovery Phase

**REQUIRED sources (always check these):**
- **Website** - The tool's main website for marketing, features, pricing
- **GitHub Repository** - Search for their repo, analyze README, architecture, tech stack
- **Codebase Analysis** - If repo is available, explore the code structure, key files, implementation patterns

**Additional sources:**
- Documentation site
- Product hunt / launch announcements
- Blog posts or changelogs
- Twitter/X presence
- Demo videos or screenshots

**Extract:**
- Tool name and tagline
- Primary problem they solve
- Target audience
- Pricing model (free/paid/open-source)
- Technology stack (if visible)
- Key features list
- Integration points (IDEs, APIs, services)
- Community size indicators (GitHub stars, Discord members, etc.)

### 2. Analysis Phase

**Feature Comparison:**
Compare their features against Hilt's capabilities:
- Session management
- Task/status tracking
- Visual organization (board, tree, docs views)
- Terminal integration
- Search and filtering
- Scope/project management

**Unique Strengths:**
- What do they do better than us?
- What innovative approaches do they take?
- What UX patterns are worth noting?

**Our Advantages:**
- What do we do that they don't?
- Where is our approach superior?
- What's unique about our implementation?

**Learning Opportunities:**
- Features we should consider adding
- UX improvements to explore
- Technical approaches worth investigating

### 3. Report Generation

Generate a markdown file at `/docs/neighbors/[tool-name].md` with this structure:

```markdown
# [Tool Name]

> [Their tagline or one-line description]

**URL:** [main URL]
**GitHub:** [if available]
**Pricing:** [free/paid/open-source]
**Last Updated:** [date of analysis]

## Overview

[2-3 paragraph summary of what the tool does and who it's for]

## Key Features

- Feature 1
- Feature 2
- ...

## Technology Stack

[What they're built with, if known]

## Comparison with Hilt

### They Have, We Don't

| Feature | Their Implementation | Priority for Us |
|---------|---------------------|-----------------|
| ... | ... | Low/Medium/High |

### We Have, They Don't

| Feature | Our Implementation | Their Gap |
|---------|-------------------|-----------|
| ... | ... | ... |

### Both Have (Compare Quality)

| Feature | Theirs | Ours | Winner |
|---------|--------|------|--------|
| ... | ... | ... | ... |

## Learning Opportunities

### Features to Consider

1. **[Feature Name]** - [Why it's interesting, how we might implement it]

### UX Patterns

1. **[Pattern]** - [What makes it effective]

### Technical Approaches

1. **[Approach]** - [What we could learn]

## Our Unique Value

[What makes Hilt distinct from this competitor]

## Verdict

[Overall assessment: direct competitor, adjacent tool, potential integration, etc.]

---

*Analysis performed: [date]*
```

## Example Analysis Request

```
Analyze this competitor: https://github.com/cline/cline
```

## Notes

- Be thorough but objective
- Focus on actionable insights
- Prioritize features that align with our vision
- Note integration opportunities, not just competition
- Update existing analyses if re-running on same tool
