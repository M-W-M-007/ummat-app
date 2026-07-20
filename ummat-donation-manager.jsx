import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

// ---------- constants ----------
const KEY = "uf-data-v1";
const PURPOSES = ["Zakat", "Sadaqah", "General", "Education", "Medical", "Ration"];
const EXP_CATS = ["Ration kits", "Education", "Medical", "Rent", "Transport", "Salaries", "Misc"];
const MODES = ["Cash", "UPI", "Bank transfer", "Cheque"];
const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "ur", label: "اردو" },
];

const C = {
  bg: "#F6F5EF",
  surface: "#FFFFFF",
  ink: "#182620",
  green: "#0B5C43",
  greenDeep: "#083F2F",
  gold: "#C7A028",
  red: "#A63A2B",
  muted: "#6E7B74",
  line: "#E4E2D8",
};

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const uid = () => Math.random().toString(36).slice(2, 10);

function thanksMsg(lang, name, amount, date, receipt) {
  if (lang === "hi")
    return `अस्सलामुअलैकुम ${name} जी, उम्मत फाउंडेशन आपके ${inr(amount)} के दान (${fmtDate(date)}) के लिए दिल से शुक्रगुज़ार है। रसीद नं: ${receipt}। जज़ाकल्लाह ख़ैर।`;
  if (lang === "ur")
    return `السلام علیکم ${name}، امت فاؤنڈیشن آپ کے عطیہ ${inr(amount)} (${fmtDate(date)}) کے لیے تہہ دل سے شکر گزار ہے۔ رسید نمبر: ${receipt}۔ جزاک اللہ خیر`;
  return `Assalamualaikum ${name}, Ummat Foundation gratefully acknowledges your donation of ${inr(amount)} on ${fmtDate(date)}. Receipt no: ${receipt}. JazakAllah Khair.`;
}
function reminderMsg(lang, name) {
  if (lang === "hi")
    return `अस्सलामुअलैकुम ${name} जी, उम्मत फाउंडेशन की ओर से एक विनम्र याद-दिहानी। आपके पिछले सहयोग से कई परिवारों को मदद मिली है। अगर आप दोबारा योगदान देना चाहें तो हम आभारी रहेंगे। जज़ाकल्लाह ख़ैर।`;
  if (lang === "ur")
    return `السلام علیکم ${name}، امت فاؤنڈیشن کی جانب سے ایک نرم یاد دہانی۔ آپ کے پچھلے تعاون سے کئی خاندانوں کی مدد ہوئی۔ اگر آپ دوبارہ تعاون کرنا چاہیں تو ہم شکر گزار ہوں گے۔ جزاک اللہ خیر`;
  return `Assalamualaikum ${name}, a gentle reminder from Ummat Foundation. Your past support has helped many families. If you wish to contribute again, we would be grateful. JazakAllah Khair.`;
}
const waLink = (phone, text) =>
  `https://wa.me/91${String(phone).replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(text)}`;

// ---------- small ui bits ----------
const S = {
  label: { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, display: "block", marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#FDFCF8", fontSize: 15, color: C.ink, outline: "none" },
  card: { background: C.surface, borderRadius: 14, border: `1px solid ${C.line}`, padding: 16 },
  btn: { padding: "12px 16px", borderRadius: 12, border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer" },
};

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
  const [data, setData] = useState(null); // {donors, donations, expenses, seq}
  const [tab, setTab] = useState("home");
  const [overlay, setOverlay] = useState(null); // {type:'donation'|'expense'|'donor-detail'|'thanks', ...}
  const [viewMonth, setViewMonth] = useState(today().slice(0, 7)); // "" = all time
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(KEY);
        setData(r ? JSON.parse(r.value) : { donors: [], donations: [], expenses: [], seq: 0 });
      } catch {
        setData({ donors: [], donations: [], expenses: [], seq: 0 });
      }
    })();
  }, []);

  const save = async (next) => {
    setData(next);
    try {
      await window.storage.set(KEY, JSON.stringify(next));
    } catch {
      setErr("Could not save — check connection and try again.");
      setTimeout(() => setErr(""), 4000);
    }
  };

  if (!data)
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg, color: C.muted, fontFamily: "system-ui" }}>
        Opening the ledger…
      </div>
    );

  const { donors, donations, expenses } = data;
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

  // ---- add donation ----
  const addDonation = (form) => {
    let donorId = form.donorId;
    let next = { ...data };
    if (!donorId) {
      const existing = donors.find((d) => d.phone === form.phone);
      if (existing) donorId = existing.id;
      else {
        donorId = uid();
        next = { ...next, donors: [...next.donors, { id: donorId, name: form.name.trim(), phone: form.phone, city: form.city || "", pan: form.pan || "", lang: "en" }] };
      }
    }
    const seq = next.seq + 1;
    const receipt = `UF-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
    const don = { id: uid(), donorId, amount: Number(form.amount), date: form.date, mode: form.mode, purpose: form.purpose, receipt, notes: form.notes || "" };
    next = { ...next, seq, donations: [...next.donations, don] };
    save(next);
    const donor = next.donors.find((d) => d.id === donorId);
    setOverlay({ type: "thanks", don, donor, saved: true });
  };

  const addExpense = (form) => {
    const exp = { id: uid(), amount: Number(form.amount), date: form.date, category: form.category, paidTo: form.paidTo || "", mode: form.mode, notes: form.notes || "" };
    save({ ...data, expenses: [...expenses, exp] });
    setOverlay(null);
    setTab("expenses");
  };

  const updateDonation = (form, id) => {
    let next = { ...data };
    let donorId = form.donorId;
    if (!donorId && form.name && /^\d{10}$/.test(form.phone)) {
      const existing = next.donors.find((d) => d.phone === form.phone);
      if (existing) donorId = existing.id;
      else {
        donorId = uid();
        next = { ...next, donors: [...next.donors, { id: donorId, name: form.name.trim(), phone: form.phone, city: form.city || "", pan: form.pan || "", lang: "en" }] };
      }
    }
    next = { ...next, donations: next.donations.map((d) => (d.id === id ? { ...d, donorId: donorId || d.donorId, amount: Number(form.amount), date: form.date, mode: form.mode, purpose: form.purpose, notes: form.notes || "" } : d)) };
    save(next);
    setOverlay(null);
  };
  const deleteDonation = (id) => {
    save({ ...data, donations: donations.filter((d) => d.id !== id) });
    setOverlay(null);
  };
  const updateExpense = (form, id) => {
    save({ ...data, expenses: expenses.map((e) => (e.id === id ? { ...e, amount: Number(form.amount), date: form.date, category: form.category, paidTo: form.paidTo || "", mode: form.mode, notes: form.notes || "" } : e)) });
    setOverlay(null);
  };
  const deleteExpense = (id) => {
    save({ ...data, expenses: expenses.filter((e) => e.id !== id) });
    setOverlay(null);
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

  const purposeTotals = PURPOSES.map((p) => ({ p, v: donations.filter((d) => d.purpose === p && inPeriod(d)).reduce((s, d) => s + Number(d.amount), 0) })).filter((x) => x.v > 0);

  const recent = [
    ...donations.filter(inPeriod).map((d) => ({ ...d, kind: "in" })),
    ...expenses.filter(inPeriod).map((e) => ({ ...e, kind: "out" })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, viewMonth ? 30 : 8);

  const pct = totalIn > 0 ? Math.min(100, Math.round((totalOut / totalIn) * 100)) : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: C.ink, maxWidth: 480, margin: "0 auto", paddingBottom: 84 }}>
      {/* header */}
      <div style={{ background: C.greenDeep, color: "#fff", padding: "18px 18px 20px", borderRadius: "0 0 22px 22px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#BFD6CC", fontWeight: 700 }}>Ummat Foundation</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>Donation Ledger</div>
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

            {purposeTotals.length > 0 && (
              <div style={{ ...S.card, marginTop: 12 }}>
                <div style={S.label}>Collected by purpose · {periodLabel}</div>
                {purposeTotals.map(({ p, v }) => (
                  <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px dashed ${C.line}`, fontSize: 14 }}>
                    <span style={{ fontWeight: p === "Zakat" ? 800 : 500 }}>{p}{p === "Zakat" ? " ◆" : ""}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{inr(v)}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>◆ Zakat is tracked separately — spend only on Zakat-eligible purposes.</div>
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
          <ListDonations donations={[...donations].reverse()} donorById={donorById} onOpen={(don, donor) => setOverlay({ type: "thanks", don, donor })} />
        )}

        {tab === "expenses" && (
          <div style={S.card}>
            <div style={S.label}>All expenses</div>
            {expenses.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "10px 0" }}>No expenses recorded yet.</div>}
            {[...expenses].reverse().map((e) => (
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
        <DonationForm donors={donors} initial={overlay.initial} onCancel={() => setOverlay(null)}
          onSave={(f) => (overlay.initial ? updateDonation(f, overlay.initial.id) : addDonation(f))}
          onDelete={overlay.initial ? () => deleteDonation(overlay.initial.id) : null} />
      )}
      {overlay?.type === "expense" && (
        <ExpenseForm initial={overlay.initial} onCancel={() => setOverlay(null)}
          onSave={(f) => (overlay.initial ? updateExpense(f, overlay.initial.id) : addExpense(f))}
          onDelete={overlay.initial ? () => deleteExpense(overlay.initial.id) : null} />
      )}
      {overlay?.type === "thanks" && (
        <ThanksSheet don={overlay.don} donor={overlay.donor} saved={overlay.saved} onClose={() => setOverlay(null)}
          onEdit={() => setOverlay({ type: "donation", initial: overlay.don })} />
      )}
      {overlay?.type === "donor-detail" && (
        <DonorDetail donor={overlay.donor} donations={donations.filter((d) => d.donorId === overlay.donor.id)} onClose={() => setOverlay(null)} />
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

function DonationForm({ donors, onCancel, onSave, initial, onDelete }) {
  const [f, setF] = useState(
    initial
      ? { donorId: initial.donorId, name: "", phone: "", city: "", pan: "", amount: String(initial.amount), date: initial.date, mode: initial.mode, purpose: initial.purpose, notes: initial.notes || "" }
      : { donorId: "", name: "", phone: "", city: "", pan: "", amount: "", date: today(), mode: "UPI", purpose: "General", notes: "" }
  );
  const [q, setQ] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const matches = q.length >= 2 ? donors.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q)) : [];
  const picked = donors.find((d) => d.id === f.donorId);
  const valid = f.amount > 0 && (f.donorId || (f.name.trim() && /^\d{10}$/.test(f.phone)));

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
      <Field label="Payment mode"><Chips options={MODES} value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label="Purpose"><Chips options={PURPOSES} value={f.purpose} onChange={(v) => setF({ ...f, purpose: v })} /></Field>
      <Field label="Notes"><input style={S.input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>

      <button disabled={!valid} onClick={() => onSave(f)} style={{ ...S.btn, width: "100%", background: valid ? C.green : C.line, color: valid ? "#fff" : C.muted, marginTop: 4 }}>
        {initial ? "Save changes" : "Save donation"}
      </button>
      {onDelete && (
        <button onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))} style={{ ...S.btn, width: "100%", background: confirmDel ? C.red : "none", border: `1px solid ${C.red}`, color: confirmDel ? "#fff" : C.red, marginTop: 10 }}>
          {confirmDel ? "Tap again to confirm delete" : "Delete this donation"}
        </button>
      )}
    </Overlay>
  );
}

function ExpenseForm({ onCancel, onSave, initial, onDelete }) {
  const [f, setF] = useState(
    initial
      ? { amount: String(initial.amount), date: initial.date, category: initial.category, paidTo: initial.paidTo || "", mode: initial.mode, notes: initial.notes || "" }
      : { amount: "", date: today(), category: "Ration kits", paidTo: "", mode: "Cash", notes: "" }
  );
  const [confirmDel, setConfirmDel] = useState(false);
  const valid = f.amount > 0;
  return (
    <Overlay title={initial ? "Edit expense" : "New expense"} onClose={onCancel}>
      <Field label="Amount (₹) *"><input style={S.input} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} placeholder="0" /></Field>
      <Field label="Date"><input type="date" style={S.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Category"><Chips options={EXP_CATS} value={f.category} onChange={(v) => setF({ ...f, category: v })} /></Field>
      <Field label="Paid to"><input style={S.input} value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} placeholder="Shop / person / vendor" /></Field>
      <Field label="Payment mode"><Chips options={MODES} value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label="Notes"><input style={S.input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button disabled={!valid} onClick={() => onSave(f)} style={{ ...S.btn, width: "100%", background: valid ? C.red : C.line, color: valid ? "#fff" : C.muted, marginTop: 4 }}>
        {initial ? "Save changes" : "Save expense"}
      </button>
      {onDelete && (
        <button onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))} style={{ ...S.btn, width: "100%", background: confirmDel ? C.red : "none", border: `1px solid ${C.red}`, color: confirmDel ? "#fff" : C.red, marginTop: 10 }}>
          {confirmDel ? "Tap again to confirm delete" : "Delete this expense"}
        </button>
      )}
    </Overlay>
  );
}

function ThanksSheet({ don, donor, onClose, onEdit, saved }) {
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
      <button onClick={onEdit} style={{ ...S.btn, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.ink, marginTop: 12 }}>Edit / Delete this donation</button>
      <button onClick={onClose} style={{ ...S.btn, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.muted, marginTop: 8 }}>Done</button>
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
        {[...donations].reverse().map((d) => (
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
