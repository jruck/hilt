/**
 * Minimal ambient types for js-yaml (already a dependency via gray-matter's engine; the
 * package ships no types and @types/js-yaml is not installed — house rule: no new deps).
 * Only the surface task-file.ts uses is declared.
 */
declare module "js-yaml" {
  export function dump(obj: unknown, options?: Record<string, unknown>): string;
  export function load(text: string, options?: Record<string, unknown>): unknown;
  const yaml: { dump: typeof dump; load: typeof load };
  export default yaml;
}
