import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { supabase, supabaseConfigured } from "./lib/supabase.js";
import * as api from "./lib/api.js";
import { parseWorkbook, runImport } from "./lib/importer.js";
import { downloadReceipt } from "./lib/receipt.js";
import Login from "./Login.jsx";
import PieChart from "./PieChart.jsx";
import { C, S } from "./theme.js";

// ---------- constants ----------
const PURPOSES = ["Zakat", "Sadaqah", "General", "Education", "Medical", "Ration"];
const EXP_CATS = ["Ration kits", "Education", "Medical", "Rent", "Transport", "Salaries", "Misc"];
const MODES = ["Cash", "UPI", "Bank transfer", "Cheque"];
const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "ur", label: "اردو" },
];

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

// Set by App from settings.templates on each render; message builders prefer it
// and fall back to the hardcoded prototype copy below.
let RUNTIME_TPL = null;
const applyTpl = (tpl, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl);

function thanksMsg(lang, name, amount, date, receipt) {
  const tpl = RUNTIME_TPL?.thanks?.[lang];
  if (tpl) return applyTpl(tpl, { name, amount: inr(amount), date: fmtDate(date), receipt });
  if (lang === "hi")
    return `अस्सलामुअलैकुम ${name} जी, उम्मत फाउंडेशन आपके ${inr(amount)} के दान (${fmtDate(date)}) के लिए दिल से शुक्रगुज़ार है। रसीद नं: ${receipt}। जज़ाकल्लाह ख़ैर।`;
  if (lang === "ur")
    return `السلام علیکم ${name}، امت فاؤنڈیشن آپ کے عطیہ ${inr(amount)} (${fmtDate(date)}) کے لیے تہہ دل سے شکر گزار ہے۔ رسید نمبر: ${receipt}۔ جزاک اللہ خیر`;
  return `Assalamualaikum ${name}, Ummat Foundation gratefully acknowledges your donation of ${inr(amount)} on ${fmtDate(date)}. Receipt no: ${receipt}. JazakAllah Khair.`;
}
function reminderMsg(lang, name) {
  const tpl = RUNTIME_TPL?.reminder?.[lang];
  if (tpl) return applyTpl(tpl, { name });
  if (lang === "hi")
    return `अस्सलामुअलैकुम ${name} जी, उम्मत फाउंडेशन की ओर से एक विनम्र याद-दिहानी। आपके पिछले सहयोग से कई परिवारों को मदद मिली है। अगर आप दोबारा योगदान देना चाहें तो हम आभारी रहेंगे। जज़ाकल्लाह ख़ैर।`;
  if (lang === "ur")
    return `السلام علیکم ${name}، امت فاؤنڈیشن کی جانب سے ایک نرم یاد دہانی۔ آپ کے پچھلے تعاون سے کئی خاندانوں کی مدد ہوئی۔ اگر آپ دوبارہ تعاون کرنا چاہیں تو ہم شکر گزار ہوں گے۔ جزاک اللہ خیر`;
  return `Assalamualaikum ${name}, a gentle reminder from Ummat Foundation. Your past support has helped many families. If you wish to contribute again, we would be grateful. JazakAllah Khair.`;
}
const waLink = (phone, text) =>
  `https://wa.me/91${String(phone).replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(text)}`;

const FOUNDATION_PHONE = (import.meta.env.VITE_FOUNDATION_PHONE || "").replace(/\D/g, "").slice(-10);

// Text receipt sent to the donor's own WhatsApp (wa.me can't attach the PDF, so
// this is the receipt details in a message; the PDF can be downloaded and sent too).
function receiptMsg(org, donor, don) {
  return `*${org} — Donation Receipt*\n` +
    `Receipt No: ${don.receipt}\n` +
    `Donor: ${donor.name}\n` +
    `Amount: ${inr(don.amount)}\n` +
    `Date: ${fmtDate(don.date)}\n` +
    `Purpose: ${don.purpose}\n\n` +
    `JazakAllah Khair for your generous support.`;
}

// ---------- small ui bits ----------
function FullScreenMsg({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg, color: C.muted, fontFamily: "system-ui" }}>
      {children}
    </div>
  );
}

function ConfigNeeded() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", padding: 24 }}>
      <div style={{ ...S.card, maxWidth: 420 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Connect Supabase</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
          Create <code>.env.local</code> from <code>.env.example</code> and set{" "}
          <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> from your Supabase
          project (Project Settings → API), then restart the dev server.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}
function Chips({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={{
          padding: "7px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
          border: `1px solid ${value === o ? C.green : C.line}`,
          background: value === o ? C.green : "#FDFCF8",
          color: value === o ? "#fff" : C.ink,
        }}>{o}</button>
      ))}
    </div>
  );
}
function WaButtons({ phone, build }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {LANGS.map((l) => (
        <a key={l.code} href={waLink(phone, build(l.code))} target="_blank" rel="noreferrer" style={{
          flex: 1, textAlign: "center", textDecoration: "none", padding: "11px 8px", borderRadius: 12,
          background: "#0B5C43", color: "#fff", fontSize: 14, fontWeight: 700,
        }}>
          WhatsApp · {l.label}
        </a>
      ))}
    </div>
  );
}

// ---------- main ----------
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState(null); // {donors, donations, expenses, settings}
  const [tab, setTab] = useState("home");
  const [overlay, setOverlay] = useState(null);
  const [viewMonth, setViewMonth] = useState(today().slice(0, 7)); // "" = all time
  const [err, setErr] = useState("");
  const [donChart, setDonChart] = useState(false);
  const [expChart, setExpChart] = useState(false);

  const flashErr = (e) => {
    const m = typeof e === "string" ? e : e?.message || "Something went wrong. Please try again.";
    setErr(m);
    setTimeout(() => setErr(""), 5000);
  };

  // Track the auth session.
  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  // When signed in, load the profile (role) and the ledger.
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: prof, error: pErr } = await supabase
          .from("profiles").select("*").eq("id", session.user.id).single();
        if (pErr) throw pErr;
        const all = await api.loadAll();
        if (!cancelled) {
          setProfile(prof);
          setData(all);
        }
      } catch (e) {
        if (!cancelled) flashErr(e);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const reload = async () => {
    try {
      setData(await api.loadAll());
    } catch (e) {
      flashErr(e);
    }
  };

  // ---- gate screens ----
  if (!supabaseConfigured) return <ConfigNeeded />;
  if (session === undefined) return <FullScreenMsg>Connecting…</FullScreenMsg>;
  if (!session) return <Login />;
  if (!data || !profile) return <FullScreenMsg>Opening the ledger…</FullScreenMsg>;

  const isAdmin = profile.role === "admin";
  const { donors, donations, expenses } = data;
  // Settings-driven lists + copy (fall back to the built-in defaults).
  const purposes = data.settings?.purposes?.length ? data.settings.purposes : PURPOSES;
  const cats = data.settings?.categories?.length ? data.settings.categories : EXP_CATS;
  const modes = data.settings?.modes?.length ? data.settings.modes : MODES;
  const orgName = data.settings?.org?.name || "Ummat Foundation";
  RUNTIME_TPL = data.settings?.templates || null;
  const donorById = Object.fromEntries(donors.map((d) => [d.id, d]));
  const totalIn = donations.reduce((s, d) => s + Number(d.amount), 0);
  const totalOut = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const inPeriod = (r) => !viewMonth || r.date.startsWith(viewMonth);
  const monthIn = donations.filter(inPeriod).reduce((s, d) => s + Number(d.amount), 0);
  const monthOut = expenses.filter(inPeriod).reduce((s, e) => s + Number(e.amount), 0);
  const isCurrent = viewMonth === today().slice(0, 7);
  const periodLabel = !viewMonth ? "All time" : isCurrent ? "This month" : new Date(viewMonth + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" });

  const lastGiven = {};
  donations.forEach((d) => {
    if (!lastGiven[d.donorId] || d.date > lastGiven[d.donorId]) lastGiven[d.donorId] = d.date;
  });
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const lapsed = donors.filter((d) => lastGiven[d.id] && lastGiven[d.id] < cutoff);

  // ---- mutations (via API + reload) ----
  const addDonation = async (form) => {
    try {
      const { donation, donor } = await api.addDonation(form);
      await reload();
      setOverlay({ type: "thanks", don: donation, donor, saved: true });
    } catch (e) {
      flashErr(e);
    }
  };
  const addExpense = async (form) => {
    try {
      await api.addExpense(form);
      await reload();
      setOverlay(null);
      setTab("expenses");
    } catch (e) {
      flashErr(e);
    }
  };
  const updateDonation = async (form, id) => {
    try {
      await api.updateDonation(id, form);
      await reload();
      setOverlay(null);
    } catch (e) {
      flashErr(e);
    }
  };
  const deleteDonation = async (id) => {
    try {
      await api.deleteDonation(id);
      await reload();
      setOverlay(null);
    } catch (e) {
      flashErr(e);
    }
  };
  const updateExpense = async (form, id) => {
    try {
      await api.updateExpense(id, form);
      await reload();
      setOverlay(null);
    } catch (e) {
      flashErr(e);
    }
  };
  const deleteExpense = async (id) => {
    try {
      await api.deleteExpense(id);
      await reload();
      setOverlay(null);
    } catch (e) {
      flashErr(e);
    }
  };

  const exportExcel = () => {
    const dRows = donations.filter(inPeriod).map((d) => ({
      Receipt: d.receipt, Date: d.date, Donor: donorById[d.donorId]?.name || "", Phone: donorById[d.donorId]?.phone || "",
      "Amount (INR)": Number(d.amount), Purpose: d.purpose, Mode: d.mode, PAN: donorById[d.donorId]?.pan || "", Notes: d.notes || "",
    }));
    const eRows = expenses.filter(inPeriod).map((e) => ({
      Date: e.date, Category: e.category, "Paid to": e.paidTo || "", "Amount (INR)": Number(e.amount), Mode: e.mode, Notes: e.notes || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dRows.length ? dRows : [{ Info: "No donations in this period" }]), "Donations");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eRows.length ? eRows : [{ Info: "No expenses in this period" }]), "Expenses");
    XLSX.writeFile(wb, `UmmatFoundation-${viewMonth || "all-time"}.xlsx`);
  };

  const purposeTotals = purposes.map((p) => ({ p, v: donations.filter((d) => d.purpose === p && inPeriod(d)).reduce((s, d) => s + Number(d.amount), 0) })).filter((x) => x.v > 0);
  const catTotals = cats.map((c) => ({ p: c, v: expenses.filter((e) => e.category === c && inPeriod(e)).reduce((s, e) => s + Number(e.amount), 0) })).filter((x) => x.v > 0);

  const recent = [
    ...donations.filter(inPeriod).map((d) => ({ ...d, kind: "in" })),
    ...expenses.filter(inPeriod).map((e) => ({ ...e, kind: "out" })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, viewMonth ? 30 : 8);

  const pct = totalIn > 0 ? Math.min(100, Math.round((totalOut / totalIn) * 100)) : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: C.ink, maxWidth: 480, margin: "0 auto", paddingBottom: 84 }}>
      {/* header */}
      <div style={{ background: C.greenDeep, color: "#fff", padding: "14px 18px 20px", borderRadius: "0 0 22px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 12, color: "#BFD6CC" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(profile.name || session.user.email)} · <b style={{ color: "#fff" }}>{isAdmin ? "Admin" : "Volunteer"}</b>
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 10 }}>
            {isAdmin && (
              <button onClick={() => setOverlay({ type: "settings" })} style={{ background: "none", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Settings
              </button>
            )}
            <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Sign out
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/ummat-logo.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 44, height: 44, borderRadius: 10, objectFit: "contain", background: "#fff", padding: 4, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#BFD6CC", fontWeight: 700 }}>{orgName}</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>Donation Ledger</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#BFD6CC" }}>Balance</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.gold }}>{inr(totalIn - totalOut)}</div>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
          <span>Collected <b>{inr(totalIn)}</b></span>
          <span>Spent <b>{inr(totalOut)}</b></span>
        </div>
        <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.18)" }}>
          <div style={{ width: pct + "%", height: 6, borderRadius: 3, background: C.gold }} />
        </div>
      </div>

      {err && <div style={{ margin: 12, padding: 10, borderRadius: 10, background: "#FBEAE6", color: C.red, fontSize: 13 }}>{err}</div>}

      <div style={{ padding: 14 }}>
        {tab === "home" && (
          <>
            <div style={{ ...S.card, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ ...S.label, marginBottom: 0, flexShrink: 0 }}>Viewing</div>
              <input type="month" value={viewMonth} max={today().slice(0, 7)} onChange={(e) => setViewMonth(e.target.value)} style={{ ...S.input, padding: "8px 10px", flex: 1, minWidth: 0 }} />
              <button onClick={() => setViewMonth(viewMonth ? "" : today().slice(0, 7))} style={{ padding: "8px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0, border: `1px solid ${!viewMonth ? C.green : C.line}`, background: !viewMonth ? C.green : "#FDFCF8", color: !viewMonth ? "#fff" : C.ink }}>All time</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={S.card}>
                <div style={S.label}>{periodLabel} · in</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(monthIn)}</div>
              </div>
              <div style={S.card}>
                <div style={S.label}>{periodLabel} · out</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.red, fontVariantNumeric: "tabular-nums" }}>{inr(monthOut)}</div>
              </div>
            </div>
            <button onClick={exportExcel} style={{ ...S.btn, width: "100%", marginTop: 10, background: "none", border: `1px solid ${C.green}`, color: C.green }}>
              Export {periodLabel} → Excel
            </button>
            {isAdmin && (
              <button onClick={() => setOverlay({ type: "import" })} style={{ ...S.btn, width: "100%", marginTop: 8, background: "none", border: `1px dashed ${C.line}`, color: C.muted, fontWeight: 600 }}>
                Import prototype data (one-time)
              </button>
            )}

            {purposeTotals.length > 0 && (
              <div style={{ ...S.card, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...S.label, marginBottom: 0 }}>Collected by purpose · {periodLabel}</div>
                  <button onClick={() => setDonChart(!donChart)} style={{ border: "none", background: "none", color: C.green, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    {donChart ? "List" : "Chart"}
                  </button>
                </div>
                <div style={{ marginTop: 10 }}>
                  {donChart ? <PieChart data={purposeTotals} /> : purposeTotals.map(({ p, v }) => (
                    <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px dashed ${C.line}`, fontSize: 14 }}>
                      <span style={{ fontWeight: p === "Zakat" ? 800 : 500 }}>{p}{p === "Zakat" ? " ◆" : ""}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{inr(v)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>◆ Zakat is tracked separately — spend only on Zakat-eligible purposes.</div>
              </div>
            )}

            {catTotals.length > 0 && (
              <div style={{ ...S.card, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...S.label, marginBottom: 0 }}>Spent by category · {periodLabel}</div>
                  <button onClick={() => setExpChart(!expChart)} style={{ border: "none", background: "none", color: C.green, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    {expChart ? "List" : "Chart"}
                  </button>
                </div>
                <div style={{ marginTop: 10 }}>
                  {expChart ? <PieChart data={catTotals} /> : catTotals.map(({ p, v }) => (
                    <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px dashed ${C.line}`, fontSize: 14 }}>
                      <span style={{ fontWeight: 500 }}>{p}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{inr(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ ...S.card, marginTop: 12 }}>
              <div style={S.label}>{viewMonth ? "Activity · " + periodLabel : "Recent activity"}</div>
              {recent.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "10px 0" }}>{donations.length + expenses.length === 0 ? "Nothing yet. Add your first donation with the + Donation button below." : "No records in " + periodLabel + "."}</div>}
              {recent.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px dashed ${C.line}` }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{r.kind === "in" ? (donorById[r.donorId]?.name || "Donor") : r.category}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(r.date)} · {r.kind === "in" ? r.purpose : (r.paidTo || r.mode)}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.kind === "in" ? C.green : C.red }}>
                    {r.kind === "in" ? "+" : "−"}{inr(r.amount)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "donations" && (
          <ListDonations donations={donations} donorById={donorById} onOpen={(don, donor) => setOverlay({ type: "thanks", don, donor })} />
        )}

        {tab === "expenses" && (
          <div style={S.card}>
            <div style={S.label}>All expenses</div>
            {expenses.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "10px 0" }}>No expenses recorded yet.</div>}
            {expenses.map((e) => (
              <button key={e.id} onClick={() => setOverlay({ type: "expense", initial: e })} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px dashed ${C.line}` }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{e.category}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(e.date)} · {e.paidTo || e.mode}{e.notes ? " · " + e.notes : ""}</div>
                </div>
                <div style={{ fontWeight: 800, color: C.red, fontVariantNumeric: "tabular-nums" }}>−{inr(e.amount)}</div>
              </button>
            ))}
          </div>
        )}

        {tab === "donors" && (
          <Donors donors={donors} donations={donations} lastGiven={lastGiven} lapsed={lapsed} onOpen={(donor) => setOverlay({ type: "donor-detail", donor })} />
        )}
      </div>

      {/* bottom nav with centre + */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", background: C.surface, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "6px 4px calc(6px + env(safe-area-inset-bottom))" }}>
        {[
          ["home", "Home"],
          ["donations", "Donations"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: "none", border: "none", padding: "8px 0", cursor: "pointer", fontSize: 12, fontWeight: tab === k ? 800 : 500, color: tab === k ? C.green : C.muted, borderTop: tab === k ? `2px solid ${C.gold}` : "2px solid transparent" }}>
            {label}
          </button>
        ))}
        <button onClick={() => setOverlay({ type: "add-menu" })} aria-label="Add record" style={{ width: 54, height: 54, borderRadius: 27, border: "none", background: C.green, color: "#fff", fontSize: 28, fontWeight: 700, cursor: "pointer", margin: "0 6px", marginTop: -24, boxShadow: "0 4px 12px rgba(11,92,67,0.35)", flexShrink: 0, lineHeight: 1 }}>+</button>
        {[
          ["expenses", "Expenses"],
          ["donors", "Donors"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: "none", border: "none", padding: "8px 0", cursor: "pointer", fontSize: 12, fontWeight: tab === k ? 800 : 500, color: tab === k ? C.green : C.muted, borderTop: tab === k ? `2px solid ${C.gold}` : "2px solid transparent" }}>
            {label}
          </button>
        ))}
      </div>

      {overlay?.type === "add-menu" && (
        <Overlay title="Add record" onClose={() => setOverlay(null)}>
          <button onClick={() => setOverlay({ type: "donation" })} style={{ ...S.btn, width: "100%", background: C.green, color: "#fff", marginBottom: 10 }}>+ New donation</button>
          <button onClick={() => setOverlay({ type: "expense" })} style={{ ...S.btn, width: "100%", background: C.red, color: "#fff" }}>+ New expense</button>
        </Overlay>
      )}
      {overlay?.type === "donation" && (
        <DonationForm donors={donors} initial={overlay.initial} purposes={purposes} modes={modes} onCancel={() => setOverlay(null)}
          onSave={(f) => (overlay.initial ? updateDonation(f, overlay.initial.id) : addDonation(f))}
          onDelete={overlay.initial && isAdmin ? () => deleteDonation(overlay.initial.id) : null} />
      )}
      {overlay?.type === "expense" && (
        <ExpenseForm initial={overlay.initial} cats={cats} modes={modes} onCancel={() => setOverlay(null)}
          onSave={(f) => (overlay.initial ? updateExpense(f, overlay.initial.id) : addExpense(f))}
          onDelete={overlay.initial && isAdmin ? () => deleteExpense(overlay.initial.id) : null} />
      )}
      {overlay?.type === "thanks" && (
        <ThanksSheet don={overlay.don} donor={overlay.donor} saved={overlay.saved} orgName={orgName} onClose={() => setOverlay(null)}
          onEdit={() => setOverlay({ type: "donation", initial: overlay.don })} />
      )}
      {overlay?.type === "settings" && (
        <Settings settings={data.settings} onClose={() => setOverlay(null)} onSaved={reload} onErr={flashErr} />
      )}
      {overlay?.type === "donor-detail" && (
        <DonorDetail donor={overlay.donor} donations={donations.filter((d) => d.donorId === overlay.donor.id)} onClose={() => setOverlay(null)} />
      )}
      {overlay?.type === "import" && (
        <ImportSheet onClose={() => setOverlay(null)} onImported={reload} />
      )}
    </div>
  );
}

// ---------- screens ----------
function Overlay({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,30,25,0.45)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", borderRadius: "20px 20px 0 0", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: C.muted }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DonationForm({ donors, onCancel, onSave, initial, onDelete, purposes = PURPOSES, modes = MODES }) {
  const [f, setF] = useState(
    initial
      ? { donorId: initial.donorId, name: "", phone: "", city: "", pan: "", amount: String(initial.amount), date: initial.date, mode: initial.mode, purpose: initial.purpose, notes: initial.notes || "" }
      : { donorId: "", name: "", phone: "", city: "", pan: "", amount: "", date: today(), mode: "UPI", purpose: "General", notes: "" }
  );
  const [q, setQ] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const matches = q.length >= 2 ? donors.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q)) : [];
  const picked = donors.find((d) => d.id === f.donorId);
  const valid = f.amount > 0 && (f.donorId || (f.name.trim() && /^\d{10}$/.test(f.phone)));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(f);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay title={initial ? "Edit donation " + initial.receipt : "New donation"} onClose={onCancel}>
      {!picked ? (
        <>
          <Field label="Search existing donor (name / phone)">
            <input style={S.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" />
          </Field>
          {matches.map((d) => (
            <button key={d.id} onClick={() => setF({ ...f, donorId: d.id })} style={{ ...S.card, width: "100%", textAlign: "left", marginBottom: 8, cursor: "pointer" }}>
              <b>{d.name}</b> <span style={{ color: C.muted, fontSize: 13 }}>· {d.phone}</span>
            </button>
          ))}
          <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 10px" }}>— or add a new donor —</div>
          <Field label="Donor name *"><input style={S.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Mobile (10 digits) *"><input style={S.input} inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} placeholder="98XXXXXXXX" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="City"><input style={S.input} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="PAN (optional)"><input style={S.input} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} /></Field>
          </div>
        </>
      ) : (
        <div style={{ ...S.card, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><b>{picked.name}</b> <span style={{ color: C.muted, fontSize: 13 }}>· {picked.phone}</span></div>
          <button onClick={() => setF({ ...f, donorId: "" })} style={{ border: "none", background: "none", color: C.red, fontWeight: 700, cursor: "pointer" }}>Change</button>
        </div>
      )}

      <Field label="Amount (₹) *"><input style={S.input} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} placeholder="0" /></Field>
      <Field label="Date"><input type="date" style={S.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Payment mode"><Chips options={modes} value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label="Purpose"><Chips options={purposes} value={f.purpose} onChange={(v) => setF({ ...f, purpose: v })} /></Field>
      <Field label="Notes"><input style={S.input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>

      <button disabled={!valid || saving} onClick={save} style={{ ...S.btn, width: "100%", background: valid && !saving ? C.green : C.line, color: valid && !saving ? "#fff" : C.muted, marginTop: 4 }}>
        {saving ? "Saving…" : initial ? "Save changes" : "Save donation"}
      </button>
      {onDelete && (
        <button onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))} style={{ ...S.btn, width: "100%", background: confirmDel ? C.red : "none", border: `1px solid ${C.red}`, color: confirmDel ? "#fff" : C.red, marginTop: 10 }}>
          {confirmDel ? "Tap again to confirm delete" : "Delete this donation"}
        </button>
      )}
    </Overlay>
  );
}

function ExpenseForm({ onCancel, onSave, initial, onDelete, cats = EXP_CATS, modes = MODES }) {
  const [f, setF] = useState(
    initial
      ? { amount: String(initial.amount), date: initial.date, category: initial.category, paidTo: initial.paidTo || "", mode: initial.mode, notes: initial.notes || "" }
      : { amount: "", date: today(), category: "Ration kits", paidTo: "", mode: "Cash", notes: "" }
  );
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = f.amount > 0;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(f);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay title={initial ? "Edit expense" : "New expense"} onClose={onCancel}>
      <Field label="Amount (₹) *"><input style={S.input} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} placeholder="0" /></Field>
      <Field label="Date"><input type="date" style={S.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Category"><Chips options={cats} value={f.category} onChange={(v) => setF({ ...f, category: v })} /></Field>
      <Field label="Paid to"><input style={S.input} value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} placeholder="Shop / person / vendor" /></Field>
      <Field label="Payment mode"><Chips options={modes} value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label="Notes"><input style={S.input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button disabled={!valid || saving} onClick={save} style={{ ...S.btn, width: "100%", background: valid && !saving ? C.red : C.line, color: valid && !saving ? "#fff" : C.muted, marginTop: 4 }}>
        {saving ? "Saving…" : initial ? "Save changes" : "Save expense"}
      </button>
      {onDelete && (
        <button onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))} style={{ ...S.btn, width: "100%", background: confirmDel ? C.red : "none", border: `1px solid ${C.red}`, color: confirmDel ? "#fff" : C.red, marginTop: 10 }}>
          {confirmDel ? "Tap again to confirm delete" : "Delete this expense"}
        </button>
      )}
    </Overlay>
  );
}

function ThanksSheet({ don, donor, onClose, onEdit, saved, orgName }) {
  return (
    <Overlay title={saved ? "Donation saved ✓" : "Donation " + don.receipt} onClose={onClose}>
      <div style={{ ...S.card, borderLeft: `4px solid ${C.gold}`, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>Receipt {don.receipt}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.green, margin: "4px 0", fontVariantNumeric: "tabular-nums" }}>{inr(don.amount)}</div>
        <div style={{ fontSize: 14 }}>{donor.name} · {donor.phone}</div>
        <div style={{ fontSize: 13, color: C.muted }}>{fmtDate(don.date)} · {don.purpose} · {don.mode}</div>
      </div>
      <div style={{ ...S.label, marginBottom: 8 }}>Send thanks on WhatsApp</div>
      <WaButtons phone={donor.phone} build={(lang) => thanksMsg(lang, donor.name, don.amount, don.date, don.receipt)} />
      <a href={waLink(donor.phone, receiptMsg(orgName, donor, don))} target="_blank" rel="noreferrer" style={{ ...S.btn, display: "block", textAlign: "center", textDecoration: "none", width: "100%", boxSizing: "border-box", background: C.green, color: "#fff", marginTop: 10 }}>
        Send receipt to {donor.phone} on WhatsApp
      </a>
      <button onClick={() => downloadReceipt({ donation: don, donor, orgName, orgPhone: FOUNDATION_PHONE })} style={{ ...S.btn, width: "100%", background: "none", border: `1px solid ${C.gold}`, color: C.gold, marginTop: 8 }}>Download receipt (PDF)</button>
      <button onClick={onEdit} style={{ ...S.btn, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.ink, marginTop: 8 }}>Edit / Delete this donation</button>
      <button onClick={onClose} style={{ ...S.btn, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.muted, marginTop: 8 }}>Done</button>
    </Overlay>
  );
}

function ImportSheet({ onClose, onImported }) {
  const [parsed, setParsed] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(""); setResult(null); setParsed(null); setWarnings([]);
    try {
      const buf = await file.arrayBuffer();
      const p = parseWorkbook(buf);
      setParsed(p);
      setWarnings(p.warnings);
    } catch (e2) {
      setErr(e2.message || "Could not read this file.");
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true); setErr("");
    try {
      const r = await runImport(parsed);
      setResult(r);
      await onImported();
    } catch (e2) {
      setErr(e2.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay title="Import prototype data" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Upload the Excel file exported from the old prototype (with <b>Donations</b> and <b>Expenses</b> sheets). Original receipt numbers are kept, donors are matched or created by phone, and re-importing the same file is safe — existing receipts are skipped.
      </div>
      <input type="file" accept=".xlsx,.xls" onChange={onFile} style={{ ...S.input, padding: 10 }} />

      {err && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#FBEAE6", color: C.red, fontSize: 13 }}>{err}</div>}

      {parsed && !result && (
        <>
          <div style={{ ...S.card, marginTop: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Ready to import</div>
            <div style={{ fontSize: 14, marginTop: 6, color: C.ink }}>{parsed.donations.length} donations · {parsed.expenses.length} expenses</div>
            {warnings.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>
                {warnings.length} warning{warnings.length > 1 ? "s" : ""}:
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                  {warnings.length > 5 && <li>…and {warnings.length - 5} more</li>}
                </ul>
              </div>
            )}
          </div>
          <button disabled={busy || (parsed.donations.length + parsed.expenses.length === 0)} onClick={doImport} style={{ ...S.btn, width: "100%", marginTop: 12, background: busy ? C.line : C.green, color: busy ? C.muted : "#fff" }}>
            {busy ? "Importing…" : `Import ${parsed.donations.length + parsed.expenses.length} record${parsed.donations.length + parsed.expenses.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {result && (
        <div style={{ ...S.card, marginTop: 12, borderLeft: `4px solid ${C.green}` }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.green }}>Import complete ✓</div>
          <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
            {result.donationsImported} donation{result.donationsImported === 1 ? "" : "s"} imported{result.donationsSkipped ? ` · ${result.donationsSkipped} skipped (already present)` : ""}<br />
            {result.donorsCreated} new donor{result.donorsCreated === 1 ? "" : "s"} created<br />
            {result.expensesImported} expense{result.expensesImported === 1 ? "" : "s"} imported{result.expensesSkipped ? ` · ${result.expensesSkipped} skipped (already present)` : ""}
          </div>
          <button onClick={onClose} style={{ ...S.btn, width: "100%", marginTop: 12, background: C.green, color: "#fff" }}>Done</button>
        </div>
      )}
    </Overlay>
  );
}

function Settings({ settings, onClose, onSaved, onErr }) {
  const [orgName, setOrgName] = useState(settings?.org?.name || "Ummat Foundation");
  const [purposesText, setPurposesText] = useState((settings?.purposes?.length ? settings.purposes : PURPOSES).join("\n"));
  const [catsText, setCatsText] = useState((settings?.categories?.length ? settings.categories : EXP_CATS).join("\n"));
  const [tpl, setTpl] = useState(() => (settings?.templates ? JSON.parse(JSON.stringify(settings.templates)) : { thanks: {}, reminder: {} }));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const ta = { ...S.input, minHeight: 60, fontFamily: "inherit", resize: "vertical" };

  const setTplField = (kind, lang, val) => setTpl((t) => ({ ...t, [kind]: { ...(t[kind] || {}), [lang]: val } }));

  const save = async () => {
    setSaving(true); setSavedMsg("");
    try {
      const rows = [
        { key: "org", value: { ...(settings?.org || {}), name: orgName.trim() || "Ummat Foundation" } },
        { key: "purposes", value: purposesText.split("\n").map((s) => s.trim()).filter(Boolean) },
        { key: "categories", value: catsText.split("\n").map((s) => s.trim()).filter(Boolean) },
        { key: "templates", value: tpl },
      ];
      const { error } = await supabase.from("settings").upsert(rows);
      if (error) throw error;
      setSavedMsg("Saved ✓");
      await onSaved();
    } catch (e) { onErr(e); } finally { setSaving(false); }
  };

  const invite = async () => {
    setInviting(true); setInviteMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("invite-volunteer", { body: { email: inviteEmail.trim(), name: inviteName.trim() } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setInviteMsg(`Invite sent to ${inviteEmail.trim()} ✓`);
      setInviteEmail(""); setInviteName("");
    } catch (e) { setInviteMsg(e.message || "Could not send invite."); } finally { setInviting(false); }
  };

  return (
    <Overlay title="Settings" onClose={onClose}>
      <Field label="Organisation name"><input style={S.input} value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field>

      <Field label="Purposes (one per line)"><textarea style={{ ...ta, minHeight: 92 }} value={purposesText} onChange={(e) => setPurposesText(e.target.value)} /></Field>
      <Field label="Expense categories (one per line)"><textarea style={{ ...ta, minHeight: 92 }} value={catsText} onChange={(e) => setCatsText(e.target.value)} /></Field>

      <div style={{ ...S.label, marginBottom: 6 }}>WhatsApp templates · {"{name} {amount} {date} {receipt}"}</div>
      {["thanks", "reminder"].map((kind) => (
        <div key={kind} style={{ ...S.card, marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 13, textTransform: "capitalize", marginBottom: 6 }}>{kind}</div>
          {LANGS.map((l) => (
            <div key={l.code} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{l.label}</div>
              <textarea style={ta} value={tpl?.[kind]?.[l.code] || ""} onChange={(e) => setTplField(kind, l.code, e.target.value)} />
            </div>
          ))}
        </div>
      ))}

      <button disabled={saving} onClick={save} style={{ ...S.btn, width: "100%", background: saving ? C.line : C.green, color: saving ? C.muted : "#fff" }}>{saving ? "Saving…" : "Save settings"}</button>
      {savedMsg && <div style={{ textAlign: "center", color: C.green, fontSize: 13, marginTop: 6 }}>{savedMsg}</div>}

      <div style={{ ...S.label, marginTop: 18, marginBottom: 6 }}>Invite a volunteer</div>
      <div style={S.card}>
        <Field label="Name"><input style={S.input} value={inviteName} onChange={(e) => setInviteName(e.target.value)} /></Field>
        <Field label="Email"><input style={S.input} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="volunteer@example.com" /></Field>
        <button disabled={inviting || !inviteEmail} onClick={invite} style={{ ...S.btn, width: "100%", background: inviting || !inviteEmail ? C.line : C.green, color: inviting || !inviteEmail ? C.muted : "#fff" }}>{inviting ? "Sending…" : "Send invite"}</button>
        {inviteMsg && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{inviteMsg}</div>}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>They get an email to set a password and join as a volunteer.</div>
      </div>
    </Overlay>
  );
}

function ListDonations({ donations, donorById, onOpen }) {
  return (
    <div style={S.card}>
      <div style={S.label}>All donations</div>
      {donations.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "10px 0" }}>No donations yet.</div>}
      {donations.map((d) => {
        const donor = donorById[d.donorId];
        return (
          <button key={d.id} onClick={() => donor && onOpen(d, donor)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 0", borderBottom: `1px dashed ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{donor?.name || "Donor"}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{d.receipt} · {fmtDate(d.date)} · {d.purpose}</div>
            </div>
            <div style={{ fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>+{inr(d.amount)}</div>
          </button>
        );
      })}
    </div>
  );
}

function Donors({ donors, donations, lastGiven, lapsed, onOpen }) {
  const [q, setQ] = useState("");
  const totals = {};
  donations.forEach((d) => { totals[d.donorId] = (totals[d.donorId] || 0) + Number(d.amount); });
  const list = donors
    .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q))
    .sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));

  return (
    <>
      {lapsed.length > 0 && (
        <div style={{ ...S.card, marginBottom: 12, borderLeft: `4px solid ${C.gold}` }}>
          <div style={S.label}>Not donated in 90+ days · send a reminder</div>
          {lapsed.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px dashed ${C.line}` }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: C.muted }}>Last: {fmtDate(lastGiven[d.id])}</div>
              </div>
              <a href={waLink(d.phone, reminderMsg("en", d.name))} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: C.green, textDecoration: "none", border: `1px solid ${C.green}`, borderRadius: 999, padding: "6px 12px" }}>Remind</a>
            </div>
          ))}
        </div>
      )}
      <div style={S.card}>
        <input style={{ ...S.input, marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search donors…" />
        {list.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No donors yet — they get created automatically when you add a donation.</div>}
        {list.map((d) => (
          <button key={d.id} onClick={() => onOpen(d)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 0", borderBottom: `1px dashed ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{d.name}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{d.phone}{d.city ? " · " + d.city : ""}</div>
            </div>
            <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{inr(totals[d.id] || 0)}</div>
          </button>
        ))}
      </div>
    </>
  );
}

function DonorDetail({ donor, donations, onClose }) {
  const total = donations.reduce((s, d) => s + Number(d.amount), 0);
  return (
    <Overlay title={donor.name} onClose={onClose}>
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ fontSize: 14 }}>{donor.phone}{donor.city ? " · " + donor.city : ""}{donor.pan ? " · PAN: " + donor.pan : ""}</div>
        <div style={{ marginTop: 8, fontSize: 13, color: C.muted }}>Lifetime giving</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(total)}</div>
      </div>
      <div style={{ ...S.label, marginBottom: 8 }}>Send reminder on WhatsApp</div>
      <WaButtons phone={donor.phone} build={(lang) => reminderMsg(lang, donor.name)} />
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={S.label}>Donation history</div>
        {donations.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No donations recorded.</div>}
        {donations.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px dashed ${C.line}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{d.receipt}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(d.date)} · {d.purpose} · {d.mode}</div>
            </div>
            <div style={{ fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(d.amount)}</div>
          </div>
        ))}
      </div>
    </Overlay>
  );
}
