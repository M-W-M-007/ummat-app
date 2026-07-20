import { jsPDF } from "jspdf";

// Indian-system number-to-words for whole rupees (up to 99 crore).
function amountInWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n) => (Math.floor(n / 100) ? ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "") : two(n % 100));
  const parts = [];
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) parts.push(two(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (num) parts.push(three(num));
  return parts.join(" ").trim() + " Rupees Only";
}

const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

// Load /ummat-logo.png, downscaled via canvas so the embedded image stays crisp
// at its ~54pt print size without bloating the PDF (null if not present).
async function loadLogo() {
  try {
    const res = await fetch("/ummat-logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const MAX = 240; // px — ~4x the printed size, plenty for print sharpness
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// Build and download a polished A4 receipt.
export async function downloadReceipt({ donation, donor, orgName = "Ummat Foundation", orgPhone = "" }) {
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const GREEN = [11, 92, 67], DEEP = [8, 63, 47], GOLD = [199, 160, 40], INK = [24, 38, 32], MUTED = [110, 123, 116], LINE = [228, 226, 216];
  const M = 46; // page margin

  // Page background + inner frame
  doc.setFillColor(251, 250, 245); doc.rect(0, 0, W, H, "F");
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.2); doc.rect(M - 14, M - 14, W - 2 * (M - 14), H - 2 * (M - 14));

  // Header band
  const bandY = M, bandH = 96;
  doc.setFillColor(...DEEP); doc.rect(M, bandY, W - 2 * M, bandH, "F");
  // Logo on a clean tile (reads well on any logo background)
  if (logo) {
    doc.setFillColor(255, 255, 255); doc.roundedRect(M + 16, bandY + 17, 62, 62, 8, 8, "F");
    try { doc.addImage(logo, "PNG", M + 20, bandY + 21, 54, 54); } catch { /* ignore bad image */ }
  }
  const tx = logo ? M + 94 : M + 20;
  doc.setTextColor(...GOLD); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text(orgName, tx, bandY + 44);
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("O F F I C I A L   D O N A T I O N   R E C E I P T", tx, bandY + 64);

  let y = bandY + bandH + 34;
  // Receipt no + date
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("RECEIPT NO.", M + 4, y);
  doc.text("DATE", W - M - 4, y, { align: "right" });
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(donation.receipt, M + 4, y + 17);
  doc.text(fmtDate(donation.date), W - M - 4, y + 17, { align: "right" });

  y += 46;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(M + 4, y, W - M - 4, y);

  // Donor
  y += 26;
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("RECEIVED WITH THANKS FROM", M + 4, y);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(donor.name, M + 4, y + 21);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...MUTED);
  const sub = [donor.phone, donor.city, donor.pan ? "PAN: " + donor.pan : ""].filter(Boolean).join("   •   ");
  doc.text(sub, M + 4, y + 39);

  // Amount highlight box
  y += 60;
  const boxH = 92;
  doc.setFillColor(...GREEN); doc.roundedRect(M + 4, y, W - 2 * M - 8, boxH, 10, 10, "F");
  doc.setTextColor(190, 214, 204); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("DONATION AMOUNT", M + 22, y + 26);
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(30);
  doc.text("INR " + Number(donation.amount).toLocaleString("en-IN"), M + 22, y + 58);
  doc.setTextColor(...GOLD); doc.setFont("helvetica", "italic"); doc.setFontSize(10.5);
  doc.text(amountInWords(donation.amount), M + 22, y + 80);

  // Purpose + mode
  y += boxH + 34;
  const colX = W / 2;
  const cell = (label, value, x) => {
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    doc.text(label, x, y);
    doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(13);
    doc.text(String(value || "—"), x, y + 18);
  };
  cell("PURPOSE", donation.purpose, M + 4);
  cell("PAYMENT MODE", donation.mode + (donation.source === "online" ? " (Online)" : ""), colX);

  // 80G note
  y += 48;
  doc.setDrawColor(...LINE); doc.line(M + 4, y, W - M - 4, y);
  y += 22;
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "italic"); doc.setFontSize(9.5);
  doc.text("80G tax-exemption details will be added once the Foundation's registration is obtained.", M + 4, y);

  // Footer
  const fy = H - M - 46;
  doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(M + 4, fy, W - M - 4, fy);
  doc.setTextColor(...GREEN); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("JazakAllah Khair — thank you for your generosity.", M + 4, fy + 22);
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  const foot = ["Computer-generated receipt — no signature required.", orgPhone ? "WhatsApp: " + orgPhone : ""].filter(Boolean).join("    ");
  doc.text(foot, M + 4, fy + 38);
  doc.text("For " + orgName, W - M - 4, fy + 38, { align: "right" });

  doc.save(`${donation.receipt}.pdf`);
}
