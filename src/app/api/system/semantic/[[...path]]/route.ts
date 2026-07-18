/** Empty 404 tombstone for every retired semantic API path. */
function gone(): Response {
  return new Response(null, { status: 404 });
}

export const dynamic = "force-dynamic";
export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
