import { useState } from "react";
import { supabase } from "./lib/supabase.js";
import { C, S } from "./theme.js";

// Auth screen for staff (admin + volunteers). Sign-in is the normal path;
// "Create account" exists to bootstrap the first users in step 2 — step 6
// replaces open sign-up with admin-issued email invites, and you should turn
// off public sign-ups in the Supabase dashboard once your accounts exist.
export default function Login() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, confirm via the link, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // onAuthStateChange in App picks up the session from here.
      }
    } catch (e2) {
      setErr(e2.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 6 && (mode === "signin" || name.trim());

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: C.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <img src="/ummat-logo.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 84, height: 84, objectFit: "contain", borderRadius: 16, marginBottom: 10 }} />
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.green, fontWeight: 800 }}>Ummat Foundation</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>Donation Ledger</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Staff sign in</div>
        </div>

        <form onSubmit={submit} style={{ ...S.card, padding: 18 }}>
          {mode === "signup" && (
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Your name</label>
              <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At least 6 characters" />
          </div>

          {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#FBEAE6", color: C.red, fontSize: 13 }}>{err}</div>}
          {msg && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#EAF3EE", color: C.green, fontSize: 13 }}>{msg}</div>}

          <button type="submit" disabled={!valid || busy} style={{ ...S.btn, width: "100%", background: valid && !busy ? C.green : C.line, color: valid && !busy ? "#fff" : C.muted }}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: C.muted }}>
          {mode === "signin" ? "First time setting up? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setMsg(""); }}
            style={{ border: "none", background: "none", color: C.green, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13 }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
