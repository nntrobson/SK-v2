/** Public ShotTracker API origin (browser). Override with NEXT_PUBLIC_API_URL when not on localhost:8000. */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw && raw.trim()) return raw.replace(/\/$/, "");
  return "http://localhost:8000";
}
