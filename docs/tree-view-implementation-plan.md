# Tree View Implementation Plan

A detailed implementation plan for the fractal workspace "Tree View" feature in Hilt.

## Overview

Tree View provides an alternate UI mode alongside Kanban, displaying folders as a treemap visualization sized by activity. Users can toggle between Kanban and Tree view at any scope level, with sessions from child folders rolling up to parent views.

---

## Phase 1: Core Infrastructure

### 1.1 Tree Data Utilities

**File: `src/lib/tree-utils.ts`** (NEW)

Build hierarchical tree structure from flat session list.

```typescript
export interface TreeNode {
  path: string;              // Full folder path
  name: string;              // Display name (last segment)
  depth: number;             // Depth from current scope root

  // Direct data
  sessions: Session[];       // Sessions where projectPath === this.path
  children: TreeNode[];      // Child folder nodes

  // Rolled-up metrics (includes all descendants)
  metrics: TreeMetrics;
}

export interface TreeMetrics {
  totalSessions: number;
  directSessions: number;    // Sessions in this exact folder
  activeCount: number;       // status === "active"
  inboxCount: number;        // status === "inbox"
  recentCount: number;       // status === "recent"
  runningCount: number;      // isRunning === true
  lastActivity: number;      // Timestamp
  heatScore: number;         // Computed sizing metric
}

// Core functions to implement:

/**
 * Build tree from flat session list
 * @param sessions - All sessions under scope (prefix-matched)
 * @param scopePath - Current scope root
 * @returns TreeNode for scope root with children populated
 */
export function buildTree(sessions: Session[], scopePath: string): TreeNode;

/**
 * Get all unique folder paths from sessions
 */
export function extractFolderPaths(sessions: Session[]): string[];

/**
 * Calculate metrics for a node (recursive, bottom-up)
 */
export function calculateMetrics(node: TreeNode): TreeMetrics;

/**
 * Sort children by heat score (descending)
 */
export function sortByHeat(nodes: TreeNode[]): TreeNode[];
```

**Implementation details:**

```typescript
export function buildTree(sessions: Session[], scopePath: string): TreeNode {
  // 1. Group sessions by exact projectPath
  const sessionsByPath = new Map<string, Session[]>();
  for (const session of sessions) {
    const existing = sessionsByPath.get(session.projectPath) || [];
    existing.push(session);
    sessionsByPath.set(session.projectPath, existing);
  }

  // 2. Extract all unique paths and build path hierarchy
  const allPaths = Array.from(sessionsByPath.keys());
  const normalizedScope = scopePath || "/";

  // 3. Build tree structure
  const root: TreeNode = {
    path: normalizedScope,
    name: normalizedScope.split("/").pop() || "All Projects",
    depth: 0,
    sessions: sessionsByPath.get(normalizedScope) || [],
    children: [],
    metrics: { /* computed later */ }
  };

  // 4. For each path, find its position in tree
  for (const path of allPaths) {
    if (path === normalizedScope) continue;
    insertPathIntoTree(root, path, sessionsByPath.get(path) || [], normalizedScope);
  }

  // 5. Calculate metrics bottom-up
  calculateMetrics(root);

  // 6. Sort children by heat
  sortChildrenByHeat(root);

  return root;
}
```

---

### 1.2 Heat Score Calculation

**File: `src/lib/heat-score.ts`** (NEW)

```typescript
export interface HeatConfig {
  recencyWeight: number;      // Default: 0.6
  volumeWeight: number;       // Default: 0.3
  runningBonus: number;       // Default: 0.5 per running session
  recencyHalfLifeHours: number; // Default: 24
}

export const DEFAULT_HEAT_CONFIG: HeatConfig = {
  recencyWeight: 0.6,
  volumeWeight: 0.3,
  runningBonus: 0.5,
  recencyHalfLifeHours: 24,
};

/**
 * Calculate heat score for sizing treemap rectangles
 */
export function calculateHeatScore(
  metrics: Omit<TreeMetrics, 'heatScore'>,
  config: HeatConfig = DEFAULT_HEAT_CONFIG
): number {
  const now = Date.now();
  const hoursSinceActivity = (now - metrics.lastActivity) / (1000 * 60 * 60);

  // Exponential decay based on recency
  const recencyScore = Math.exp(-hoursSinceActivity / config.recencyHalfLifeHours);

  // Log-scale volume to prevent large projects from dominating
  const volumeScore = Math.log10(metrics.totalSessions + 1);

  // Bonus for actively running sessions
  const runningBonus = metrics.runningCount * config.runningBonus;

  return (
    recencyScore * config.recencyWeight +
    volumeScore * config.volumeWeight +
    runningBonus
  );
}

/**
 * Normalize heat scores to 0-1 range for a set of nodes
 */
export function normalizeHeatScores(nodes: TreeNode[]): TreeNode[] {
  const scores = nodes.map(n => n.metrics.heatScore);
  const max = Math.max(...scores, 0.001); // Avoid division by zero
  const min = Math.min(...scores);

  return nodes.map(node => ({
    ...node,
    metrics: {
      ...node.metrics,
      normalizedHeat: (node.metrics.heatScore - min) / (max - min)
    }
  }));
}
```

---

### 1.3 Treemap Layout Algorithm

**File: `src/lib/treemap-layout.ts`** (NEW)

Implement squarified treemap algorithm for optimal rectangle aspect ratios.

```typescript
export interface TreemapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  node: TreeNode;
  renderLevel: 1 | 2 | 3 | 4;  // Detail level based on size
}

export interface TreemapConfig {
  width: number;
  height: number;
  padding: number;           // Gap between rectangles
  minWidth: number;          // Minimum rectangle width
  minHeight: number;         // Minimum rectangle height
}

/**
 * Layout tree nodes as treemap rectangles
 * Uses squarified treemap algorithm for optimal aspect ratios
 */
export function layoutTreemap(
  nodes: TreeNode[],
  config: TreemapConfig
): TreemapRect[] {
  // Use d3-hierarchy's treemap or implement squarified algorithm
  // ...
}

/**
 * Determine render level based on rectangle dimensions
 */
export function getRenderLevel(width: number, height: number): 1 | 2 | 3 | 4 {
  const area = width * height;

  if (area >= 40000 && width >= 200 && height >= 150) return 1; // Full detail
  if (area >= 15000 && width >= 120 && height >= 100) return 2; // Medium
  if (area >= 5000 && width >= 80 && height >= 60) return 3;   // Summary
  return 4; // Minimal
}

/**
 * Render level definitions:
 *
 * Level 1 (Large): Full detail
 *   - Folder name + path
 *   - Session thumbnails (up to 6)
 *   - Full metric counts (● 3 active  ○ 2 todo  □ 4 recent)
 *
 * Level 2 (Medium): Condensed
 *   - Folder name
 *   - Session pills (names only, up to 3)
 *   - Metric counts
 *
 * Level 3 (Small): Summary only
 *   - Folder name
 *   - Compact counts (●3 ○2)
 *
 * Level 4 (Tiny): Minimal
 *   - Truncated name
 *   - Single count or just color
 */
```

**Option: Use d3-hierarchy**

```typescript
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';

export function layoutTreemapD3(
  root: TreeNode,
  config: TreemapConfig
): TreemapRect[] {
  const h = hierarchy(root)
    .sum(d => d.metrics.heatScore)
    .sort((a, b) => b.value! - a.value!);

  const layout = treemap<TreeNode>()
    .size([config.width, config.height])
    .padding(config.padding)
    .tile(treemapSquarify);

  const layoutRoot = layout(h);

  return layoutRoot.children?.map(d => ({
    x: d.x0,
    y: d.y0,
    width: d.x1 - d.x0,
    height: d.y1 - d.y0,
    node: d.data,
    renderLevel: getRenderLevel(d.x1 - d.x0, d.y1 - d.y0)
  })) || [];
}
```

---

## Phase 2: API Changes

### 2.1 Modify Sessions API

**File: `src/app/api/sessions/route.ts`** (MODIFY)

Add `mode` query parameter for tree vs exact matching.

```typescript
// GET /api/sessions?scope=/path&mode=tree

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const scopePath = searchParams.get("scope") || "";
  const mode = searchParams.get("mode") || "exact"; // "exact" | "tree"
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "100", 10);

  // Get all Claude sessions
  const claudeSessions = await getSessions();

  let filteredSessions: Session[];

  if (mode === "tree") {
    // PREFIX MATCH: Include all sessions under scope
    filteredSessions = scopePath
      ? claudeSessions.filter(s =>
          s.projectPath === scopePath ||
          s.projectPath.startsWith(scopePath + "/")
        )
      : claudeSessions;
  } else {
    // EXACT MATCH: Current behavior
    filteredSessions = scopePath
      ? claudeSessions.filter(s => s.projectPath === scopePath)
      : claudeSessions;
  }

  // Apply status merge, pagination, etc.
  // ...

  // If tree mode, also return tree structure
  if (mode === "tree") {
    const tree = buildTree(filteredSessions, scopePath);
    return NextResponse.json({
      sessions: paginatedSessions,
      tree,
      total: filteredSessions.length,
      // ... other fields
    });
  }

  return NextResponse.json({
    sessions: paginatedSessions,
    total: filteredSessions.length,
    // ... other fields
  });
}
```

### 2.2 Update Types

**File: `src/lib/types.ts`** (MODIFY)

```typescript
// Add to existing types

export interface TreeNode {
  path: string;
  name: string;
  depth: number;
  sessions: Session[];
  children: TreeNode[];
  metrics: TreeMetrics;
}

export interface TreeMetrics {
  totalSessions: number;
  directSessions: number;
  activeCount: number;
  inboxCount: number;
  recentCount: number;
  runningCount: number;
  lastActivity: number;
  heatScore: number;
  normalizedHeat?: number;
}

export interface TreeSessionsResponse extends SessionsResponse {
  tree: TreeNode;
}
```

---

## Phase 3: React Components

### 3.1 View Toggle Component

**File: `src/components/ViewToggle.tsx`** (NEW)

```typescript
"use client";

import { LayoutGrid, GitBranch } from "lucide-react";

interface ViewToggleProps {
  view: "kanban" | "tree";
  onChange: (view: "kanban" | "tree") => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-zinc-800 rounded-lg p-0.5">
      <button
        onClick={() => onChange("kanban")}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
          transition-colors
          ${view === "kanban"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200"
          }
        `}
      >
        <LayoutGrid className="w-4 h-4" />
        Kanban
      </button>
      <button
        onClick={() => onChange("tree")}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
          transition-colors
          ${view === "tree"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200"
          }
        `}
      >
        <GitBranch className="w-4 h-4" />
        Tree
      </button>
    </div>
  );
}
```

---

### 3.2 Tree View Container

**File: `src/components/TreeView.tsx`** (NEW)

Main container that renders the treemap.

```typescript
"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { TreeNode, TreeMetrics } from "@/lib/types";
import { layoutTreemap, TreemapRect } from "@/lib/treemap-layout";
import { TreeNodeCard } from "./TreeNodeCard";
import { TreeSessionCard } from "./TreeSessionCard";

interface TreeViewProps {
  tree: TreeNode;
  scopePath: string;
  onNavigate: (path: string) => void;
  onOpenSession: (sessionId: string) => void;
}

export function TreeView({
  tree,
  scopePath,
  onNavigate,
  onOpenSession
}: TreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [rects, setRects] = useState<TreemapRect[]>([]);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate layout when dimensions or tree changes
  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return;

    // Combine children and direct sessions for layout
    const itemsToLayout = prepareLayoutItems(tree);

    const layout = layoutTreemap(itemsToLayout, {
      width: dimensions.width,
      height: dimensions.height,
      padding: 8,
      minWidth: 60,
      minHeight: 40,
    });

    setRects(layout);
  }, [tree, dimensions]);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative bg-zinc-900 overflow-hidden"
    >
      {rects.map((rect, i) => (
        <div
          key={rect.node.path}
          className="absolute transition-all duration-300 ease-out"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          {rect.node.sessions.length > 0 && rect.node.children.length === 0 ? (
            // Leaf node with sessions - show session cards
            <TreeSessionCard
              session={rect.node.sessions[0]}
              renderLevel={rect.renderLevel}
              onClick={() => onOpenSession(rect.node.sessions[0].id)}
            />
          ) : (
            // Folder node - show folder card
            <TreeNodeCard
              node={rect.node}
              renderLevel={rect.renderLevel}
              onClick={() => onNavigate(rect.node.path)}
              onOpenSession={onOpenSession}
            />
          )}
        </div>
      ))}

      {/* Empty state */}
      {rects.length === 0 && (
        <div className="flex items-center justify-center h-full text-zinc-500">
          No sessions in this scope
        </div>
      )}
    </div>
  );
}

/**
 * Prepare items for treemap layout
 * - Child folders become nodes
 * - Direct sessions (in current folder but not subfolders)
 *   get grouped into a "Direct" pseudo-node or laid out individually
 */
function prepareLayoutItems(tree: TreeNode): TreeNode[] {
  const items: TreeNode[] = [];

  // Add child folders
  items.push(...tree.children);

  // Add direct sessions as individual items or grouped
  if (tree.sessions.length > 0) {
    // Option A: Each session as its own node
    for (const session of tree.sessions) {
      items.push({
        path: `${tree.path}/__session_${session.id}`,
        name: session.title || session.slug || "Session",
        depth: tree.depth + 1,
        sessions: [session],
        children: [],
        metrics: {
          totalSessions: 1,
          directSessions: 1,
          activeCount: session.status === "active" ? 1 : 0,
          inboxCount: session.status === "inbox" ? 1 : 0,
          recentCount: session.status === "recent" ? 1 : 0,
          runningCount: session.isRunning ? 1 : 0,
          lastActivity: new Date(session.lastActivity).getTime(),
          heatScore: calculateSessionHeat(session),
        }
      });
    }
  }

  return items;
}
```

---

### 3.3 Tree Node Card (Folder)

**File: `src/components/TreeNodeCard.tsx`** (NEW)

Renders a folder in the treemap with adaptive detail levels.

```typescript
"use client";

import { Folder, Circle, Play } from "lucide-react";
import { TreeNode, Session } from "@/lib/types";

interface TreeNodeCardProps {
  node: TreeNode;
  renderLevel: 1 | 2 | 3 | 4;
  onClick: () => void;
  onOpenSession: (sessionId: string) => void;
}

export function TreeNodeCard({
  node,
  renderLevel,
  onClick,
  onOpenSession
}: TreeNodeCardProps) {
  const { metrics } = node;
  const hasRunning = metrics.runningCount > 0;

  // Heat-based background color
  const heatColor = getHeatColor(metrics.normalizedHeat || 0);

  return (
    <button
      onClick={onClick}
      className={`
        w-full h-full rounded-lg border border-zinc-700
        bg-zinc-800/80 hover:bg-zinc-800
        transition-colors cursor-pointer
        flex flex-col overflow-hidden
        ${hasRunning ? "ring-1 ring-emerald-500/50" : ""}
      `}
      style={{
        background: `linear-gradient(135deg, ${heatColor}15, transparent)`
      }}
    >
      {renderLevel === 1 && (
        <Level1Content
          node={node}
          onOpenSession={onOpenSession}
        />
      )}
      {renderLevel === 2 && (
        <Level2Content node={node} />
      )}
      {renderLevel === 3 && (
        <Level3Content node={node} />
      )}
      {renderLevel === 4 && (
        <Level4Content node={node} />
      )}
    </button>
  );
}

// Level 1: Full detail with session thumbnails
function Level1Content({
  node,
  onOpenSession
}: {
  node: TreeNode;
  onOpenSession: (id: string) => void
}) {
  const { metrics } = node;
  const displaySessions = getDisplaySessions(node, 6);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-zinc-700/50">
        <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-zinc-100 truncate">
            {node.name}
          </div>
          <div className="text-xs text-zinc-500 truncate">
            {node.path}
          </div>
        </div>
      </div>

      {/* Session thumbnails */}
      {displaySessions.length > 0 && (
        <div className="flex-1 p-2 grid grid-cols-2 gap-1.5 overflow-hidden">
          {displaySessions.map(session => (
            <SessionThumbnail
              key={session.id}
              session={session}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSession(session.id);
              }}
            />
          ))}
        </div>
      )}

      {/* Footer metrics */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-zinc-700/50 text-xs">
        {metrics.activeCount > 0 && (
          <span className="flex items-center gap-1 text-emerald-400">
            <Circle className="w-2 h-2 fill-current" />
            {metrics.activeCount} active
          </span>
        )}
        {metrics.inboxCount > 0 && (
          <span className="flex items-center gap-1 text-blue-400">
            <Circle className="w-2 h-2" />
            {metrics.inboxCount} todo
          </span>
        )}
        {metrics.recentCount > 0 && (
          <span className="flex items-center gap-1 text-zinc-500">
            {metrics.recentCount} recent
          </span>
        )}
      </div>
    </>
  );
}

// Level 2: Medium - name, pills, counts
function Level2Content({ node }: { node: TreeNode }) {
  const { metrics } = node;
  const displaySessions = getDisplaySessions(node, 3);

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center gap-1.5 mb-2">
        <Folder className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-medium text-sm text-zinc-100 truncate">
          {node.name}
        </span>
      </div>

      {/* Session pills */}
      {displaySessions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {displaySessions.map(s => (
            <span
              key={s.id}
              className={`
                text-xs px-1.5 py-0.5 rounded truncate max-w-[80px]
                ${s.isRunning
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-zinc-700 text-zinc-300"
                }
              `}
            >
              {s.slug || s.title?.slice(0, 12) || "session"}
            </span>
          ))}
        </div>
      )}

      {/* Compact metrics */}
      <div className="mt-auto flex items-center gap-2 text-xs">
        {metrics.activeCount > 0 && (
          <span className="text-emerald-400">●{metrics.activeCount}</span>
        )}
        {metrics.inboxCount > 0 && (
          <span className="text-blue-400">○{metrics.inboxCount}</span>
        )}
      </div>
    </div>
  );
}

// Level 3: Small - name and counts only
function Level3Content({ node }: { node: TreeNode }) {
  const { metrics } = node;

  return (
    <div className="flex flex-col items-center justify-center h-full p-1.5 text-center">
      <span className="text-xs font-medium text-zinc-200 truncate w-full">
        {node.name}
      </span>
      <div className="flex items-center gap-1.5 mt-1 text-xs">
        {metrics.activeCount > 0 && (
          <span className="text-emerald-400">●{metrics.activeCount}</span>
        )}
        {metrics.inboxCount > 0 && (
          <span className="text-blue-400">○{metrics.inboxCount}</span>
        )}
        {metrics.activeCount === 0 && metrics.inboxCount === 0 && (
          <span className="text-zinc-500">{metrics.totalSessions}</span>
        )}
      </div>
    </div>
  );
}

// Level 4: Tiny - just name or initial
function Level4Content({ node }: { node: TreeNode }) {
  const { metrics } = node;
  const hasActivity = metrics.runningCount > 0 || metrics.activeCount > 0;

  return (
    <div className={`
      flex items-center justify-center h-full p-1
      ${hasActivity ? "text-emerald-400" : "text-zinc-400"}
    `}>
      <span className="text-xs font-medium truncate">
        {node.name.slice(0, 8)}
      </span>
    </div>
  );
}

// Helper: Get sessions to display (prioritize running, then active)
function getDisplaySessions(node: TreeNode, max: number): Session[] {
  const all = getAllSessionsRecursive(node);

  // Sort: running first, then active, then by recency
  return all
    .sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      if (a.status !== b.status) {
        const order = { active: 0, inbox: 1, recent: 2 };
        return order[a.status] - order[b.status];
      }
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    })
    .slice(0, max);
}

function getAllSessionsRecursive(node: TreeNode): Session[] {
  let sessions = [...node.sessions];
  for (const child of node.children) {
    sessions = sessions.concat(getAllSessionsRecursive(child));
  }
  return sessions;
}

// Helper: Heat color from normalized score
function getHeatColor(normalized: number): string {
  // Cold (blue) -> Warm (yellow) -> Hot (red/orange)
  if (normalized < 0.3) return "#3b82f6"; // blue-500
  if (normalized < 0.6) return "#eab308"; // yellow-500
  return "#f97316"; // orange-500
}

// Session thumbnail for Level 1
function SessionThumbnail({
  session,
  onClick
}: {
  session: Session;
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        p-1.5 rounded text-left text-xs
        bg-zinc-700/50 hover:bg-zinc-700
        border border-zinc-600/50
        transition-colors
        ${session.isRunning ? "ring-1 ring-emerald-500" : ""}
      `}
    >
      <div className="flex items-center gap-1">
        {session.isRunning && (
          <Play className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
        )}
        <span className="truncate text-zinc-200">
          {session.slug || session.title?.slice(0, 15) || "session"}
        </span>
      </div>
    </button>
  );
}
```

---

### 3.4 Tree Session Card

**File: `src/components/TreeSessionCard.tsx`** (NEW)

Renders an individual session in the treemap (when a session is its own node).

```typescript
"use client";

import { Play, MessageSquare, GitBranch } from "lucide-react";
import { Session } from "@/lib/types";

interface TreeSessionCardProps {
  session: Session;
  renderLevel: 1 | 2 | 3 | 4;
  onClick: () => void;
}

export function TreeSessionCard({
  session,
  renderLevel,
  onClick
}: TreeSessionCardProps) {
  const isRunning = session.isRunning;

  return (
    <button
      onClick={onClick}
      className={`
        w-full h-full rounded-lg border
        ${isRunning
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-zinc-700 bg-zinc-800/80"
        }
        hover:bg-zinc-800 transition-colors cursor-pointer
        flex flex-col overflow-hidden text-left
      `}
    >
      {renderLevel === 1 && <SessionLevel1 session={session} />}
      {renderLevel === 2 && <SessionLevel2 session={session} />}
      {renderLevel === 3 && <SessionLevel3 session={session} />}
      {renderLevel === 4 && <SessionLevel4 session={session} />}
    </button>
  );
}

function SessionLevel1({ session }: { session: Session }) {
  return (
    <div className="flex flex-col h-full p-3">
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        {session.isRunning && (
          <Play className="w-4 h-4 text-emerald-400 fill-emerald-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-zinc-100 line-clamp-2">
            {session.title || session.slug || "Untitled"}
          </div>
          {session.slug && session.title && (
            <div className="text-xs text-zinc-500 truncate mt-0.5">
              {session.slug}
            </div>
          )}
        </div>
      </div>

      {/* Last prompt preview */}
      {session.lastPrompt && (
        <div className="text-xs text-zinc-400 line-clamp-2 mb-2 flex-1">
          {session.lastPrompt}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-zinc-500 mt-auto">
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {session.messageCount}
        </span>
        {session.gitBranch && (
          <span className="flex items-center gap-1 truncate">
            <GitBranch className="w-3 h-3" />
            {session.gitBranch}
          </span>
        )}
      </div>
    </div>
  );
}

function SessionLevel2({ session }: { session: Session }) {
  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center gap-1.5">
        {session.isRunning && (
          <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
        )}
        <span className="text-sm font-medium text-zinc-100 truncate">
          {session.slug || session.title?.slice(0, 20) || "session"}
        </span>
      </div>
      <div className="text-xs text-zinc-500 mt-1">
        {session.messageCount} msgs
      </div>
    </div>
  );
}

function SessionLevel3({ session }: { session: Session }) {
  return (
    <div className="flex items-center justify-center h-full p-1">
      <div className="flex items-center gap-1">
        {session.isRunning && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        )}
        <span className="text-xs text-zinc-300 truncate">
          {session.slug?.slice(0, 10) || "ses"}
        </span>
      </div>
    </div>
  );
}

function SessionLevel4({ session }: { session: Session }) {
  return (
    <div className={`
      flex items-center justify-center h-full
      ${session.isRunning ? "bg-emerald-500/20" : ""}
    `}>
      {session.isRunning ? (
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      ) : (
        <span className="text-xs text-zinc-500">●</span>
      )}
    </div>
  );
}
```

---

### 3.5 Hook for Tree Data

**File: `src/hooks/useTreeSessions.ts`** (NEW)

```typescript
"use client";

import useSWR from "swr";
import { TreeNode, Session, TreeSessionsResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function useTreeSessions(scopePath: string) {
  const { data, error, isLoading, mutate } = useSWR<TreeSessionsResponse>(
    `/api/sessions?scope=${encodeURIComponent(scopePath)}&mode=tree`,
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );

  return {
    tree: data?.tree ?? null,
    sessions: data?.sessions ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}
```

---

## Phase 4: Integration

### 4.1 Modify Board Component

**File: `src/components/Board.tsx`** (MODIFY)

Add view toggle and conditional rendering.

```typescript
// Add imports
import { ViewToggle } from "./ViewToggle";
import { TreeView } from "./TreeView";
import { useTreeSessions } from "@/hooks/useTreeSessions";

// Inside Board component:

// Add state for view mode
const [viewMode, setViewMode] = useState<"kanban" | "tree">("kanban");

// Fetch tree data when in tree mode
const { tree, sessions: treeSessions } = useTreeSessions(
  viewMode === "tree" ? scopePath : ""
);

// In render, add toggle to header
<div className="flex items-center gap-4">
  <ScopeBreadcrumbs ... />
  <ViewToggle view={viewMode} onChange={setViewMode} />
</div>

// Conditional render based on mode
{viewMode === "kanban" ? (
  <div className="flex flex-1 gap-4 overflow-hidden">
    <Column status="inbox" ... />
    <Column status="active" ... />
    <Column status="recent" ... />
  </div>
) : (
  <TreeView
    tree={tree}
    scopePath={scopePath}
    onNavigate={handleScopeChange}
    onOpenSession={(id) => openTerminal(sessions.find(s => s.id === id)!)}
  />
)}
```

### 4.2 Persist View Preference

**File: `src/lib/view-preference.ts`** (NEW)

```typescript
const STORAGE_KEY = "hilt-view-mode";

export function getViewPreference(): "kanban" | "tree" {
  if (typeof window === "undefined") return "kanban";
  return (localStorage.getItem(STORAGE_KEY) as "kanban" | "tree") || "kanban";
}

export function setViewPreference(mode: "kanban" | "tree"): void {
  localStorage.setItem(STORAGE_KEY, mode);
}
```

---

## Phase 5: Polish & Edge Cases

### 5.1 Empty States

- No sessions in scope → "No sessions in this folder"
- No child folders → Show only direct sessions
- All sessions in "recent" → Still show in tree (just dimmer)

### 5.2 Performance Considerations

```typescript
// Memoize expensive calculations
const layoutRects = useMemo(() =>
  layoutTreemap(tree, dimensions),
  [tree, dimensions.width, dimensions.height]
);

// Debounce resize observer
const debouncedSetDimensions = useDebouncedCallback(
  setDimensions,
  100
);
```

### 5.3 Keyboard Navigation (Future)

- Arrow keys to move between nodes
- Enter to drill down
- Backspace to go up
- `k` to switch to Kanban, `t` for Tree

### 5.4 URL State for View Mode

```typescript
// Optionally persist view mode in URL
// /path/to/scope?view=tree

const searchParams = useSearchParams();
const viewFromUrl = searchParams.get("view") as "kanban" | "tree" | null;
```

---

## Implementation Order

```
Week 1: Core Infrastructure
├── 1.1 tree-utils.ts (buildTree, calculateMetrics)
├── 1.2 heat-score.ts (calculateHeatScore)
├── 1.3 treemap-layout.ts (layoutTreemap, getRenderLevel)
└── 1.4 types.ts updates

Week 2: API & Data Layer
├── 2.1 Modify sessions/route.ts (mode=tree)
├── 2.2 useTreeSessions hook
└── 2.3 Test with mock data

Week 3: UI Components
├── 3.1 ViewToggle.tsx
├── 3.2 TreeView.tsx (container)
├── 3.3 TreeNodeCard.tsx (all 4 levels)
├── 3.4 TreeSessionCard.tsx (all 4 levels)
└── 3.5 Integrate into Board.tsx

Week 4: Polish
├── 4.1 Animations & transitions
├── 4.2 Edge cases & empty states
├── 4.3 Performance optimization
└── 4.4 View preference persistence
```

---

## Dependencies

```json
{
  "dependencies": {
    "d3-hierarchy": "^3.1.2"  // Optional, for treemap algorithm
  }
}
```

Alternative: Implement squarified treemap algorithm directly (no dependency).

---

## Testing Checklist

- [x] Tree builds correctly from flat session list
- [x] Metrics roll up from children to parents
- [x] Heat scores differentiate active vs stale folders
- [x] Treemap layout uses full available space
- [x] Render levels adapt to rectangle size
- [x] Click folder navigates (changes scope)
- [x] Click session opens terminal drawer
- [x] Toggle between Kanban ↔ Tree preserves scope
- [x] Running sessions show pulse indicator
- [x] Empty scope shows appropriate message
- [x] Resize window triggers re-layout
- [x] 5-second polling updates tree data
- [x] View preference persists across page loads

---

## Implementation Complete (2026-01-06)

### All Phases Implemented & Tested ✅

All phases (1-4) have been implemented and verified:
- Core infrastructure (tree-utils, heat-score, treemap-layout)
- API changes (mode=tree parameter)
- React components (ViewToggle, TreeView, TreeNodeCard, TreeSessionCard)
- Board.tsx integration with view toggle

### Bugs Fixed During Testing

**TreeView Height Bug**: The TreeView container had a height of only 56px because the wrapper div in Board.tsx was missing `flex flex-col`. Fixed by adding `flex flex-col` to the wrapper class.

### Known Limitations (Intentional)

These are not bugs, but documented design decisions:
- No drag-and-drop in Tree View (Kanban only)
- No status changes from Tree View (must open session)
- No inbox items in Tree View (drafts visible in Kanban only)
- No animation on tree structure changes (rectangles snap)
- Fixed heat formula (not user-configurable)
