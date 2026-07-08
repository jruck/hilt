"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Activity, Bot, FileText, Layers, Loader2, Map as MapIcon, MessageSquare, Network, RefreshCw, Server } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { LocalAppsView } from "@/components/local-apps";
import { PerformanceView } from "@/components/performance";
import { isGraphEnabled } from "@/lib/graph/config";
import { useIsMobile } from "@/hooks/useIsMobile";
import { SystemSyncView } from "./SystemSyncView";
import { SystemThreadsView } from "./SystemThreadsView";
import { StackFileTree, type StackFilterType } from "@/components/stack/StackFileTree";
import { StackSummary } from "@/components/stack/StackSummary";
import { MCPServerDetail } from "@/components/stack/MCPServerDetail";
import { PluginDetail } from "@/components/stack/PluginDetail";
import { CodeViewer } from "@/components/docs/CodeViewer";
import { SECONDARY_CHROME_BODY_GUTTER_CLASS, SecondarySegmentedButton, SecondarySegmentedControl, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import type { ClaudeStack, ConfigFile, ConfigFileContent, ConfigLayer, MCPServerConfig, PluginConfig } from "@/lib/claude-config/types";
import type { SystemStackSnapshot } from "@/lib/system/stack";
import type { SystemMode } from "@/lib/system/navigation";
import { withBasePath } from "@/lib/base-path";

const StackView = dynamic(() => import("@/components/stack").then((m) => ({ default: m.StackView })), { ssr: false });
// cosmos.gl/luma.gl touch window/document at import time; the WebGL2 Graph must be client-only.
const GraphView = dynamic(() => import("@/components/graph/GraphView").then((m) => ({ default: m.GraphView })), { ssr: false });

export type { SystemMode } from "@/lib/system/navigation";

interface SystemViewProps {
  mode: SystemMode;
  onModeChange: (mode: SystemMode) => void;
  searchQuery?: string;
  workingFolder: string;
  scopePath?: string;
}

const BASE_MODES: Array<{ id: SystemMode; label: string; icon: typeof MapIcon; title: string }> = [
  { id: "sessions", label: "Sessions", icon: MapIcon, title: "Agent and session work map" },
  { id: "apps", label: "Apps", icon: Server, title: "Running apps and local services" },
  { id: "stack", label: "Stack", icon: Layers, title: "Claude/Codex configuration stack" },
  { id: "sync", label: "Sync", icon: RefreshCw, title: "Syncthing sync health" },
  { id: "threads", label: "Threads", icon: MessageSquare, title: "Feedback threads across the system" },
  { id: "performance", label: "Performance", icon: Activity, title: "Mercury closet & compute telemetry" },
];

// Graph sub-mode is flag-gated: the tab is absent unless HILT_GRAPH_ENABLED is set.
// Slotted right after Sessions (before Apps), not appended.
const GRAPH_MODE = { id: "graph" as const, label: "Graph", icon: Network, title: "Knowledge graph of the vault" };
const MODES = isGraphEnabled()
  ? [BASE_MODES[0], GRAPH_MODE, ...BASE_MODES.slice(1)]
  : BASE_MODES;

let cachedSystemStackState: {
  snapshots: SystemStackSnapshot[];
  selectedMachineId: string;
} | null = null;

export function SystemView({ mode, onModeChange, searchQuery = "", workingFolder, scopePath = "" }: SystemViewProps) {
  // The knowledge graph is desktop/Electron-only (WebGL2 at scale + mobile Safari jetsam
  // limits make it unsuitable on phones — Obsidian scopes its full graph the same way).
  // Hide the tab and never load the cosmos chunk on mobile.
  const isMobile = useIsMobile();
  const graphAvailable = isGraphEnabled() && !isMobile;
  const visibleModes = useMemo(
    () => (graphAvailable ? MODES : MODES.filter((m) => m.id !== "graph")),
    [graphAvailable],
  );
  const modeSwitcher = <SystemModeSwitcher mode={mode} onModeChange={onModeChange} modes={visibleModes} />;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "sessions" ? (
          <MapView searchQuery={searchQuery} apiBase="/api/system/sessions" modeSwitcher={modeSwitcher} />
        ) : mode === "apps" ? (
          <LocalAppsView searchQuery={searchQuery} modeSwitcher={modeSwitcher} />
        ) : mode === "stack" ? (
          <SystemStackView workingFolder={workingFolder} searchQuery={searchQuery} modeSwitcher={modeSwitcher} />
        ) : mode === "graph" && graphAvailable ? (
          <GraphView searchQuery={searchQuery} modeSwitcher={modeSwitcher} scopePath={scopePath} />
        ) : mode === "graph" && isGraphEnabled() && isMobile ? (
          <div className="flex h-full min-h-0 flex-col" data-testid="graph-desktop-only">
            <SecondaryToolbar left={modeSwitcher} right={null} />
            <div className="hilt-mobile-fixed-clearance hilt-mobile-fixed-extra-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <Network className="h-6 w-6 text-[var(--text-tertiary)]" />
              <div className="text-sm font-medium text-[var(--text-primary)]">Graph is desktop-only</div>
              <div className="max-w-xs text-xs text-[var(--text-tertiary)]">Open the knowledge graph on the desktop app for the full WebGL view.</div>
            </div>
          </div>
        ) : mode === "performance" ? (
          <PerformanceView modeSwitcher={modeSwitcher} />
        ) : mode === "threads" ? (
          <SystemThreadsView modeSwitcher={modeSwitcher} />
        ) : (
          <SystemSyncView modeSwitcher={modeSwitcher} />
        )}
      </div>
    </div>
  );
}

function SystemModeSwitcher({ mode, onModeChange, modes }: { mode: SystemMode; onModeChange: (mode: SystemMode) => void; modes: typeof MODES }) {
  return (
    <SecondarySegmentedControl>
      {modes.map(({ id, label, icon: Icon, title }) => (
        <SecondarySegmentedButton
          key={id}
          onClick={() => onModeChange(id)}
          active={mode === id}
          icon={<Icon className="h-4 w-4" />}
          collapseLabel
          title={title}
        >
          {label}
        </SecondarySegmentedButton>
      ))}
    </SecondarySegmentedControl>
  );
}

function SystemStackView({
  workingFolder,
  searchQuery,
  modeSwitcher,
}: {
  workingFolder: string;
  searchQuery: string;
  modeSwitcher: ReactNode;
}) {
  const [snapshots, setSnapshots] = useState<SystemStackSnapshot[]>(() => cachedSystemStackState?.snapshots ?? []);
  const [selectedMachineId, setSelectedMachineId] = useState<string>(() => cachedSystemStackState?.selectedMachineId ?? "all");
  const [loading, setLoading] = useState(() => !cachedSystemStackState?.snapshots.length);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const params = new URLSearchParams();
      if (workingFolder) params.set("project", workingFolder);
      const response = await fetch(withBasePath(`/api/system/stack?${params.toString()}`), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setSnapshots(data.machines || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load system stack");
    } finally {
      setLoading(false);
    }
  }, [workingFolder]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    cachedSystemStackState = { snapshots, selectedMachineId };
  }, [selectedMachineId, snapshots]);

  const selected = useMemo(() => snapshots.find((snapshot) => snapshot.machine.id === selectedMachineId) || null, [selectedMachineId, snapshots]);

  if (loading && snapshots.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StackMachineBar
          modeSwitcher={modeSwitcher}
          snapshots={snapshots}
          selectedMachineId={selectedMachineId}
          onSelect={setSelectedMachineId}
          loading={loading}
          error={error}
        />
        <LoadingState label="Loading system stack" />
      </div>
    );
  }

  if (error && snapshots.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StackMachineBar
          modeSwitcher={modeSwitcher}
          snapshots={snapshots}
          selectedMachineId={selectedMachineId}
          onSelect={setSelectedMachineId}
          loading={loading}
          error={error}
        />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (selectedMachineId !== "all" && selected?.machine.self) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StackMachineBar
          modeSwitcher={modeSwitcher}
          snapshots={snapshots}
          selectedMachineId={selectedMachineId}
          onSelect={setSelectedMachineId}
          loading={loading}
          error={error}
        />
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-[var(--border-default)]">
            <StackView scopePath={workingFolder} searchQuery={searchQuery} />
          </div>
        </div>
      </div>
    );
  }

  if (selectedMachineId !== "all" && selected?.stack) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StackMachineBar
          modeSwitcher={modeSwitcher}
          snapshots={snapshots}
          selectedMachineId={selectedMachineId}
          onSelect={setSelectedMachineId}
          loading={loading}
          error={error}
        />
        <RemoteStackInspector snapshot={selected} searchQuery={searchQuery} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StackMachineBar
        modeSwitcher={modeSwitcher}
        snapshots={snapshots}
        selectedMachineId={selectedMachineId}
        onSelect={setSelectedMachineId}
        loading={loading}
        error={error}
      />
      <div data-mobile-scroll-chrome="bottom" className={`hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 flex-1 overflow-auto px-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshots.map((snapshot) => (
            <button
              key={snapshot.machine.id}
              type="button"
              onClick={() => setSelectedMachineId(snapshot.machine.id)}
              className="hilt-card hilt-card-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{machineTitle(snapshot)}</div>
                  <div className="mt-1 truncate text-xs text-[var(--text-tertiary)]">
                    {snapshot.projectPath ? displayPath(snapshot.projectPath) : "No project scope"}
                  </div>
                </div>
                {snapshot.readOnly ? (
                  <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">read only</span>
                ) : null}
              </div>
              {snapshot.stack ? (
                <StackSummaryStrip stack={snapshot.stack} />
              ) : (
                <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600">
                  {snapshot.error || "Unable to load stack"}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StackMachineBar({
  modeSwitcher,
  snapshots,
  selectedMachineId,
  onSelect,
  loading,
  error,
}: {
  modeSwitcher: ReactNode;
  snapshots: SystemStackSnapshot[];
  selectedMachineId: string;
  onSelect: (machineId: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <SecondaryToolbar
      left={modeSwitcher}
      right={
        <>
          <button
            type="button"
            onClick={() => onSelect("all")}
            className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors ${
              selectedMachineId === "all"
                ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            All machines
          </button>
          {snapshots.map((snapshot) => (
            <button
              key={snapshot.machine.id}
              type="button"
              onClick={() => onSelect(snapshot.machine.id)}
              className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors ${
                selectedMachineId === snapshot.machine.id
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {machineTitle(snapshot)}
            </button>
          ))}
          <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-tertiary)]">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {error ? <span className="text-red-600">{error}</span> : null}
          </div>
        </>
      }
    />
  );
}

function RemoteStackInspector({ snapshot, searchQuery }: { snapshot: SystemStackSnapshot; searchQuery: string }) {
  const stack = snapshot.stack;
  const [selectedFile, setSelectedFile] = useState<{ file: ConfigFile; layer: ConfigLayer } | null>(null);
  const [selectedMCPServer, setSelectedMCPServer] = useState<MCPServerConfig | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginConfig | null>(null);
  const [typeFilter, setTypeFilter] = useState<StackFilterType | null>(null);

  if (!stack) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        {snapshot.error || "No stack available"}
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
      <div className="flex min-h-0 flex-1 border-t border-[var(--border-default)]">
        <div className="flex w-[360px] shrink-0 flex-col border-r border-[var(--border-default)]">
          <div className="border-b border-[var(--border-default)] px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Remote stack</div>
            <div className="mt-1 truncate text-sm text-[var(--text-primary)]">{displayPath(snapshot.projectPath || stack.projectPath)}</div>
          </div>
          <div data-mobile-scroll-chrome="bottom" className="hilt-mobile-scroll-clearance min-h-0 flex-1 overflow-auto">
            <StackFileTree
              layers={stack.layers}
              mcpServers={stack.mcpServers}
              plugins={stack.plugins}
              selectedFile={selectedFile?.file || null}
              selectedMCPServer={selectedMCPServer}
              selectedPlugin={selectedPlugin}
              onSelectFile={(file, layer) => {
                setSelectedFile({ file, layer });
                setSelectedMCPServer(null);
                setSelectedPlugin(null);
              }}
              onSelectMCPServer={(server) => {
                setSelectedMCPServer(server);
                setSelectedFile(null);
                setSelectedPlugin(null);
              }}
              onSelectPlugin={(plugin) => {
                setSelectedPlugin(plugin);
                setSelectedFile(null);
                setSelectedMCPServer(null);
              }}
              typeFilter={typeFilter}
              searchQuery={searchQuery}
            />
          </div>
          <div className="border-t border-[var(--border-default)]">
            <StackSummary summary={stack.summary} activeFilter={typeFilter} onFilterChange={setTypeFilter} />
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {selectedPlugin ? (
            <PluginDetail plugin={selectedPlugin} onMCPServerClick={(serverName) => {
              const server = stack.mcpServers.find((item) => item.name === serverName);
              if (server) {
                setSelectedMCPServer(server);
                setSelectedPlugin(null);
              }
            }} />
          ) : selectedMCPServer ? (
            <MCPServerDetail server={selectedMCPServer} />
          ) : (
            <ReadOnlyStackFilePane
              machineId={snapshot.machine.id}
              projectPath={snapshot.projectPath || stack.projectPath}
              selected={selectedFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyStackFilePane({
  machineId,
  projectPath,
  selected,
}: {
  machineId: string;
  projectPath: string;
  selected: { file: ConfigFile; layer: ConfigLayer } | null;
}) {
  const requestKey = selected?.file.path ? `${machineId}::${projectPath}::${selected.file.path}` : null;
  const [result, setResult] = useState<{
    key: string;
    content: ConfigFileContent | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!requestKey || !selected?.file.path) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      machine: machineId,
      path: selected.file.path,
      project: projectPath,
    });
    fetch(withBasePath(`/api/system/stack/file?${params.toString()}`), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
        return data.file as ConfigFileContent;
      })
      .then((file) => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, content: file, error: null });
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            content: null,
            error: err instanceof Error ? err.message : "Failed to read file",
          });
        }
      });

    return () => controller.abort();
  }, [machineId, projectPath, requestKey, selected?.file.path]);

  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-[var(--text-tertiary)]">
        <FileText className="mb-2 h-5 w-5" />
        <div className="text-sm">Select a remote config item</div>
      </div>
    );
  }

  const currentResult = result?.key === requestKey ? result : null;

  if (!currentResult) {
    return (
      <LoadingState label="Loading file" />
    );
  }

  if (currentResult.error) {
    return (
      <div className="m-4 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600">
        {currentResult.error}
      </div>
    );
  }

  if (!currentResult.content || currentResult.content.isSensitive) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        {currentResult.content?.isSensitive ? "Sensitive file hidden" : "No readable content"}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-11 items-center justify-between border-b border-[var(--border-default)] px-4">
        <div className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">{selected.file.name}</div>
        <div className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">read only</div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeViewer filePath={selected.file.path} content={currentResult.content.content || ""} readOnly />
      </div>
    </div>
  );
}

function StackSummaryStrip({ stack }: { stack: ClaudeStack }) {
  const items = [
    ["Memory", stack.summary.memoryFiles, FileText],
    ["Skills", stack.summary.skills, Bot],
    ["Agents", stack.summary.agents, Bot],
    ["MCP", stack.summary.mcpServers, Server],
    ["Plugins", stack.summary.plugins, Layers],
  ] as const;

  return (
    <div className="mt-4 grid grid-cols-5 gap-2">
      {items.map(([label, count, Icon]) => (
        <div key={label} className="rounded-md bg-[var(--bg-secondary)] px-2 py-2 text-center">
          <Icon className="mx-auto mb-1 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <div className="font-mono text-sm text-[var(--text-primary)]">{count}</div>
          <div className="truncate text-[10px] text-[var(--text-tertiary)]">{label}</div>
        </div>
      ))}
    </div>
  );
}

function machineTitle(snapshot: SystemStackSnapshot): string {
  const label = snapshot.machine.machine.tailscale_dns || snapshot.machine.machine.hostname || snapshot.machine.id;
  const short = label.replace(/\.$/, "").split(".")[0].replace(/-v$/i, "");
  return snapshot.machine.self ? `${short} · this machine` : short;
}

function displayPath(pathValue?: string | null): string {
  if (!pathValue) return "";
  return pathValue.replace(/^\/Users\/[^/]+/, "~").replace(/^\/jruck\//, "~/");
}
