import type { LocalAppsEnabledResponse, ServiceGroup } from "./types";

export function normalizeForParity(
  snapshot: { groups: ServiceGroup[] } | LocalAppsEnabledResponse,
  options: { includePreviews?: boolean } = {},
): ServiceGroup[] {
  const includePreviews = options.includePreviews ?? false;
  return snapshot.groups.map((group) => ({
    ...group,
    updated_at: "<timestamp>",
    services: group.services.map((service) => ({
      ...service,
      process: {
        ...service.process,
        start_time: service.process.start_time ? "<timestamp>" : service.process.start_time,
      },
      health: {
        ...service.health,
        checked_at: service.health.checked_at ? "<timestamp>" : service.health.checked_at,
        latency_ms: service.health.latency_ms == null ? service.health.latency_ms : 0,
      },
      preview: includePreviews && service.preview
        ? {
            ...service.preview,
            path: service.preview.path
              ? service.preview.path.replace(/.*\/([^/]+\.png)$/u, "<preview>/$1")
              : service.preview.path,
            captured_at: "<timestamp>",
            error_at: service.preview.error_at ? "<timestamp>" : service.preview.error_at,
          }
        : null,
    })),
  })).sort((a, b) => a.id.localeCompare(b.id));
}
