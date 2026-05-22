import { homedir } from "os";
import { discoverStack } from "@/lib/claude-config/discovery";
import { readConfigFile } from "@/lib/claude-config/parsers";
import type { ClaudeStack, ConfigFileContent } from "@/lib/claude-config/types";
import { getActiveFolder } from "@/lib/db";
import { discoverSystemMachines, fetchPeerJson, machineLabel } from "./peers";
import type { SystemMachine } from "./types";

export interface SystemStackSnapshot {
  machine: SystemMachine;
  stack: ClaudeStack | null;
  readOnly: boolean;
  projectPath: string | null;
  error: string | null;
}

export interface SystemStackResponse {
  app: "hilt-system-stack";
  enabled: true;
  machines: SystemStackSnapshot[];
}

export interface LocalSystemStackResponse {
  app: "hilt-system-stack";
  enabled: true;
  machine: SystemMachine;
  stack: ClaudeStack;
  readOnly: boolean;
  projectPath: string;
}

export async function readLocalSystemStack(projectPath?: string | null): Promise<LocalSystemStackResponse> {
  const machine = (await discoverSystemMachines({ includePeers: false }))[0];
  const resolvedProjectPath = projectPath || getActiveFolder() || homedir();
  return {
    app: "hilt-system-stack",
    enabled: true,
    machine,
    stack: await discoverStack(resolvedProjectPath),
    readOnly: false,
    projectPath: resolvedProjectPath,
  };
}

export async function readSystemStacks(projectPath?: string | null): Promise<SystemStackResponse> {
  const machines = await discoverSystemMachines();
  const snapshots = await Promise.all(machines.map(async (machine) => {
    try {
      if (machine.self) {
        const local = await readLocalSystemStack(projectPath);
        return {
          machine,
          stack: local.stack,
          readOnly: false,
          projectPath: local.projectPath,
          error: null,
        };
      }

      const remote = await readRemoteSystemStack(machine);
      return {
        machine,
        stack: remote.stack,
        readOnly: true,
        projectPath: remote.projectPath,
        error: null,
      };
    } catch (error) {
      return {
        machine,
        stack: null,
        readOnly: !machine.self,
        projectPath: null,
        error: `${machineLabel(machine.machine)}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }));

  return {
    app: "hilt-system-stack",
    enabled: true,
    machines: snapshots,
  };
}

export async function readLocalSystemStackFile(
  filePath: string,
  projectPath?: string | null,
  readOnly = true,
): Promise<ConfigFileContent | null> {
  const stack = await discoverStack(projectPath || getActiveFolder() || homedir());
  const allFiles = [
    ...stack.layers.system,
    ...stack.layers.user,
    ...stack.layers.project,
    ...stack.layers.local,
  ];
  const file = allFiles.find((candidate) => candidate.path === filePath);
  if (!file) return null;

  const content = await readConfigFile(file);
  return readOnly ? { ...content, isEditable: false } : content;
}

export async function readSystemStackFile(
  machineId: string,
  filePath: string,
  projectPath?: string | null,
): Promise<ConfigFileContent | null> {
  const machines = await discoverSystemMachines();
  const machine = machines.find((item) => item.id === machineId);
  if (!machine) return null;

  if (machine.self) {
    return readLocalSystemStackFile(filePath, projectPath, false);
  }

  const params = new URLSearchParams({
    scope: "local",
    path: filePath,
  });
  if (projectPath) params.set("project", projectPath);
  try {
    return await fetchPeerJson<{ file: ConfigFileContent }>(
      machine,
      `/api/system/stack/file?${params.toString()}`,
      { timeoutMs: 8_000 },
    ).then((response) => ({ ...response.file, isEditable: false }));
  } catch {
    const remote = await readRemoteLegacyStack(machine);
    const allFiles = [
      ...remote.stack.layers.system,
      ...remote.stack.layers.user,
      ...remote.stack.layers.project,
      ...remote.stack.layers.local,
    ];
    if (!allFiles.some((file) => file.path === filePath)) return null;
    const legacyParams = new URLSearchParams({
      path: filePath,
      scope: remote.projectPath,
    });
    return fetchPeerJson<{ file: ConfigFileContent }>(
      machine,
      `/api/claude-stack/file?${legacyParams.toString()}`,
      { timeoutMs: 8_000 },
    ).then((response) => ({ ...response.file, isEditable: false }));
  }
}

async function readRemoteSystemStack(machine: SystemMachine): Promise<LocalSystemStackResponse> {
  try {
    const response = await fetchPeerJson<Partial<LocalSystemStackResponse> | null>(
      machine,
      "/api/system/stack?scope=local",
      { timeoutMs: 8_000 },
    );
    if (response?.stack && response.projectPath) {
      return response as LocalSystemStackResponse;
    }
    throw new Error("Peer System Stack endpoint did not return a stack");
  } catch {
    return readRemoteLegacyStack(machine);
  }
}

async function readRemoteLegacyStack(machine: SystemMachine): Promise<LocalSystemStackResponse> {
  const folderData = await fetchPeerJson<{ workingFolder?: string | null; homeDir?: string }>(
    machine,
    "/api/folders",
    { timeoutMs: 8_000 },
  );
  const projectPath = folderData.workingFolder || folderData.homeDir || homedir();
  const params = new URLSearchParams({ scope: projectPath });
  const data = await fetchPeerJson<{ stack: ClaudeStack }>(
    machine,
    `/api/claude-stack?${params.toString()}`,
    { timeoutMs: 8_000 },
  );
  if (!data?.stack) throw new Error("Legacy Stack endpoint did not return a stack");

  return {
    app: "hilt-system-stack",
    enabled: true,
    machine,
    stack: data.stack,
    readOnly: true,
    projectPath,
  };
}
