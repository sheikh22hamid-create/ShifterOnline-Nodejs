/// Turns a number as it appears in a phone book ("+91 98765-43210",
/// "098765 43210", "(0731) 2345678"...) into the plain 10-digit mobile number
/// the booking forms store. Returns an empty string when nothing usable is left.
String normalizeIndianMobile(String? raw) {
  if (raw == null) return '';
  var digits = raw.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return '';
  // 00 international prefix (0091...) -> drop it
  if (digits.startsWith('00') && digits.length > 10) digits = digits.substring(2);
  // country code 91 in front of a 10-digit number
  if (digits.length == 12 && digits.startsWith('91')) return digits.substring(2);
  // trunk prefix 0 in front of a 10-digit number
  if (digits.length == 11 && digits.startsWith('0')) return digits.substring(1);
  // Anything longer: keep the last 10 digits (the subscriber number)
  if (digits.length > 10) return digits.substring(digits.length - 10);
  return digits;
}
