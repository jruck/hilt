/**
 * Explicit tombstone for the retired knowledge-graph API family.
 * Hilt's app-wide catch-all page would otherwise turn an absent API route into
 * an HTML 200, which is misleading to old clients and operational checks.
 */
function gone(): Response {
  return new Response(null, { status: 404 });
}

export const dynamic = "force-dynamic";
export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
