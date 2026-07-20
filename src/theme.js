// Shared palette + base style tokens (deep green / ivory / gold), extracted so
// the auth screen and the ledger render identically.
export const C = {
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

export const S = {
  label: { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, display: "block", marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#FDFCF8", fontSize: 15, color: C.ink, outline: "none" },
  card: { background: C.surface, borderRadius: 14, border: `1px solid ${C.line}`, padding: 16 },
  btn: { padding: "12px 16px", borderRadius: 12, border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer" },
};
