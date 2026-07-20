import { useState, useEffect } from "react";
import { donorSupabase } from "./lib/donorSupabase.js";
import PieChart from "./PieChart.jsx";
import { C, S } from "./theme.js";

// Donor portal (/my): donors sign in with phone + a self-chosen 6-digit PIN
// (no SMS/OTP provider, so no per-message cost). They see ONLY their own
// donations plus foundation-wide totals — never other donors' identities.
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

async function callFn(path, opts) {
  const res = await fetch(`${FN}/${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

export default function DonorPage() {
  const [session, setSession] = useState(undefined); // undefined = checking
  const [summary, setSummary] = useState(null);
  const [stage, setStage] = useState("phone"); // phone | login | signup
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [donChart, setDonChart] = useState(false);
  const [expChart, setExpChart] = useState(false);

  useEffect(() => {
    if (!donorSupabase) { setSession(null); return; }
    donorSupabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = donorSupabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setSummary(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await callFn("donor-summary", { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const checkPhone = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await callFn("donor-auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", phone }),
      });
      if (r.exists) { setEmail(r.email); setStage("login"); }
      else setStage("signup");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const signIn = async () => {
    setErr(""); setBusy(true);
    try {
      const { error } = await donorSupabase.auth.signInWithPassword({ email, password: pin });
      if (error) throw new Error("Incorrect PIN. Please try again.");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const signUp = async () => {
    setErr("");
    if (!/^\d{6}$/.test(pin)) return setErr("PIN must be exactly 6 digits.");
    if (pin !== pin2) return setErr("PINs do not match.");
    setBusy(true);
    try {
      const r = await callFn("donor-auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signup", phone, pin }),
      });
      const { error } = await donorSupabase.auth.signInWithPassword({ email: r.email, password: pin });
      if (error) throw error;
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const wrap = { minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: C.ink, maxWidth: 480, margin: "0 auto", paddingBottom: 40 };
  const header = (
    <div style={{ background: C.greenDeep, color: "#fff", padding: "18px 18px 22px", borderRadius: "0 0 22px 22px", display: "flex", alignItems: "center", gap: 12 }}>
      <img src="/ummat-logo.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 44, height: 44, borderRadius: 10, objectFit: "contain", background: "#fff", padding: 4, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#BFD6CC", fontWeight: 700 }}>Ummat Foundation</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>My Donations</div>
      </div>
    </div>
  );

  if (session === undefined) return <div style={wrap}>{header}</div>;

  if (!session) {
    return (
      <div style={wrap}>
        {header}
        <div style={{ padding: 16 }}>
          {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#FBEAE6", color: C.red, fontSize: 13 }}>{err}</div>}

          {stage === "phone" && (
            <div style={S.card}>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>Enter the mobile number you donated with to see your giving history.</div>
              <label style={S.label}>Mobile number (10 digits)</label>
              <input style={S.input} inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="98XXXXXXXX" />
              <button disabled={busy || phone.length !== 10} onClick={checkPhone} style={{ ...S.btn, width: "100%", marginTop: 14, background: phone.length === 10 && !busy ? C.green : C.line, color: phone.length === 10 && !busy ? "#fff" : C.muted }}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          )}

          {stage === "login" && (
            <div style={S.card}>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 12 }}>Enter your 6-digit PIN for {phone}.</div>
              <label style={S.label}>PIN</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              <button disabled={busy || pin.length !== 6} onClick={signIn} style={{ ...S.btn, width: "100%", marginTop: 14, background: pin.length === 6 && !busy ? C.green : C.line, color: pin.length === 6 && !busy ? "#fff" : C.muted }}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <button onClick={() => { setStage("phone"); setPin(""); setErr(""); }} style={{ ...S.btn, width: "100%", marginTop: 8, background: "none", border: `1px solid ${C.line}`, color: C.muted }}>Use a different number</button>
            </div>
          )}

          {stage === "signup" && (
            <div style={S.card}>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>We found donations for {phone}. Create a 6-digit PIN to view them any time.</div>
              <label style={S.label}>Choose a PIN (6 digits)</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              <label style={{ ...S.label, marginTop: 10 }}>Confirm PIN</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
              <button disabled={busy || pin.length !== 6 || pin2.length !== 6} onClick={signUp} style={{ ...S.btn, width: "100%", marginTop: 14, background: pin.length === 6 && pin2.length === 6 && !busy ? C.green : C.line, color: pin.length === 6 && pin2.length === 6 && !busy ? "#fff" : C.muted }}>
                {busy ? "Creating…" : "Create PIN & continue"}
              </button>
              <button onClick={() => { setStage("phone"); setPin(""); setPin2(""); setErr(""); }} style={{ ...S.btn, width: "100%", marginTop: 8, background: "none", border: `1px solid ${C.line}`, color: C.muted }}>Use a different number</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!summary) return <div style={wrap}>{header}<div style={{ padding: 16, color: C.muted, fontSize: 14 }}>Loading your donations…</div></div>;

  return (
    <div style={wrap}>
      {header}
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button onClick={() => donorSupabase.auth.signOut()} style={{ border: "none", background: "none", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Sign out</button>
        </div>

        <div style={{ ...S.card, borderLeft: `4px solid ${C.gold}` }}>
          <div style={S.label}>Your total giving</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(summary.myTotal)}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <div style={S.card}>
            <div style={S.label}>Foundation collected</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(summary.foundationCollected)}</div>
          </div>
          <div style={S.card}>
            <div style={S.label}>Foundation spent</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.red, fontVariantNumeric: "tabular-nums" }}>{inr(summary.foundationSpent)}</div>
          </div>
        </div>

        {summary.purposeTotals.length > 0 && (
          <div style={{ ...S.card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ ...S.label, marginBottom: 0 }}>Collected by purpose</div>
              <button onClick={() => setDonChart(!donChart)} style={{ border: "none", background: "none", color: C.green, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{donChart ? "List" : "Chart"}</button>
            </div>
            <div style={{ marginTop: 10 }}>
              {donChart ? <PieChart data={summary.purposeTotals} /> : summary.purposeTotals.map(({ p, v }) => (
                <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px dashed ${C.line}`, fontSize: 14 }}>
                  <span>{p}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{inr(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.categoryTotals.length > 0 && (
          <div style={{ ...S.card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ ...S.label, marginBottom: 0 }}>Spent by category</div>
              <button onClick={() => setExpChart(!expChart)} style={{ border: "none", background: "none", color: C.green, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{expChart ? "List" : "Chart"}</button>
            </div>
            <div style={{ marginTop: 10 }}>
              {expChart ? <PieChart data={summary.categoryTotals} /> : summary.categoryTotals.map(({ p, v }) => (
                <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px dashed ${C.line}`, fontSize: 14 }}>
                  <span>{p}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{inr(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...S.card, marginTop: 12 }}>
          <div style={S.label}>Your donation history</div>
          {summary.myDonations.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "8px 0" }}>No donations recorded yet.</div>}
          {summary.myDonations.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px dashed ${C.line}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.receipt_no}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(d.date)} · {d.purpose} · {d.mode}</div>
              </div>
              <div style={{ fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(d.amount)}</div>
            </div>
          ))}
        </div>

        <a href="/donate" style={{ ...S.btn, display: "block", textAlign: "center", textDecoration: "none", width: "100%", boxSizing: "border-box", background: C.green, color: "#fff", marginTop: 14 }}>Donate again</a>
      </div>
    </div>
  );
}
