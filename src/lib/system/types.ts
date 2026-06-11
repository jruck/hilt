import type { MachineIdentity } from "@/lib/local-apps/types";
import type { AppServerInfo } from "./app-server-info";

export interface SystemMachine {
  id: string;
  self: boolean;
  reachable: boolean;
  source_url?: string | null;
  machine: MachineIdentity;
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
