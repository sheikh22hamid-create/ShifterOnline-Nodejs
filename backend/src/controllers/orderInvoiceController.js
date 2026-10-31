const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Node port of cust_api/invoice_url_generate.php + invoice.php - a live
// endpoint (queries pkg_order, the current live order table, not
// buy_order) that trackingway.dart still opens via the legacy PHP host.
//
// invoice_url_generate.php had `$SECRET_KEY = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"`
// hardcoded verbatim (never actually changed) as the HMAC key signing the
// invoice link, so anyone who read that one string out of the PHP source
// could forge a valid link to any order's invoice. Fixed here: a real env
// var, required, no fallback to a guessable default.
const INVOICE_SECRET_KEY = process.env.INVOICE_SECRET_KEY;
// A signed link with no expiry works forever once generated - if one ever
// leaks (chat, screenshot, forwarded email) it stays a valid way to view
// that order's invoice indefinitely. Links are valid for this long instead.
const INVOICE_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function signToken(orderId, uid, expiresAt) {
  return crypto.createHash("sha256").update(`${orderId}|${uid}|${expiresAt}|${INVOICE_SECRET_KEY}`).digest("hex");
}

// --- invoice_url_generate.php ---
async function generateInvoiceUrl(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!uid || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });
    }
    if (!INVOICE_SECRET_KEY) {
      logger.error("generateInvoiceUrl: INVOICE_SECRET_KEY is not configured.");
      return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Invoice generation is not configured." });
    }

    const order = await prisma.pkg_order.findFirst({ where: { uid, id: orderId }, select: { id: true } });
    if (!order) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Order not found!" });
    }

    const expiresAt = Date.now() + INVOICE_LINK_TTL_MS;
    const token = signToken(orderId, uid, expiresAt);
    const base = process.env.PUBLIC_BASE_URL || "";
    const invoiceUrl = `${base}/api/order/invoice?order_id=${orderId}&uid=${uid}&exp=${expiresAt}&token=${token}`;

    return res.status(200).json({ invoice_url: invoiceUrl, ResponseCode: "200", Result: "true", ResponseMsg: "Invoice URL generated successfully!" });
  } catch (err) {
    logger.error("generateInvoiceUrl failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Shared by the HTML page and the PDF download: the signed link binds
// order_id + uid + expiry, and generateInvoiceUrl only signs after confirming
// the order belongs to that uid, so a valid token proves ownership.
function verifyInvoiceLink(query) {
  const orderId = Number(query?.order_id || 0);
  const uid = Number(query?.uid || 0);
  const expiresAt = Number(query?.exp || 0);
  const token = String(query?.token || "");

  const notExpired = expiresAt > 0 && Date.now() <= expiresAt;
  const expected = INVOICE_SECRET_KEY && notExpired ? signToken(orderId, uid, expiresAt) : null;
  const tokenValid =
    expected && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));

  if (!tokenValid || orderId <= 0 || uid <= 0) return null;
  return { orderId, uid, expiresAt, token };
}

// Everything both renderers show, computed once so the PDF and the browser
// page can never disagree on an amount.
async function loadInvoiceData(uid, orderId) {
  const row = await prisma.pkg_order.findFirst({ where: { uid, id: orderId } });
  if (!row) return null;

  let riderName = "";
  let riderVehicleNo = "";
  let riderRating = "5.0";
  if (row.rid) {
    const rider = await prisma.tbl_rider.findUnique({ where: { id: row.rid } });
    if (rider) {
      riderName = `${rider.first_name || ""} ${rider.last_name || ""}`.trim() || rider.full_name || "";
      riderVehicleNo = rider.vehicle_no || "";
      const rateAgg = await prisma.pkg_order.aggregate({ where: { rid: row.rid, is_rate: 1 }, _avg: { cust_rate: true } });
      if (rateAgg._avg.cust_rate != null) riderRating = Number(rateAgg._avg.cust_rate).toFixed(1);
    }
  }

  let paymentMethodName = "Cash";
  if (row.p_method_id) {
    const pm = await prisma.tbl_payment_list.findUnique({ where: { id: row.p_method_id } });
    if (pm) paymentMethodName = pm.title;
  }

  const bookingId = `SO${String(row.id).padStart(10, "0")}`;
  const orderDate = row.odate ? new Date(row.odate).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";
  // row.wating_charge is the per-minute RATE; what was actually billed for
  // waiting is the amount "complete" added on top of d_charge in total_dcharge.
  const waitingBilled = Math.max(0, Math.round((Number(row.total_dcharge || 0) - Number(row.d_charge || 0)) * 100) / 100);
  const charges = [
    ["Delivery charge", row.d_charge],
    ["Service charge", row.service_charge],
    ["Waiting charge", waitingBilled],
    ["Extra mile charge", row.extra_mile_charge],
    ["Coupon discount", row.cou_amt ? -Number(row.cou_amt) : 0],
    [`Coins redeemed (${Number(row.referral_points_used) || 0} points)`, Number(row.referral_points_amount) ? -Number(row.referral_points_amount) : 0],
  ].filter(([, v]) => Number(v));

  const fareTotal = Number(row.total_dcharge || row.d_charge || 0);
  const coinsAmount = Number(row.referral_points_amount) || 0;
  const couponAmount = Number(row.cou_amt) || 0;
  const coinsPoints = Number(row.referral_points_used) || 0;
  // Coins pay part of the fare without touching the wallet/cash, so the
  // customer's actual payable is the fare minus the coins value.
  const total = Math.max(0, fareTotal - coinsAmount - couponAmount).toFixed(2);

  return {
    row, bookingId, orderDate, status: String(row.o_status || "Pending"),
    riderName, riderVehicleNo, riderRating, paymentMethodName,
    charges, fareTotal, coinsAmount, coinsPoints, total,
  };
}

// --- invoice.php --- (renders a simple styled HTML invoice, token-gated)
async function renderInvoice(req, res) {
  const link = verifyInvoiceLink(req.query);
  if (!link) {
    return res.status(400).send("Invalid or expired invoice link.");
  }
  const { orderId, uid, expiresAt, token } = link;

  try {
    const data = await loadInvoiceData(uid, orderId);
    if (!data) return res.status(404).send("Invoice not found.");
    const { row, bookingId, orderDate, riderName, riderVehicleNo, riderRating, paymentMethodName, charges, fareTotal, coinsAmount, coinsPoints, total } = data;

    const statusRaw = String(row.o_status || "").toLowerCase();
    const isGood = statusRaw === "completed" || statusRaw === "delivered";
    const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    // Same-origin relative link: /api/order/invoice -> /api/order/invoice.pdf
    const pdfHref = `invoice.pdf?order_id=${orderId}&uid=${uid}&exp=${expiresAt}&token=${token}`;

    const initials = (riderName || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "?";

    const chargeRows = charges
      .map(([label, v]) => {
        const neg = Number(v) < 0;
        return `<div class="fare-row">
          <span class="fare-label"><i class="dot${neg ? " dot--credit" : ""}"></i>${esc(label)}</span>
          <span class="fare-amt${neg ? " fare-amt--credit" : ""}">${neg ? "-" : ""}₹${Math.abs(Number(v)).toFixed(2)}</span>
        </div>`;
      })
      .join("");

    const coinsNote = coinsAmount > 0
      ? `<div class="paid-via" style="text-align:left;line-height:1.5">Coins: you redeemed ${coinsPoints} referral points worth ₹${coinsAmount.toFixed(2)} against this ride. The trip fare was ₹${fareTotal.toFixed(2)}; the coins value is deducted from it, so you pay ₹${total}.</div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Invoice - ${esc(bookingId)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #262220; --ink-muted: #756b62; --ink-faint: #a89e93;
    --paper: #faf9f7; --page: #efece6; --line: #e7e1d8;
    --brand: #c2540a; --brand-soft: #fdf0e6;
    --good: #1e9e4d; --good-soft: #e8f7ee; --warn: #e08e00; --warn-soft: #fff6e5;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans', 'Segoe UI', system-ui, Arial, sans-serif;
    background: var(--page); margin: 0; padding: 28px 14px; color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace; }

  .ticket { max-width: 420px; margin: 0 auto; background: var(--paper); border-radius: 18px;
    box-shadow: 0 1px 2px rgba(38,34,32,0.04), 0 12px 28px rgba(38,34,32,0.08); overflow: hidden; }

  .head { padding: 22px 24px 18px; text-align: center; }
  .head .brand-mark { font-size: 15px; font-weight: 700; letter-spacing: 0.01em; color: var(--ink); }
  .head .brand-mark span { color: var(--brand); }
  .status { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 5px 14px;
    border-radius: 999px; font-size: 12.5px; font-weight: 600;
    color: ${isGood ? "var(--good)" : "var(--warn)"}; background: ${isGood ? "var(--good-soft)" : "var(--warn-soft)"}; }
  .status i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }

  .meta { display: flex; justify-content: space-between; padding: 0 24px 20px; font-size: 12.5px; color: var(--ink-muted); }
  .meta strong { display: block; margin-top: 2px; font-size: 13px; color: var(--ink); font-weight: 600; }
  .meta .right { text-align: right; }

  .perf { position: relative; height: 0; border-top: 1.5px dashed var(--line); margin: 0 0; }
  .perf::before, .perf::after { content: ""; position: absolute; top: -10px; width: 20px; height: 20px;
    border-radius: 50%; background: var(--page); }
  .perf::before { left: -10px; } .perf::after { right: -10px; }

  .section { padding: 22px 24px; }
  .section-label { font-size: 11px; font-weight: 600; color: var(--ink-faint); margin-bottom: 14px; }

  .route { position: relative; padding-left: 18px; }
  .route .pin { position: absolute; left: 0; width: 9px; height: 9px; border-radius: 50%; }
  .route .pin--from { top: 3px; background: var(--good); }
  .route .pin--to { bottom: 3px; background: var(--brand); }
  .route .stem { position: absolute; left: 3.5px; top: 13px; bottom: 13px; width: 2px;
    background: linear-gradient(to bottom, var(--good), var(--brand)); opacity: 0.35; }
  .route .stop { font-size: 13.5px; line-height: 1.45; color: var(--ink); margin-bottom: 20px; }
  .route .stop:last-child { margin-bottom: 0; }
  .route .stop-label { display: block; font-size: 11.5px; color: var(--ink-faint); margin-bottom: 2px; }

  .driver { display: flex; align-items: center; gap: 12px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
  .driver .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--brand-soft); color: var(--brand);
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
  .driver .name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .driver .sub { font-size: 12px; color: var(--ink-muted); margin-top: 1px; }

  .fare-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 13px; }
  .fare-label { display: flex; align-items: center; gap: 8px; color: var(--ink-muted); }
  .fare-label .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-faint); }
  .fare-label .dot--credit { background: var(--good); }
  .fare-amt { font-weight: 500; color: var(--ink); }
  .fare-amt--credit { color: var(--good); }

  .total-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px;
    padding: 14px 16px; border-radius: 12px; background: var(--brand-soft); }
  .total-row .label { font-size: 13px; font-weight: 600; color: var(--ink); }
  .total-row .amt { font-size: 19px; font-weight: 600; color: var(--brand); }
  .paid-via { margin-top: 10px; font-size: 12px; color: var(--ink-muted); text-align: right; }

  .actions { padding: 0 24px 6px; text-align: center; }
  .dl-btn { display: inline-block; width: 100%; padding: 12px 16px; border: 0; border-radius: 12px; cursor: pointer;
    background: var(--brand); color: #fff; font: 600 14px 'IBM Plex Sans', 'Segoe UI', system-ui, Arial, sans-serif;
    text-decoration: none; }
  .dl-btn[aria-busy="true"] { opacity: 0.6; pointer-events: none; }
  .dl-err { margin-top: 8px; font-size: 12px; color: #c0392b; min-height: 1em; }
  @media print { .actions { display: none; } body { background: #fff; padding: 0; } .ticket { box-shadow: none; } }

  .footer { text-align: center; padding: 18px 24px 22px; font-size: 12px; color: var(--ink-faint); }
  .footer .thanks { font-size: 13px; color: var(--ink-muted); margin-bottom: 4px; }
</style></head>
<body>
  <div class="ticket">
    <div class="head">
      <div class="brand-mark">Shifter <span>Online</span></div>
      <div class="status"><i></i>${esc(row.o_status || "Pending")}</div>
    </div>
    <div class="meta">
      <div>Booking ID<strong class="mono">${esc(bookingId)}</strong></div>
      <div class="right">Date<strong>${esc(orderDate)}</strong></div>
    </div>

    <div class="perf"></div>

    <div class="section">
      <div class="route">
        <div class="pin pin--from"></div>
        <div class="stem"></div>
        <div class="pin pin--to"></div>
        <div class="stop"><span class="stop-label">Pickup</span>${esc(row.paddress)}</div>
        <div class="stop"><span class="stop-label">Drop</span>${esc(row.daddress)}</div>
      </div>
      ${riderName ? `<div class="driver">
        <div class="avatar">${esc(initials)}</div>
        <div>
          <div class="name">${esc(riderName)}</div>
          <div class="sub">★ ${esc(riderRating)}${riderVehicleNo ? ` · ${esc(riderVehicleNo)}` : ""}</div>
        </div>
      </div>` : ""}
    </div>

    <div class="perf"></div>

    <div class="section">
      <div class="section-label">Fare breakdown</div>
      ${chargeRows || `<div class="fare-row"><span class="fare-label"><i class="dot"></i>Trip fare</span><span class="fare-amt mono">₹${total}</span></div>`}
      <div class="total-row">
        <span class="label">Total paid</span>
        <span class="amt mono">₹${total}</span>
      </div>
      <div class="paid-via">Paid via ${esc(paymentMethodName)}</div>
      ${coinsNote}
    </div>

    <div class="actions">
      <a class="dl-btn" id="dl-pdf" href="${esc(pdfHref)}" download="Invoice-${esc(bookingId)}.pdf">Download PDF</a>
      <div class="dl-err" id="dl-err" role="alert"></div>
    </div>

    <div class="footer">
      <div class="thanks">Thanks for riding with Shifter.</div>
      Generated ${esc(generatedAt)}
    </div>
  </div>
<script>
  // Fetch the PDF so a failure shows a message here instead of navigating
  // away to a bare error page. If fetch/blob is unavailable the plain href
  // above still downloads it.
  (function () {
    var btn = document.getElementById("dl-pdf"), err = document.getElementById("dl-err");
    if (!btn || !window.fetch || !window.URL || !URL.createObjectURL) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      err.textContent = "";
      btn.setAttribute("aria-busy", "true");
      var label = btn.textContent; btn.textContent = "Preparing PDF...";
      fetch(btn.getAttribute("href"), { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error("Could not generate the PDF (" + r.status + "). Please try again.");
          return r.blob();
        })
        .then(function (b) {
          var u = URL.createObjectURL(b), a = document.createElement("a");
          a.href = u; a.download = btn.getAttribute("download"); document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1000);
        })
        .catch(function (ex) { err.textContent = ex.message || "Download failed. Please try again."; })
        .then(function () { btn.removeAttribute("aria-busy"); btn.textContent = label; });
    });
  })();
</script>
</body></html>`;

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    logger.error("renderInvoice failed:", err);
    return res.status(500).send("Internal server error");
  }
}

// PDFKit's built-in fonts have no rupee glyph, so amounts print as "Rs.".
const money = (n) => `Rs. ${Math.abs(Number(n)).toFixed(2)}`;

function drawInvoicePdf(doc, d) {
  const L = 50, R = doc.page.width - 50, W = R - L;
  const ink = "#262220", muted = "#756b62", brand = "#c2540a", line = "#e7e1d8";
  const rule = () => { doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(line).lineWidth(1).stroke(); doc.moveDown(0.8); };
  const row = (label, value, opts = {}) => {
    const y = doc.y;
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size || 11).fillColor(opts.color || ink);
    doc.text(label, L, y, { width: W * 0.6 });
    const h = doc.y - y;
    doc.text(value, L + W * 0.6, y, { width: W * 0.4, align: "right" });
    doc.y = y + Math.max(h, doc.currentLineHeight()) + 4;
  };
  const section = (title, body) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(muted).text(title, L, doc.y);
    doc.font("Helvetica").fontSize(11).fillColor(ink).text(body, L, doc.y, { width: W });
    doc.moveDown(0.6);
  };

  doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text("Shifter ", L, 50, { continued: true }).fillColor(brand).text("Online");
  doc.font("Helvetica").fontSize(10).fillColor(muted).text("Trip Invoice", L, 54, { width: W, align: "right" });
  doc.y = 90;
  rule();

  row("Booking ID", d.bookingId, { bold: true });
  row("Date", d.orderDate || "-");
  row("Status", d.status);
  row("Payment method", d.paymentMethodName);
  doc.moveDown(0.6); rule();

  section("PICKUP", d.row.paddress || "-");
  section("DROP", d.row.daddress || "-");
  if (d.riderName) {
    section("DRIVER", `${d.riderName}${d.riderVehicleNo ? `  |  ${d.riderVehicleNo}` : ""}  |  Rating ${d.riderRating}`);
  }
  doc.moveDown(0.2); rule();

  doc.font("Helvetica-Bold").fontSize(10).fillColor(muted).text("FARE BREAKDOWN", L, doc.y);
  doc.moveDown(0.5);
  if (d.charges.length) {
    for (const [label, v] of d.charges) {
      const neg = Number(v) < 0;
      row(label, `${neg ? "-" : ""}${money(v)}`, { color: neg ? "#1e9e4d" : ink });
    }
  } else {
    row("Trip fare", money(d.total));
  }
  doc.moveDown(0.4); rule();
  row("Total paid", money(d.total), { bold: true, size: 14, color: brand });
  if (d.coinsAmount > 0) {
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9).fillColor(muted).text(
      `Coins: you redeemed ${d.coinsPoints} referral points worth ${money(d.coinsAmount)} against this ride. The trip fare was ${money(d.fareTotal)}; the coins value is deducted from it, so you pay ${money(d.total)}.`,
      L, doc.y, { width: W });
  }

  // Footer stays above the bottom margin: text drawn below it makes PDFKit
  // add a blank second page.
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(
    `Thanks for riding with Shifter. Generated ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
    L, doc.page.height - 90, { width: W, align: "center" });
}

// --- PDF download of the same invoice, behind the same signed link ---
async function downloadInvoicePdf(req, res) {
  const link = verifyInvoiceLink(req.query);
  if (!link) {
    return res.status(400).send("Invalid or expired invoice link.");
  }

  try {
    const data = await loadInvoiceData(link.uid, link.orderId);
    if (!data) return res.status(404).send("Invoice not found.");

    // Render fully into memory first so a mid-render failure still returns a
    // clean 500 instead of a truncated file the customer thinks is real.
    const buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${data.bookingId}`, Author: "Shifter Online" } });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      try {
        drawInvoicePdf(doc, data);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice-${data.bookingId}.pdf"`,
      "Content-Length": buffer.length,
      "Cache-Control": "private, no-store",
    });
    return res.status(200).send(buffer);
  } catch (err) {
    logger.error("downloadInvoicePdf failed:", err);
    return res.status(500).send("Could not generate the invoice PDF. Please try again.");
  }
}

module.exports = { generateInvoiceUrl, renderInvoice, downloadInvoicePdf, verifyInvoiceLink, loadInvoiceData, drawInvoicePdf };
