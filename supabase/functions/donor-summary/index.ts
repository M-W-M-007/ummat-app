// donor-summary — authenticated endpoint for the donor portal (/my).
//
// Called with the donor's own Supabase JWT (from signing in via donor-auth).
// Uses the service role to look up which donor this account is linked to
// (donor_accounts), then returns ONLY that donor's own donation history plus
// foundation-wide totals for transparency — never any other donor's identity
// or amounts individually.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

  const { data: link } = await admin.from("donor_accounts").select("donor_id").eq("user_id", userData.user.id).maybeSingle();
  if (!link) return json({ error: "This account is not linked to a donor." }, 403);

  const [{ data: myDonations }, { data: allDonations }, { data: allExpenses }] = await Promise.all([
    admin.from("donations").select("id,amount,date,purpose,mode,receipt_no").eq("donor_id", link.donor_id).order("date", { ascending: false }),
    admin.from("donations").select("amount,purpose"),
    admin.from("expenses").select("amount,category"),
  ]);

  const myTotal = (myDonations ?? []).reduce((s, d) => s + Number(d.amount), 0);
  const foundationCollected = (allDonations ?? []).reduce((s, d) => s + Number(d.amount), 0);
  const foundationSpent = (allExpenses ?? []).reduce((s, e) => s + Number(e.amount), 0);

  const purposeMap: Record<string, number> = {};
  (allDonations ?? []).forEach((d) => { purposeMap[d.purpose ?? "General"] = (purposeMap[d.purpose ?? "General"] ?? 0) + Number(d.amount); });
  const categoryMap: Record<string, number> = {};
  (allExpenses ?? []).forEach((e) => { categoryMap[e.category ?? "Misc"] = (categoryMap[e.category ?? "Misc"] ?? 0) + Number(e.amount); });

  return json({
    myDonations: myDonations ?? [],
    myTotal,
    foundationCollected,
    foundationSpent,
    purposeTotals: Object.entries(purposeMap).map(([p, v]) => ({ p, v })),
    categoryTotals: Object.entries(categoryMap).map(([p, v]) => ({ p, v })),
  });
});
