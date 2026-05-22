import type { LocalAppsEnabledResponse, LocalAppsResponse, Preview, Service, ServiceGroup } from "./types";

export function preserveLocalAppsPreviews<T extends LocalAppsResponse>(
  incoming: T,
  previous: LocalAppsResponse | null | undefined,
): T {
  if (!incoming.enabled || !previous?.enabled) return incoming;

  const mergedGroups = preserveGroupPreviews(incoming.groups, previous.groups);
  const previousMachines = new Map((previous.machines || []).map((machine) => [machine.id, machine]));
  const mergedMachines = incoming.machines?.map((machine) => {
    const previousMachine = previousMachines.get(machine.id);
    if (!previousMachine) return machine;
    return {
      ...machine,
      groups: preserveGroupPreviews(machine.groups, previousMachine.groups),
    };
  });

  return {
    ...incoming,
    groups: mergedGroups,
    machines: mergedMachines,
  } as T;
}

export function preserveEnabledResponsePreviews(
  incoming: LocalAppsEnabledResponse,
  previous: LocalAppsEnabledResponse | null | undefined,
): LocalAppsEnabledResponse {
  return preserveLocalAppsPreviews(incoming, previous);
}

function preserveGroupPreviews(incomingGroups: ServiceGroup[], previousGroups: ServiceGroup[]): ServiceGroup[] {
  const previousByKey = new Map<string, ServiceGroup>();
  for (const group of previousGroups) {
    for (const key of groupKeys(group)) previousByKey.set(key, group);
  }

  return incomingGroups.map((group) => {
    const previousGroup = groupKeys(group).map((key) => previousByKey.get(key)).find(Boolean);
    if (!previousGroup) return group;
    return {
      ...group,
      services: preserveServicePreviews(group, previousGroup),
    };
  });
}

function preserveServicePreviews(incomingGroup: ServiceGroup, previousGroup: ServiceGroup): Service[] {
  const previousByKey = new Map<string, Service>();
  for (const service of previousGroup.services) {
    for (const key of serviceKeys(previousGroup, service)) previousByKey.set(key, service);
  }

  return incomingGroup.services.map((service) => {
    if (service.preview?.path) return service;
    const previousService = serviceKeys(incomingGroup, service).map((key) => previousByKey.get(key)).find(Boolean);
    const previousPreview = previousService?.preview;
    if (!previousPreview?.path) return service;
    return {
      ...service,
      preview: mergePreview(previousPreview, service.preview),
    };
  });
}

function mergePreview(previous: Preview, incoming?: Preview | null): Preview {
  return {
    ...previous,
    error: incoming?.error ?? previous.error ?? null,
    error_at: incoming?.error_at ?? previous.error_at ?? null,
    stale: incoming?.stale ?? previous.stale,
  };
}

function groupKeys(group: ServiceGroup): string[] {
  return unique([
    `id:${group.id}`,
    `path:${group.path || ""}:${group.branch || ""}:${group.package_name || ""}`,
    `title:${group.title}:${group.path || ""}`,
  ]);
}

function serviceKeys(group: ServiceGroup, service: Service): string[] {
  return unique([
    `id:${service.id}`,
    `port:${group.id}:${service.listener.port}`,
    `port-path:${group.path || ""}:${service.listener.port}`,
    `url:${service.preview_url || service.health.url || ""}`,
  ].filter((key) => !key.endsWith(":")));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
