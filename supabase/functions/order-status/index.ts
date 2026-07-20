// order-status — public, read-only lookup of a pending order's outcome.
//
// The /donate success screen calls this (polling) after Razorpay Checkout
// succeeds, to show the real receipt number. The donation itself is created by
// razorpay-webhook (the source of truth); this only reports what the webhook
// has recorded. Returns { status, receipt }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  let orderId = url.searchParams.get("order_id");
  if (!orderId && req.method === "POST") {
    try {
      orderId = (await req.json()).order_id;
    } catch { /* ignore */ }
  }
  if (!orderId) return json({ error: "missing order_id" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: order } = await admin
    .from("payment_orders")
    .select("status, donation_id")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();

  if (!order) return json({ status: "unknown", receipt: null });

  let receipt: string | null = null;
  if (order.donation_id) {
    const { data: don } = await admin
      .from("donations").select("receipt_no").eq("id", order.donation_id).maybeSingle();
    receipt = don?.receipt_no ?? null;
  }
  return json({ status: order.status, receipt });
});
