/// Validation for the "Schedule Booking" date/time picker — kept as a pure
/// function (no BuildContext, no side effects) so it's unit-testable without
/// a widget harness. See docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md §4.
class ScheduleTimeValidation {
  /// Used until/unless the admin-configured value (Settings > Scheduled Rides >
  /// "Minimum advance booking time", served by /api/order/scheduled-settings)
  /// is available, e.g. the request failed.
  static const defaultMinLeadMinutes = 45;
  static const maxLead = Duration(days: 7);

  static String? validate(
    DateTime picked, {
    DateTime? now,
    int minLeadMinutes = defaultMinLeadMinutes,
  }) {
    final effectiveNow = now ?? DateTime.now();
    final lead = picked.difference(effectiveNow);
    if (lead < Duration(minutes: minLeadMinutes)) {
      return 'Please pick a time at least $minLeadMinutes minutes from now.';
    }
    if (lead > maxLead) {
      return 'Please pick a date within the next 7 days.';
    }
    return null;
  }
}
