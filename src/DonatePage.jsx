import { useState } from "react";
import { C, S } from "./theme.js";

// Public donation page (no auth). Flow (per spec, no shortcuts):
//   1. POST create-order (Edge Function) -> Razorpay order created server-side.
//   2. Open Razorpay Checkout with the PUBLISHABLE key_id only.
//   3. Razorpay webhook (server) verifies + inserts the donation — the source
//      of truth. We NEVER create the donation from the client callback.
//   4. On success we poll order-status for the DB-generated receipt number.
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const FALLBACK_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;
const FOUNDATION_PHONE = (import.meta.env.VITE_FOUNDATION_PHONE || "").replace(/\D/g, "").slice(-10);

const AMOUNTS = [101, 501, 1100, 2100];
const PURPOSES = ["Zakat", "Sadaqah", "General", "Education", "Medical", "Ration"];

const T = {
  en: {
    tag: "Ummat Foundation", title: "Make a donation",
    intro: "Your contribution supports families in need. Every rupee is accounted for.",
    name: "Full name", phone: "Mobile number (10 digits)", email: "Email (optional)",
    amount: "Amount", other: "Other amount (₹)", purpose: "Purpose", pan: "PAN (optional)",
    panNote: "Required above ₹2,000 for an 80G receipt in future.",
    give: "Donate", giveAmt: (a) => `Donate ₹${a.toLocaleString("en-IN")}`,
    secure: "Secure payment via Razorpay", starting: "Starting secure payment…",
    confirming: "Confirming your payment…",
    successTitle: "JazakAllah Khair!", successMsg: "Thank you for your generous donation.",
    receipt: "Receipt number", pending: "Payment received — your receipt will be issued shortly.",
    save: "Save our number on WhatsApp", again: "Make another donation",
    errName: "Please enter your name.", errPhone: "Please enter a valid 10-digit mobile number.",
    errAmt: "Amount must be between ₹10 and ₹5,00,000.", errPay: "Payment could not be started. Please try again.",
    lang: "हिंदी", myDonations: "My Donations",
  },
  hi: {
    tag: "उम्मत फाउंडेशन", title: "दान करें",
    intro: "आपका योगदान ज़रूरतमंद परिवारों की मदद करता है। हर रुपये का हिसाब रखा जाता है।",
    name: "पूरा नाम", phone: "मोबाइल नंबर (10 अंक)", email: "ईमेल (वैकल्पिक)",
    amount: "राशि", other: "अन्य राशि (₹)", purpose: "उद्देश्य", pan: "पैन (वैकल्पिक)",
    panNote: "भविष्य में 80G रसीद के लिए ₹2,000 से अधिक पर आवश्यक।",
    give: "दान करें", giveAmt: (a) => `₹${a.toLocaleString("en-IN")} दान करें`,
    secure: "Razorpay के ज़रिए सुरक्षित भुगतान", starting: "सुरक्षित भुगतान शुरू हो रहा है…",
    confirming: "आपके भुगतान की पुष्टि हो रही है…",
    successTitle: "जज़ाकल्लाह ख़ैर!", successMsg: "आपके उदार दान के लिए धन्यवाद।",
    receipt: "रसीद नंबर", pending: "भुगतान प्राप्त हुआ — आपकी रसीद जल्द ही जारी होगी।",
    save: "WhatsApp पर हमारा नंबर सेव करें", again: "एक और दान करें",
    errName: "कृपया अपना नाम दर्ज करें।", errPhone: "कृपया सही 10 अंकों का मोबाइल नंबर दर्ज करें।",
    errAmt: "राशि ₹10 से ₹5,00,000 के बीच होनी चाहिए।", errPay: "भुगतान शुरू नहीं हो सका। कृपया पुनः प्रयास करें।",
    lang: "English", myDonations: "मेरे दान",
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error("script"));
    document.body.appendChild(s);
  });
}

export default function DonatePage() {
  const [lang, setLang] = useState("en");
  const t = T[lang];
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [chip, setChip] = useState(501);
  const [custom, setCustom] = useState("");
  const [purpose, setPurpose] = useState("General");
  const [pan, setPan] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(null); // { receipt, amount }

  const amount = custom ? Number(custom) : chip;

  const pollReceipt = async (orderId) => {
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fetch(`${FN}/order-status?order_id=${encodeURIComponent(orderId)}`);
        const j = await r.json();
        if (j.status === "paid") return j.receipt || null;
      } catch { /* keep polling */ }
      await sleep(1500);
    }
    return null;
  };

  const donate = async () => {
    setErr("");
    if (!name.trim()) return setErr(t.errName);
    if (!/^\d{10}$/.test(phone)) return setErr(t.errPhone);
    if (!(amount >= 10 && amount <= 500000)) return setErr(t.errAmt);

    setBusy(true);
    setStatusMsg(t.starting);
    try {
      await loadRazorpay();
      const res = await fetch(`${FN}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone, email: email.trim(), amount, purpose, pan: pan.trim() }),
      });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error || "order");

      setStatusMsg("");
      const rzp = new window.Razorpay({
        key: order.key_id || FALLBACK_KEY_ID,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: "Ummat Foundation",
        description: `${purpose} donation`,
        prefill: { name: name.trim(), email: email.trim(), contact: phone },
        theme: { color: C.green },
        handler: async () => {
          setStatusMsg(t.confirming);
          const receipt = await pollReceipt(order.order_id);
          setSuccess({ receipt, amount });
          setBusy(false);
          setStatusMsg("");
        },
        modal: { ondismiss: () => { setBusy(false); setStatusMsg(""); } },
      });
      rzp.on("payment.failed", () => { setErr(t.errPay); setBusy(false); setStatusMsg(""); });
      rzp.open();
    } catch (e) {
      setErr(t.errPay);
      setBusy(false);
      setStatusMsg("");
    }
  };

  const wrap = { minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: C.ink, maxWidth: 480, margin: "0 auto", paddingBottom: 40 };

  if (success) {
    const waMsg = lang === "hi"
      ? `अस्सलामुअलैकुम, मैंने उम्मत फाउंडेशन को ₹${success.amount} का दान किया है।`
      : `Assalamualaikum, I have just donated ₹${success.amount} to Ummat Foundation.`;
    const waHref = FOUNDATION_PHONE.length === 10
      ? `https://wa.me/91${FOUNDATION_PHONE}?text=${encodeURIComponent(waMsg)}` : null;
    return (
      <div style={wrap}>
        <div style={{ background: C.greenDeep, color: "#fff", padding: "22px 18px", borderRadius: "0 0 22px 22px", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>✓</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{t.successTitle}</div>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ ...S.card, borderLeft: `4px solid ${C.gold}`, textAlign: "center" }}>
            <div style={{ fontSize: 15 }}>{t.successMsg}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.green, margin: "8px 0", fontVariantNumeric: "tabular-nums" }}>₹{success.amount.toLocaleString("en-IN")}</div>
            {success.receipt ? (
              <>
                <div style={S.label}>{t.receipt}</div>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.04em" }}>{success.receipt}</div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>{t.pending}</div>
            )}
          </div>
          {waHref && (
            <a href={waHref} target="_blank" rel="noreferrer" style={{ ...S.btn, display: "block", textAlign: "center", textDecoration: "none", background: C.green, color: "#fff", marginTop: 14 }}>
              {t.save}
            </a>
          )}
          <button onClick={() => { setSuccess(null); setCustom(""); }} style={{ ...S.btn, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.ink, marginTop: 10 }}>
            {t.again}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ background: C.greenDeep, color: "#fff", padding: "18px 18px 22px", borderRadius: "0 0 22px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/ummat-logo.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 44, height: 44, borderRadius: 10, objectFit: "contain", background: "#fff", padding: 4, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#BFD6CC", fontWeight: 700 }}>{t.tag}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{t.title}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <a href="/my" style={{ background: "none", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
              {t.myDonations}
            </a>
            <button onClick={() => setLang(lang === "en" ? "hi" : "en")} style={{ background: "none", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {t.lang}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#DDEAE3", marginTop: 10, lineHeight: 1.5 }}>{t.intro}</div>
      </div>

      <div style={{ padding: 16 }}>
        {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#FBEAE6", color: C.red, fontSize: 13 }}>{err}</div>}

        <div style={{ ...S.card }}>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>{t.name} *</label>
            <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>{t.phone} *</label>
            <input style={S.input} inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="98XXXXXXXX" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>{t.email}</label>
            <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <label style={S.label}>{t.amount} *</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {AMOUNTS.map((a) => (
              <button key={a} onClick={() => { setChip(a); setCustom(""); }} style={{
                padding: "9px 14px", borderRadius: 999, fontSize: 15, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${!custom && chip === a ? C.green : C.line}`,
                background: !custom && chip === a ? C.green : "#FDFCF8", color: !custom && chip === a ? "#fff" : C.ink,
              }}>₹{a.toLocaleString("en-IN")}</button>
            ))}
          </div>
          <input style={{ ...S.input, marginBottom: 12 }} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} placeholder={t.other} />

          <label style={S.label}>{t.purpose}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {PURPOSES.map((p) => (
              <button key={p} onClick={() => setPurpose(p)} style={{
                padding: "7px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${purpose === p ? C.green : C.line}`,
                background: purpose === p ? C.green : "#FDFCF8", color: purpose === p ? "#fff" : C.ink,
              }}>{p}</button>
            ))}
          </div>

          <label style={S.label}>{t.pan}</label>
          <input style={S.input} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{t.panNote}</div>
        </div>

        <button disabled={busy} onClick={donate} style={{ ...S.btn, width: "100%", marginTop: 14, background: busy ? C.line : C.green, color: busy ? C.muted : "#fff" }}>
          {busy ? (statusMsg || t.starting) : (amount >= 10 ? t.giveAmt(amount) : t.give)}
        </button>
        <div style={{ textAlign: "center", fontSize: 12, color: C.muted, marginTop: 10 }}>🔒 {t.secure}</div>
      </div>
    </div>
  );
}
