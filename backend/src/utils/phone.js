// Shared phone normalization used everywhere a contact/mobile number needs
// to be matched against tbl_driver_lead.phone. This app serves only Indian
// 10-digit mobile numbers, but callers (contact-book imports, signup forms)
// may submit numbers with a country-code prefix (+91/91) or other
// non-digit formatting. Normalizing to the last 10 digits keeps every call
// site matching leads consistently regardless of how the number arrived.
function normalizeToLast10Digits(raw) {
  const digitsOnly = String(raw || "").replace(/\D/g, "");
  return digitsOnly.slice(-10);
}

module.exports = { normalizeToLast10Digits };
