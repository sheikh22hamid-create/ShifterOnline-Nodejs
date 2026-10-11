// Placeholder so dispatchManager can require the module; Task 7 replaces it with the real implementation.
async function previewForOffer() {
  return { pct: 0, amount: 0 };
}
async function onMiss() {
  return { applied: false };
}
module.exports = { previewForOffer, onMiss };
