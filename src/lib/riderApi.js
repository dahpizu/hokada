import { riderSupabase } from "./supabase";

const RIDER_API_URL = (
  import.meta.env.VITE_PAYMENT_API_URL || "http://localhost:4242"
).replace(/\/+$/, "");

export async function riderApiRequest(path, options = {}) {
  if (!riderSupabase) {
    throw new Error("Rider authentication is not configured.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await riderSupabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Please sign in again before continuing.");
  }

  const response = await fetch(`${RIDER_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "The rider request failed.");
  }

  return data;
}
