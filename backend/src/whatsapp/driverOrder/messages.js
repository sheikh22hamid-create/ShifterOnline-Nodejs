// WhatsApp Trial Order (spec 2026-11-17, section 3): every message the bot sends a WhatsApp-channel driver.
// Hinglish, one next step per message, and every message ends with the helpline line. Pure string builders.

const { cashPayable } = require("./stepResolver");

const HELPLINE = "📞 Help: 9109114515";
const DEFAULT_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.driver";

const withHelp = (body) => `${body}\n\n${HELPLINE}`;
const stripHelp = (text) => String(text).replace(new RegExp(`\\s*${HELPLINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "");

/** Several messages sent as one: the helpline line appears once, at the end. */
function join(...parts) {
  return withHelp(parts.filter(Boolean).map(stripHelp).join("\n\n"));
}

const rupees = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `₹${Number.isInteger(v) ? v : v.toFixed(2)}`;
};

function mapsLink(lat, lng) {
  const la = Number(lat), lo = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${la},${lo}`;
}

function place(label, { name, phone, address, lat, lng }) {
  const who = [name, phone].filter(Boolean).join(" - ");
  return [`*${label}:*${who ? ` ${who}` : ""}`, address || null, mapsLink(lat, lng)].filter(Boolean).join("\n");
}

const pickupPlace = (o) => place("Pickup", { name: o.pick_name, phone: o.pmobile, address: o.paddress, lat: o.plat, lng: o.plong });
const dropPlace = (o) => place("Drop", { name: o.drop_name, phone: o.dmobile, address: o.daddress, lat: o.dlat, lng: o.dlong });
const stopPlace = (s, n) => place(`Stop ${n}`, {
  name: s?.contact_name, phone: s?.contact_number, address: [s?.hno, s?.address, s?.landmark].filter(Boolean).join(", "), lat: s?.lat, lng: s?.lng,
});

function orderCard(order, stops = [], rider = null) {
  const lines = [
    `${rider?.full_name ? `Namaste ${rider.full_name}! ` : ""}🆕 *Shifter Order #${order.id}*`,
    `Fare: ${rupees(order.total_dcharge)}`,
    "",
    pickupPlace(order),
    ...stops.flatMap((s, i) => ["", stopPlace(s, i + 1)]),
    "",
    dropPlace(order),
    "",
    "📡 Apni WhatsApp *Live Location* (8 ghante) is number pe share karein.",
    "Har step ke baad bot aapko agla kaam batayega - jawab mein sirf number bhejein.",
  ];
  return withHelp(lines.join("\n"));
}

function stepBody(stepKey, ctx = {}) {
  const order = ctx.order || {};
  const n = ctx.step?.stopNumber;
  switch (stepKey) {
    case "go_pickup":
      return `🚚 Pickup pe jaayein:\n${pickupPlace(order)}\n\nPickup pe pahunch kar *1* bhejein.\n(Order cancel karna ho to *CANCEL* bhejein)`;
    case "pickup_otp":
      return "🔑 Customer se *Pickup OTP* lekar yahan bhejein (sirf number).";
    case "loading":
      return "📦 Maal load hone ke baad *2* bhejein.";
    case "go_stop":
      return `🚚 Stop ${n} pe jaayein:\n${stopPlace(ctx.stops?.[n - 1], n)}\n\nStop ${n} pe pahunch kar *3* bhejein.`;
    case "at_stop":
      return `📦 Stop ${n} ka kaam hone par *4* bhejein.`;
    case "go_drop":
      return `🚚 Drop pe jaayein:\n${dropPlace(order)}\n\nDrop pe pahunch kar *5* bhejein.`;
    case "at_drop":
      return "📦 Maal utarne ke baad *6* bhejein.";
    case "drop_otp":
      return "🔑 Maal utarne ke baad receiver se *Drop OTP* lekar yahan bhejein (sirf number).";
    case "await_cash":
      return `💵 Customer se ${rupees(cashPayable(ctx.settlement))} cash mila? Cash milne par *PAISA MILA* bhejein.`;
    case "cancelled":
      return stripHelp(cancelled());
    case "done":
      return stripHelp(appNudge());
    default:
      return "⚠️ Is order ka status abhi bot se aage nahi badh sakta. Kripya helpline pe call karein.";
  }
}

function stepPrompt(stepKey, ctx) {
  return withHelp(stepBody(stepKey, ctx));
}

function invalidReply(stepKey, ctx) {
  return withHelp(`❓ Ye jawab abhi nahi chalega.\n\n${stepBody(stepKey, ctx)}`);
}

function backendRefused(msg, stepKey, ctx) {
  return withHelp(`❌ ${msg || "Ye step abhi nahi ho saka."}\n\n${stepBody(stepKey, ctx)}`);
}

function cancelConfirm() {
  return withHelp("⚠️ Kya aap ye order cancel karna chahte hain? Pakka karne ke liye *HAAN* bhejein.\nOrder jaari rakhna hai to apna agla step bhejein.");
}

function cancelled() {
  return withHelp("❌ Ye order cancel ho gaya hai. Is order ke liye aage kuch nahi karna hai.");
}

function cancelRequested() {
  return withHelp("📝 Aapki cancel request admin ko bhej di gayi hai. Approve hone tak order aapke paas hi hai - agla step jaari rakhein.");
}

function earlyDropConfirm({ distance_m, old_fare, new_fare } = {}) {
  return withHelp([
    `⚠️ Aap drop location se ${Math.round(Number(distance_m) || 0)} m door hain.`,
    `Yahin trip khatam karne par fare ${rupees(old_fare)} se ${rupees(new_fare)} ho jayega.`,
    "Yahin khatam karna hai to *HAAN* bhejein. Nahi to drop location pe pahunch kar dobara bhejein.",
  ].join("\n"));
}

// amountDue: the pending cash settlement's amount (driver must confirm with PAISA MILA), or null.
// walletCredit: what was credited to the driver's wallet for this order (online / wallet-paid), or null.
function completed({ final_fare, isCash, amountDue = null, walletCredit = null } = {}) {
  const lines = [`✅ Order complete! Final fare: ${rupees(final_fare)}.`];
  if (isCash && amountDue != null) {
    lines.push(`💵 Customer se ${rupees(amountDue)} cash lein. Cash milne par *PAISA MILA* bhejein.`);
  } else if (isCash) {
    lines.push("💵 Customer se payment lein.");
  } else if (walletCredit != null) {
    lines.push(`💰 ${rupees(walletCredit)} aapke Shifter wallet mein aa gaye hain.`);
  } else {
    lines.push("💰 Payment online hua hai - aapki kamai aapke Shifter wallet mein dikhegi.");
  }
  return withHelp(lines.join("\n"));
}

function cashThanks() {
  return withHelp("🙏 Dhanyavaad! Cash payment confirm ho gaya.");
}

function appNudge() {
  const url = process.env.DRIVER_APP_DOWNLOAD_URL || DEFAULT_APP_URL;
  return withHelp([
    "📲 Shifter Driver app download karein:",
    url,
    "isi number se login karein, saare orders aur wallet app mein dikhenge.",
  ].join("\n"));
}

function pickupOtpShared(otp) {
  return join(`Customer ne Pickup OTP bheja: ${otp}. Isi ko reply mein bhejein.`);
}

module.exports = {
  HELPLINE, join, orderCard, stepPrompt, invalidReply, backendRefused, cancelConfirm, cancelled, cancelRequested,
  earlyDropConfirm, completed, cashThanks, appNudge, pickupOtpShared,
};
