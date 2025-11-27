export default async function handler(_req: Request) {
  return new Response(
    JSON.stringify({ status: 'ok', message: 'pong', timestamp: new Date().toISOString() }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
