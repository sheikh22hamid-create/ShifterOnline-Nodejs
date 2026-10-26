import 'package:get_storage/get_storage.dart';
import '../../Api/Api_wrapper.dart';

/// Customise Order (negotiated job) calls. Every response is { Result: bool, msg: String, ... }; a failed call or
/// an unreachable server comes back as Result:false with a message that can be shown to the customer as is.
class CustomiseApi {
  static const String _base = 'api/users/customise/';

  /// Ride ids the app has already opened the advance-payment screen for, so the Customise screen and Bottombar's
  /// app-wide listener never both push TrackingWay for the same assignment.
  static final Set<String> _routed = <String>{};
  static bool claimRouting(String rideId) => _routed.add(rideId);

  static int get uid {
    final store = GetStorage();
    final raw = store.read('Uid') ?? store.read('UserLogin')?['id'];
    return raw is int ? raw : int.tryParse('$raw') ?? 0;
  }

  static Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    try {
      final res = await ApiWrapper.dataPostNode('$_base$path', {'user_id': uid, ...body});
      if (res is Map) return Map<String, dynamic>.from(res);
    } catch (_) {}
    return {'Result': false, 'msg': 'Something went wrong. Please try again.'};
  }

  static bool ok(Map<String, dynamic> r) => r['Result'] == true || r['Result'] == 'true';

  static String message(Map<String, dynamic> r) {
    final errors = r['errors'];
    if (errors is List && errors.isNotEmpty) return errors.join('\n');
    return (r['msg'] ?? 'Something went wrong. Please try again.').toString();
  }

  static Future<Map<String, dynamic>> create(Map<String, dynamic> order) => _post('create', order);
  static Future<Map<String, dynamic>> mine() => _post('my', {});
  static Future<Map<String, dynamic>> detail(int orderId) => _post('detail', {'order_id': orderId});
  static Future<Map<String, dynamic>> acceptOffer(int orderId, int offerId) => _post('accept-offer', {'order_id': orderId, 'offer_id': offerId});
  static Future<Map<String, dynamic>> rejectOffer(int orderId, int offerId) => _post('reject-offer', {'order_id': orderId, 'offer_id': offerId});
  static Future<Map<String, dynamic>> cancel(int orderId) => _post('cancel', {'order_id': orderId});
}
