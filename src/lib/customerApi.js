import { supabase } from "./supabase";

const API_URL = (
  import.meta.env.VITE_PAYMENT_API_URL || "http://localhost:4242"
).replace(/\/+$/, "");

export async function customerApiRequest(path, options = {}) {
  if (!supabase) {
    throw new Error("HOKADA could not connect to Supabase.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Please sign in again before continuing.");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "The request failed.");
  }

  return data;
}
