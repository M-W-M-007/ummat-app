// razorpay-webhook — the source of truth for online donations (UNIFIED LEDGER).
//
// Records EVERY captured payment on the Razorpay account into the ledger:
//   • our /donate flow  -> matched via payment_orders (full donor details)
//   • website (GiveWP) / QR / any other -> donor info read from the payment
//     itself (contact = phone, email, notes.name). Payments with no usable
//     phone are attached to a single "Online (unattributed)" donor so totals
//     stay complete; an admin can reconcile later.
//
// Signature is verified with RAZORPAY_WEBHOOK_SECRET. Duplicates are handled
// idempotently via the unique razorpay_payment_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const MODE_LABELS: Record<string, string> = { upi: "UPI", card: "Card", netbanking: "Netbanking", wallet: "Wallet", emi: "EMI" };
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const ANON_PHONE = "0000000000"; // sentinel donor for payments with no usable phone

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook not configured", { status: 500 });

  const raw = await req.text();
  const sigHeader = req.headers.get("x-razorpay-signature") ?? "";
  if (!timingSafeEqual(await hmacHex(secret, raw), sigHeader)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    return new Response("ignored", { status: 200 });
  }
  const payment = event.payload?.payment?.entity;
  if (!payment) return new Response("no payment entity", { status: 200 });

  const paymentId: string = payment.id;
  const orderId: string | undefined = payment.order_id;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Idempotency
  const { data: dup } = await admin.from("donations").select("id").eq("razorpay_payment_id", paymentId).maybeSingle();
  if (dup) return new Response("already processed", { status: 200 });

  // Our /donate order (if any) has authoritative donor details.
  const { data: order } = orderId
    ? await admin.from("payment_orders").select("*").eq("razorpay_order_id", orderId).maybeSingle()
    : { data: null };

  const notes = payment.notes ?? {};
  const phone = digits(order?.phone ?? notes.phone ?? notes.contact ?? payment.contact);
  const email = String(order?.email ?? notes.email ?? payment.email ?? "");
  const rawName = order?.name ?? notes.name ?? notes.donor_name ?? notes.Name ?? notes.full_name ??
    (email ? email.split("@")[0] : "") ?? "";
  const name = String(rawName || "Online Donor");
  const purpose = String(order?.purpose ?? notes.purpose ?? notes.give_form_title ?? "General");
  const pan = String(order?.pan ?? notes.pan ?? "");

  // Channel hint for the ledger note.
  const channel = order ? "app" : (notes.give_form_id || notes.give_form_title || notes.giveDonationId ? "website" : "QR/online");

  // Resolve donor: by phone, else the shared unattributed donor.
  const lookupPhone = phone.length === 10 ? phone : ANON_PHONE;
  let donorId: string | null = null;
  const { data: existing } = await admin.from("donors").select("id").eq("phone", lookupPhone).maybeSingle();
  if (existing) {
    donorId = existing.id;
  } else {
    const { data: created, error } = await admin.from("donors")
      .insert({ name: phone.length === 10 ? name : "Online (unattributed)", phone: lookupPhone, pan, city: "", lang: "en" })
      .select("id").single();
    if (error) {
      // race: another webhook created it — re-select
      const { data: retry } = await admin.from("donors").select("id").eq("phone", lookupPhone).maybeSingle();
      donorId = retry?.id ?? null;
    } else {
      donorId = created.id;
    }
  }
  if (!donorId) return new Response("could not resolve donor", { status: 500 });

  const mode = payment.method ? (MODE_LABELS[payment.method] ?? payment.method) : "Online";
  const istDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const noteParts = [`Online · ${channel}`, email || "", phone.length === 10 ? "" : "no phone on payment"].filter(Boolean);

  const { data: don, error: donErr } = await admin.from("donations").insert({
    donor_id: donorId,
    amount: Number(payment.amount ?? 0) / 100,
    date: istDate,
    mode,
    purpose,
    source: "online",
    razorpay_payment_id: paymentId,
    notes: noteParts.join(" · "),
  }).select("id,receipt_no").single();

  if (donErr) {
    if ((donErr as any).code === "23505") return new Response("already processed", { status: 200 });
    return new Response("insert failed: " + donErr.message, { status: 500 });
  }

  if (order) await admin.from("payment_orders").update({ status: "paid", donation_id: don.id }).eq("id", order.id);

  return new Response(JSON.stringify({ ok: true, receipt: don.receipt_no, channel }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
