// donor-auth — public endpoint for the donor portal (/my).
//
// Donors sign in with phone + a self-chosen 6-digit PIN instead of SMS OTP
// (no per-message provider cost). Their Supabase Auth user is a synthetic
// account (email `d<donor_id>@donors.ummat.internal`, password = the PIN),
// tagged raw_user_meta_data.account_type = 'donor' so handle_new_user() does
// NOT give them a staff `profiles` row (see migration 0005).
//
// Actions:
//   resolve — {phone} -> {exists, email?}  (used before sign-in)
//   signup  — {phone, pin} -> {email}       (first-time donor; requires an
//             existing donors row for that phone — you can't create an
//             account for a number that has never donated)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DOMAIN = "donors.ummat.internal";
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const phone = digits(body.phone);
  if (phone.length !== 10) return json({ error: "Enter a valid 10-digit mobile number." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: donor } = await admin.from("donors").select("id").eq("phone", phone).maybeSingle();
  if (!donor) return json({ error: "No donations found for this number yet." }, 404);

  const email = `d${donor.id}@${DOMAIN}`;
  const { data: existing } = await admin.from("donor_accounts").select("user_id").eq("donor_id", donor.id).maybeSingle();

  if (body.action === "resolve") {
    return json({ exists: !!existing, email: existing ? email : undefined });
  }

  if (body.action === "signup") {
    if (existing) return json({ error: "An account already exists for this number — sign in instead." }, 409);
    const pin = String(body.pin ?? "");
    if (!/^\d{6}$/.test(pin)) return json({ error: "PIN must be exactly 6 digits." }, 400);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password: pin, email_confirm: true,
      user_metadata: { account_type: "donor", donor_id: donor.id, phone },
    });
    if (createErr) return json({ error: createErr.message }, 500);

    const { error: linkErr } = await admin.from("donor_accounts").insert({ user_id: created.user.id, donor_id: donor.id, phone });
    if (linkErr) return json({ error: linkErr.message }, 500);

    return json({ email });
  }

  return json({ error: "Unknown action." }, 400);
});
