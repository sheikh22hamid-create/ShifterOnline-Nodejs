export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeMobile(input) {
  if (!input) return '';
  let cleaned = String(input).trim().replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

export function isValidMobile(input) {
  const normalized = normalizeMobile(input);
  return /^[6-9]\d{9}$/.test(normalized);
}

export function isValidEmail(input) {
  if (!input) return false;
  return EMAIL_RE.test(String(input).trim().toLowerCase());
}
