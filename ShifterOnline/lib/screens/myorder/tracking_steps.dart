/// Which hero-stepper step is active on the tracking screen (1 Assigned · 2 Picked Up · 3 In Transit ·
/// 4 Delivered; 5 = all done). While a driver is still being searched, nothing is active: showing
/// "Assigned" before anyone accepted is not true.
int heroStepIndex(String? status, {required bool searching}) {
  final s = (status ?? '').toLowerCase().trim();
  if (s == 'completed') return 5;
  if (searching) return 0;
  if (s == 'on route' || s == 'on_route' || s == 'intransit' || s == 'in transit') return 3;
  if (s == 'pickup' || s == 'picked up' || s == 'picked_up') return 2;
  return 1;
}
