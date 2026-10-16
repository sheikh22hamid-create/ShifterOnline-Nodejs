// Driver Performance report maths (spec 2026-10-11 section 7). Pure, no I/O.
//
// Score = 0.4 * acceptance + 0.4 * completion + 0.2 * (100 - rejectSkip)
// Status bands: Excellent >= 85, Good >= 70, Average >= 50, Poor below.

const WEIGHTS = Object.freeze({ acceptance: 0.4, completion: 0.4, noRejectSkip: 0.2 });
const BANDS = Object.freeze([
  { min: 85, status: "Excellent" },
  { min: 70, status: "Good" },
  { min: 50, status: "Average" },
  { min: 0, status: "Poor" },
]);

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (num, den) => (den > 0 ? round1((Math.min(num, den) / den) * 100) : null);

function statusForScore(score) {
  if (score == null) return "No data";
  return BANDS.find((b) => score >= b.min).status;
}

/**
 * counts: { offered, accepted, rejected, skipped, completed }
 * offered must already exclude superseded offers (a driver whose popup was live when someone else
 * took the order is never counted against them).
 */
function computeRates(counts) {
  const offered = Number(counts.offered) || 0;
  const accepted = Number(counts.accepted) || 0;
  const rejected = Number(counts.rejected) || 0;
  const skipped = Number(counts.skipped) || 0;
  const completed = Number(counts.completed) || 0;

  const acceptanceRate = pct(accepted, offered);
  const rejectionRate = pct(rejected, offered);
  const skipRate = pct(skipped, offered);
  const completionRate = pct(completed, accepted);
  const rejectSkipRate = pct(rejected + skipped, offered);

  let score = null;
  if (offered > 0) {
    // A driver who was offered orders but never accepted one has nothing to complete: 0, not "n/a".
    const completion = completionRate == null ? 0 : completionRate;
    score = round1(
      WEIGHTS.acceptance * acceptanceRate +
      WEIGHTS.completion * completion +
      WEIGHTS.noRejectSkip * (100 - rejectSkipRate)
    );
  }
  return { acceptanceRate, completionRate, rejectionRate, skipRate, score, status: statusForScore(score) };
}

module.exports = { computeRates, statusForScore, BANDS, WEIGHTS };
