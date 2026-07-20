// create-order — public endpoint for the /donate page.
//
// Flow: validate input → basic per-IP rate limit → create a Razorpay order with
// the SECRET key (server-side only) → store a pending payment_orders row →
// return the order id + amount + publishable key_id to the client. The client
// then opens Razorpay Checkout; the donation itself is created only later by the
// razorpay-webhook after signature verification.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_PAISE = 10 * 100; //      ₹10
const MAX_PAISE = 500000 * 100; //  ₹5,00,000
const RATE_MAX = 8; //              orders per IP …
const RATE_WINDOW_SEC = 60; //      … per minute

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").replace(/\D/g, "").slice(-10);
  const email = String(body.email ?? "").trim();
  const purpose = String(body.purpose ?? "General").trim() || "General";
  const pan = String(body.pan ?? "").trim().toUpperCase();
  const rupees = Math.round(Number(body.amount));

  if (!name) return json({ error: "Please enter your name." }, 400);
  if (phone.length !== 10) return json({ error: "Please enter a valid 10-digit mobile number." }, 400);
  if (!Number.isFinite(rupees)) return json({ error: "Invalid amount." }, 400);
  const paise = rupees * 100;
  if (paise < MIN_PAISE || paise > MAX_PAISE) {
    return json({ error: "Amount must be between ₹10 and ₹5,00,000." }, 400);
  }

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return json({ error: "Payment gateway is not configured." }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Basic per-IP rate limit to deter abuse.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString();
  const { count } = await admin
    .from("payment_orders")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) {
    return json({ error: "Too many attempts — please wait a minute and try again." }, 429);
  }

  // Create the Razorpay order using the secret key (Basic auth).
  const auth = "Basic " + btoa(`${keyId}:${keySecret}`);
  const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: paise,
      currency: "INR",
      receipt: `uf_${Date.now()}`,
      notes: { name, phone, purpose, pan, email },
    }),
  });
  if (!rzpRes.ok) {
    return json({ error: "Could not start the payment. Please try again." }, 502);
  }
  const order = await rzpRes.json();

  const { error: insErr } = await admin.from("payment_orders").insert({
    razorpay_order_id: order.id,
    amount: rupees,
    name,
    phone,
    email,
    purpose,
    pan,
    ip,
    status: "created",
  });
  if (insErr) return json({ error: "Could not save the order." }, 500);

  return json({ order_id: order.id, amount: paise, currency: "INR", key_id: keyId });
});
