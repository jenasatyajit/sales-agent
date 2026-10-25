/**
 * SmallWebRTC SDP proxy (FRONTEND.md F12).
 * POST → backend /api/offer?session_id=… (SDP offer/answer)
 * PATCH → backend /api/offer (trickle ICE, keyed by pc_id)
 * The backend origin stays server-only via BACKEND_ORIGIN.
 */

const BACKEND = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const passthrough = async (backendResponse: Response) =>
  new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "Content-Type": backendResponse.headers.get("content-type") ?? "application/json",
    },
  });

export async function POST(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ detail: "sessionId query param is required" }, { status: 400 });
  }
  try {
    const backendResponse = await fetch(
      `${BACKEND}/api/offer?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
        signal: AbortSignal.timeout(20_000),
      },
    );
    return passthrough(backendResponse);
  } catch {
    return Response.json({ detail: "Backend unreachable" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  try {
    const backendResponse = await fetch(`${BACKEND}/api/offer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      signal: AbortSignal.timeout(10_000),
    });
    return passthrough(backendResponse);
  } catch {
    return Response.json({ detail: "Backend unreachable" }, { status: 502 });
  }
}
