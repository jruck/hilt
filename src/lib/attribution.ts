/**
 * Agent Task Attribution & Lifecycle Parser
 * 
 * Parses "← AgentName" from task titles and provides avatar mappings.
 * Also parses lifecycle markers: 🆕 (new), ⁇ (maybe done)
 */

export interface Attribution {
  agent: string;           // "Data", "Quark", etc.
  emoji: string;           // Avatar emoji
  displayTitle: string;    // Title with attribution stripped
}

export type LifecycleState = "new" | "active" | "review" | "done";

export interface TaskLifecycle {
  state: LifecycleState;
  displayTitle: string;    // Title with lifecycle marker stripped
}

// Agent avatar mappings
const AGENT_AVATARS: Record<string, string> = {
  "data": "🔍",
  "quark": "💰",
  "number one": "🔢",
  "chief": "👨‍⚕️",
  "jordy": "🔧",
  "justin": "👤",
};

// Regex to match attribution at end of title: "← AgentName"
const ATTRIBUTION_REGEX = /\s*←\s*([^←]+?)\s*$/;

/**
 * Parse attribution from a task title.
 * Returns null if no attribution found.
 */
export function parseAttribution(title: string): Attribution | null {
  const match = title.match(ATTRIBUTION_REGEX);
  
  if (!match) {
    return null;
  }
  
  const agent = match[1].trim();
  const agentLower = agent.toLowerCase();
  const emoji = AGENT_AVATARS[agentLower] || "🤖";
  const displayTitle = title.replace(ATTRIBUTION_REGEX, "").trim();
  
  return {
    agent,
    emoji,
    displayTitle,
  };
}

/**
 * Get avatar emoji for an agent name.
 */
export function getAgentEmoji(agent: string): string {
  return AGENT_AVATARS[agent.toLowerCase()] || "🤖";
}

// Lifecycle markers
const NEW_MARKER = "🆕";
const REVIEW_MARKER = "⁉️";

/**
 * Parse lifecycle state from a task title.
 * Markers: 🆕 (new, sub-status of to-do), ⁉️ (review, sub-status of done)
 * - Unchecked + 🆕 → "new" (AI added, user hasn't seen yet)
 * - Unchecked, no marker → "active" (normal to-do)
 * - Checked + ⁉️ → "review" (AI proposes as complete, needs user confirmation)
 * - Checked, no marker → "done" (confirmed done)
 */
export function parseLifecycle(title: string, done: boolean): TaskLifecycle {
  const trimmed = title.trim();

  if (done) {
    if (trimmed.startsWith(REVIEW_MARKER)) {
      return {
        state: "review",
        displayTitle: trimmed.slice(REVIEW_MARKER.length).trim(),
      };
    }
    return { state: "done", displayTitle: title };
  }

  if (trimmed.startsWith(NEW_MARKER)) {
    return {
      state: "new",
      displayTitle: trimmed.slice(NEW_MARKER.length).trim(),
    };
  }

  if (trimmed.startsWith(REVIEW_MARKER)) {
    return {
      state: "review",
      displayTitle: trimmed.slice(REVIEW_MARKER.length).trim(),
    };
  }

  return { state: "active", displayTitle: title };
}
