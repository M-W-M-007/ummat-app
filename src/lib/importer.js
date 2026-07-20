import * as XLSX from "xlsx";
import { supabase } from "./supabase.js";

// ---------------------------------------------------------------------------
// One-time importer for the old prototype's Excel export (sheets "Donations"
// and "Expenses"). Creates donors by phone, PRESERVES the original receipt
// numbers (the DB trigger skips generation when receipt_no is supplied), and
// is safe to re-run — donations whose receipt already exists are skipped.
// ---------------------------------------------------------------------------

const norm = (v) => (v == null ? "" : String(v).trim());
const digits = (v) => norm(v).replace(/\D/g, "");
const money = (v) => Number(String(v ?? "").replace(/[^\d.]/g, ""));

// Accept both a plain "YYYY-MM-DD" string (how the prototype exports it) and an
// Excel date serial (if a spreadsheet app re-typed the column as a date).
function normDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = norm(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s);
  return isNaN(dt) ? s : dt.toISOString().slice(0, 10);
}

export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const donSheet = wb.Sheets["Donations"];
  const expSheet = wb.Sheets["Expenses"];
  if (!donSheet && !expSheet) {
    throw new Error('This file has no "Donations" or "Expenses" sheet — is it the prototype export?');
  }
  const warnings = [];

  const donations = [];
  const donationsRaw = donSheet ? XLSX.utils.sheet_to_json(donSheet, { defval: "" }) : [];
  donationsRaw.forEach((r, i) => {
    const row = i + 2; // header is row 1
    if (r.Info && !r.Receipt) return; // the export's "No donations…" placeholder
    const receipt = norm(r["Receipt"]);
    const amount = money(r["Amount (INR)"]);
    const phone = digits(r["Phone"]).slice(-10);
    if (!receipt) { warnings.push(`Donations row ${row}: no Receipt — skipped`); return; }
    if (!(amount > 0)) { warnings.push(`Donations row ${row} (${receipt}): bad amount — skipped`); return; }
    if (phone.length !== 10) warnings.push(`Donations row ${row} (${receipt}): phone "${norm(r["Phone"])}" is not 10 digits`);
    donations.push({
      receipt, amount, phone,
      name: norm(r["Donor"]) || "Unknown",
      date: normDate(r["Date"]),
      purpose: norm(r["Purpose"]) || "General",
      mode: norm(r["Mode"]) || "Cash",
      pan: norm(r["PAN"]),
      notes: norm(r["Notes"]),
    });
  });

  const expenses = [];
  const expensesRaw = expSheet ? XLSX.utils.sheet_to_json(expSheet, { defval: "" }) : [];
  expensesRaw.forEach((r, i) => {
    const row = i + 2;
    if (r.Info && !r["Category"]) return;
    const amount = money(r["Amount (INR)"]);
    if (!(amount > 0)) { warnings.push(`Expenses row ${row}: bad amount — skipped`); return; }
    expenses.push({
      amount,
      date: normDate(r["Date"]),
      category: norm(r["Category"]) || "Misc",
      paidTo: norm(r["Paid to"]),
      mode: norm(r["Mode"]) || "Cash",
      notes: norm(r["Notes"]),
    });
  });

  return { donations, expenses, warnings };
}

// PostgREST caps URL length, so chunk the `in(...)` lookups and inserts.
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function runImport({ donations, expenses }) {
  const result = { donorsCreated: 0, donationsImported: 0, donationsSkipped: 0, expensesImported: 0, expensesSkipped: 0 };

  // 1) Resolve donors by phone (existing + newly created) into a phone→id map.
  const phones = [...new Set(donations.map((d) => d.phone).filter((p) => p.length === 10))];
  const phoneToId = {};
  for (const part of chunk(phones, 150)) {
    const { data, error } = await supabase.from("donors").select("id,phone").in("phone", part);
    if (error) throw error;
    data.forEach((d) => { phoneToId[d.phone] = d.id; });
  }
  const missing = phones.filter((p) => !phoneToId[p]);
  const newDonors = missing.map((p) => {
    const src = donations.find((d) => d.phone === p);
    return { name: src.name, phone: p, pan: src.pan || "", city: "", lang: "en" };
  });
  for (const part of chunk(newDonors, 200)) {
    const { data, error } = await supabase.from("donors").insert(part).select("id,phone");
    if (error) throw error;
    data.forEach((d) => { phoneToId[d.phone] = d.id; });
    result.donorsCreated += data.length;
  }

  // 2) Skip donations whose receipt already exists (idempotent re-runs).
  const receipts = donations.map((d) => d.receipt);
  const existing = new Set();
  for (const part of chunk(receipts, 150)) {
    const { data, error } = await supabase.from("donations").select("receipt_no").in("receipt_no", part);
    if (error) throw error;
    data.forEach((r) => existing.add(r.receipt_no));
  }
  const toInsert = [];
  for (const d of donations) {
    if (existing.has(d.receipt)) { result.donationsSkipped++; continue; }
    const donor_id = phoneToId[d.phone];
    if (!donor_id) { result.donationsSkipped++; continue; }
    toInsert.push({
      donor_id, amount: d.amount, date: d.date, mode: d.mode,
      purpose: d.purpose, notes: d.notes, receipt_no: d.receipt, // preserved
    });
  }
  for (const part of chunk(toInsert, 200)) {
    const { error } = await supabase.from("donations").insert(part);
    if (error) throw error;
    result.donationsImported += part.length;
  }

  // 3) Expenses. They have no natural key, so to keep re-imports safe we skip
  //    any row that exactly matches one already in the DB (same date, category,
  //    amount, payee, mode, notes). Matching is only against pre-existing rows,
  //    so genuinely-identical rows within a single file are still both kept.
  const keyExp = (e) => [e.date, e.category, String(Number(e.amount)), e.paidTo ?? e.paid_to ?? "", e.mode, e.notes ?? ""].join("|");
  const { data: existingExp, error: exErr } = await supabase
    .from("expenses").select("date,category,amount,paid_to,mode,notes");
  if (exErr) throw exErr;
  const expSeen = new Set((existingExp || []).map(keyExp));

  const expRows = [];
  for (const e of expenses) {
    if (expSeen.has(keyExp(e))) { result.expensesSkipped++; continue; }
    expRows.push({ amount: e.amount, date: e.date, category: e.category, paid_to: e.paidTo, mode: e.mode, notes: e.notes });
  }
  for (const part of chunk(expRows, 200)) {
    const { error } = await supabase.from("expenses").insert(part);
    if (error) throw error;
    result.expensesImported += part.length;
  }

  // 4) Advance the yearly receipt counters past the imported numbers so the
  //    next new donation doesn't reuse an imported receipt.
  const { error: syncErr } = await supabase.rpc("sync_receipt_counters");
  if (syncErr) throw syncErr;

  return result;
}

// Dev-only hook: lets automated verification drive the real import pipeline
// without a file picker (browsers forbid setting a file input's value).
if (import.meta.env && import.meta.env.DEV && typeof window !== "undefined") {
  window.__ufImport = { parseWorkbook, runImport };
}
