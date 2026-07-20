import { C } from "./theme.js";

// Shared across the admin Home and the donor portal. Donut built from
// stacked SVG circle strokes (stroke-dasharray) — no charting dependency.
export const PIE_COLORS = ["#0B5C43", "#C7A028", "#A63A2B", "#3F7CA6", "#8A5FB0", "#4E8F5E", "#B0763F", "#6E7B74"];

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

export default function PieChart({ data, colors = PIE_COLORS, size = 140, strokeWidth = 24 }) {
  const total = data.reduce((s, d) => s + d.v, 0);
  const r = (size - strokeWidth) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth={strokeWidth} />
        {total > 0 && data.map((d, i) => {
          const frac = d.v / total;
          const dash = frac * circumference;
          const el = (
            <circle key={d.p} cx={cx} cy={cy} r={r} fill="none"
              stroke={colors[i % colors.length]} strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`} />
          );
          offset += dash;
          return el;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="15" fontWeight="800" fill={C.ink}>{inr(total)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill={C.muted}>total</text>
      </svg>
      <div style={{ flex: 1, minWidth: 140 }}>
        {data.map((d, i) => (
          <div key={d.p} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: colors[i % colors.length], flexShrink: 0 }} />
              {d.p}
            </span>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0, marginLeft: 8 }}>
              {total > 0 ? Math.round((d.v / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
