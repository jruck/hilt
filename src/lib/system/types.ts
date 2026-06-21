import type { MachineIdentity } from "@/lib/local-apps/types";
import type { AppServerInfo } from "./app-server-info";

/**
 * Distinguishes a full Hilt server from a lightweight read-only System Agent
 * (see docs/plans/system-agent-mode.md). Additive: older peers omit it and are
 * treated as "full" by discovery.
 */
export type SystemMachineRole = "full" | "agent";

export interface SystemMachine {
  id: string;
  self: boolean;
  reachable: boolean;
  source_url?: string | null;
  machine: MachineIdentity;
  role?: SystemMachineRole;
  error?: string | null;
  features?: {
    map: boolean;
    apps: boolean;
    stack: boolean;
    sync: boolean;
  };
  app_server?: AppServerInfo | null;
}

export interface SystemMachineResponse {
  app: "hilt-system";
  enabled: true;
  role: SystemMachineRole;
  machine: MachineIdentity;
  features: {
    map: boolean;
    apps: boolean;
    stack: boolean;
    sync: boolean;
  };
  app_server?: AppServerInfo | null;
}

export interface SystemMachinesResponse {
  app: "hilt-system";
  enabled: true;
  machines: SystemMachine[];
}
