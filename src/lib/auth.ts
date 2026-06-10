import { NextRequest } from "next/server";

/**
 * Check API key on mutating routes.
 * If API_KEY env var is not set, auth is disabled (open for hackathon demo).
 * Set API_KEY in Vercel env vars to secure the instance post-hackathon.
 */
export function checkApiKey(req: NextRequest): boolean {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return true; // No key configured = open (demo mode)

  const provided =
    req.headers.get("x-api-key") ??
    req.nextUrl.searchParams.get("apiKey");
  return provided === apiKey;
}
