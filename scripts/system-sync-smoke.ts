interface SystemSyncResponse {
  app?: string;
  enabled?: boolean;
  summary?: {
    machine_count?: number;
    healthy_count?: number;
    conflict_count?: number;
    needed_files?: number;
    pull_errors?: number;
  };
  machines?: Array<{
    enabled?: boolean;
    reason?: string;
    machine?: {
      id?: string;
      machine?: {
        hostname?: string;
        tailscale_dns?: string | null;
      };
    };
    daemon?: {
      reachable?: boolean;
      error?: string | null;
    };
    folder?: {
      state?: string;
      needFiles?: number;
      needDeletes?: number;
      pullErrors?: number;
      conflicts?: {
        count?: number;
      };
    } | null;
  }>;
}

const DEFAULT_URLS = [
  "http://mercury-v.tailc0acaa.ts.net:3000/api/system/sync?force=true",
];

async function main(): Promise<void> {
  const urls = syncSmokeUrls();
  const results = await Promise.all(urls.map(checkUrl));
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.url}: ${failure}`));

  for (const result of results) {
    const summary = result.response.summary;
    console.log([
      result.url,
      `machines=${summary?.machine_count ?? "?"}`,
      `healthy=${summary?.healthy_count ?? "?"}`,
      `needed=${summary?.needed_files ?? "?"}`,
      `pull_errors=${summary?.pull_errors ?? "?"}`,
      `conflicts=${summary?.conflict_count ?? "?"}`,
    ].join(" "));
  }

  if (failures.length > 0) {
    console.error("\nSystem sync smoke failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

async function checkUrl(url: string): Promise<{ url: string; response: SystemSyncResponse; failures: string[] }> {
  const failures: string[] = [];
  let response: Response;
  try {
    response = await fetchWithTimeout(url, 10_000);
  } catch (error) {
    return { url, response: {}, failures: [`request failed: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const data = await response.json().catch(() => null) as SystemSyncResponse | null;
  if (!response.ok) {
    return { url, response: data || {}, failures: [`HTTP ${response.status}`] };
  }
  if (!data) {
    return { url, response: {}, failures: ["response was not JSON"] };
  }

  if (data.app !== "hilt-system-sync") failures.push(`expected app=hilt-system-sync, got ${data.app || "missing"}`);
  if (data.enabled !== true) failures.push("sync response is not enabled");

  const summary = data.summary || {};
  const machineCount = summary.machine_count ?? 0;
  const healthyCount = summary.healthy_count ?? 0;
  if (machineCount < 2) failures.push(`expected at least 2 machines, got ${machineCount}`);
  if (healthyCount !== machineCount) failures.push(`expected all machines healthy, got ${healthyCount}/${machineCount}`);
  if ((summary.conflict_count ?? 0) !== 0) failures.push(`expected 0 conflicts, got ${summary.conflict_count}`);
  if ((summary.needed_files ?? 0) !== 0) failures.push(`expected 0 needed files, got ${summary.needed_files}`);
  if ((summary.pull_errors ?? 0) !== 0) failures.push(`expected 0 pull errors, got ${summary.pull_errors}`);

  for (const machine of data.machines || []) {
    const label = machineLabel(machine);
    if (!machine.enabled) {
      failures.push(`${label} disabled: ${machine.reason || "unknown reason"}`);
      continue;
    }
    if (machine.daemon?.reachable !== true) failures.push(`${label} daemon unreachable: ${machine.daemon?.error || "unknown error"}`);
    const folder = machine.folder;
    if (!folder) {
      failures.push(`${label} missing sync folder`);
      continue;
    }
    if ((folder.pullErrors ?? 0) !== 0) failures.push(`${label} pullErrors=${folder.pullErrors}`);
    if ((folder.needFiles ?? 0) !== 0 || (folder.needDeletes ?? 0) !== 0) {
      failures.push(`${label} needs files=${folder.needFiles ?? 0} deletes=${folder.needDeletes ?? 0}`);
    }
    if ((folder.conflicts?.count ?? 0) !== 0) failures.push(`${label} conflicts=${folder.conflicts?.count}`);
  }

  return { url, response: data, failures };
}

function syncSmokeUrls(): string[] {
  const fromEnv = process.env.HILT_SYNC_SMOKE_URLS
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const rawUrls = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  return rawUrls.length > 0 ? rawUrls : (fromEnv?.length ? fromEnv : DEFAULT_URLS);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function machineLabel(machine: NonNullable<SystemSyncResponse["machines"]>[number]): string {
  return (
    machine.machine?.machine?.tailscale_dns ||
    machine.machine?.machine?.hostname ||
    machine.machine?.id ||
    "unknown machine"
  );
}

void main();
