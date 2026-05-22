import type { MachineIdentity } from "@/lib/local-apps/types";

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
  };
}

export interface SystemMachineResponse {
  app: "hilt-system";
  enabled: true;
  machine: MachineIdentity;
  features: {
    map: boolean;
    apps: boolean;
    stack: boolean;
  };
}

export interface SystemMachinesResponse {
  app: "hilt-system";
  enabled: true;
  machines: SystemMachine[];
}
