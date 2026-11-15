/// Local GSTIN format + check-digit validation, only to give the customer instant feedback before the server is asked (the
/// server repeats it and then verifies the number with the GST provider). Same rules as the backend's gstinRules.js.
library;

const String _chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
final RegExp _format = RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
const Set<String> _stateCodes = {
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '97', '99',
};

/// Upper-case with spaces and dashes removed.
String normalizeGstin(String? input) => (input ?? '').toUpperCase().replaceAll(RegExp(r'[\s-]'), '');

/// The check character a valid GSTIN ends with, for its first 14 characters.
String gstinCheckChar(String first14) {
  var sum = 0;
  for (var i = 0; i < 14; i++) {
    final value = _chars.indexOf(first14[i]);
    final product = value * (i.isEven ? 1 : 2);
    sum += product ~/ 36 + product % 36;
  }
  return _chars[(36 - sum % 36) % 36];
}

/// null when [input] is a well-formed GSTIN (format, state code and check digit), else a short message for the customer.
/// An empty value is not an error here: GST is optional, so callers only call this once something was typed.
String? gstinProblem(String? input) {
  final gstin = normalizeGstin(input);
  if (gstin.length != 15) return 'A GSTIN has 15 characters.';
  if (!_format.hasMatch(gstin)) return 'This is not a valid GSTIN format.';
  if (!_stateCodes.contains(gstin.substring(0, 2))) return 'The state code in this GSTIN is not valid.';
  if (gstinCheckChar(gstin.substring(0, 14)) != gstin[14]) return 'This GSTIN is not valid (check digit does not match).';
  return null;
}
