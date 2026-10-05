const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Commission the receiver pays on top of the amount due. Base is the amount the
// receiver actually pays (fare after coupon / referral points), so it is never
// larger than what they are already being asked for.
function computeMarkup(amountDue, percent, maxAmount = 0) {
  const raw = round2(((Number(amountDue) || 0) * (Number(percent) || 0)) / 100);
  const cap = Number(maxAmount) || 0;
  return cap > 0 ? Math.min(raw, round2(cap)) : raw;
}

function receiverPayable(amountDue, markup) {
  return round2((Number(amountDue) || 0) + (Number(markup) || 0));
}

function parseCommissionPercent(raw, maxPercent) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: 0 };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, msg: "Commission percent must be a number, 0 or more." };
  if (n > Number(maxPercent)) return { ok: false, msg: `Commission cannot be more than ${maxPercent}%.` };
  return { ok: true, value: round2(n) };
}

module.exports = { round2, computeMarkup, receiverPayable, parseCommissionPercent };
