import '../../Api/AppModelApi/order_history_api_model.dart';

/// "Recently" tab: running orders and finished ones together, newest first (like Porter's one orders list).
/// The server's "recent" list holds only running orders, so a customer with none saw an empty tab.
/// An order in both lists is shown once.
List<OrderHistory> recentOrders(List<OrderHistory> running, List<OrderHistory> finished) {
  final seen = <String>{};
  final all = <OrderHistory>[
    for (final o in [...running, ...finished])
      if (seen.add(o.id ?? '${o.hashCode}')) o,
  ];
  int idOf(OrderHistory o) => int.tryParse(o.id ?? '') ?? 0;
  all.sort((a, b) => idOf(b).compareTo(idOf(a)));
  return all;
}

/// Completed or cancelled: favourite / Book Again apply only to these.
bool isFinishedOrder(OrderHistory o) {
  final s = (o.status ?? '').toLowerCase();
  return s == 'completed' || s == 'cancelled';
}
