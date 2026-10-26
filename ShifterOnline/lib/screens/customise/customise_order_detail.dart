// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../../utils/node_socket_manager.dart';
import '../myorder/trackingway.dart';
import 'customise_api.dart';

/// One Customise Order: its details, the drivers' offers (accept or reject each) and cancel while it is still open.
/// Refreshes by itself and as soon as the server pushes a new offer.
class CustomiseOrderDetail extends StatefulWidget {
  const CustomiseOrderDetail({super.key, required this.orderId});
  final int orderId;

  @override
  State<CustomiseOrderDetail> createState() => _CustomiseOrderDetailState();
}

class _CustomiseOrderDetailState extends State<CustomiseOrderDetail> {
  Map<String, dynamic>? _order;
  List<Map<String, dynamic>> _offers = [];
  String? _error;
  bool _loading = true;
  bool _busy = false;
  Timer? _timer;
  NodeSocketSubscription? _socketSub;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 8), (_) => _load(silent: true));
    // A driver who takes the customer's price converts the order straight away: open the payment screen at once.
    _socketSub = NodeSocketManager.instance.addListeners(onOrderAssigned: (data) {
      if (data['customise_order_id']?.toString() == '${widget.orderId}') _openRide(data['order_id']?.toString(), data);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _socketSub?.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    final res = await CustomiseApi.detail(widget.orderId);
    if (!mounted) return;
    if (!CustomiseApi.ok(res)) {
      setState(() {
        _loading = false;
        if (!silent || _order == null) _error = CustomiseApi.message(res);
      });
      return;
    }
    setState(() {
      _loading = false;
      _error = null;
      _order = Map<String, dynamic>.from(res['order'] as Map);
      _offers = [for (final o in (res['offers'] as List? ?? [])) Map<String, dynamic>.from(o as Map)];
    });
    final ride = _order?['pkg_order_id']?.toString();
    if (_order?['status'] == 'converted' && ride != null && ride != 'null') _openRide(ride, {'order_id': ride});
  }

  void _openRide(String? rideId, Map<String, dynamic> data) {
    if (rideId == null || rideId.isEmpty || !mounted) return;
    if (!CustomiseApi.claimRouting(rideId)) return;
    Get.off(() => TrackingWay(type: 'Pickup', initialOrderData: Map<String, dynamic>.from(data)));
  }

  Future<void> _decide(Map<String, dynamic> offer, bool accept) async {
    if (_busy) return;
    final id = int.tryParse('${offer['offer_id']}') ?? 0;
    setState(() => _busy = true);
    try {
      final res = accept ? await CustomiseApi.acceptOffer(widget.orderId, id) : await CustomiseApi.rejectOffer(widget.orderId, id);
      if (!mounted) return;
      if (!CustomiseApi.ok(res)) {
        tostmsg(CustomiseApi.message(res));
      } else if (accept) {
        final ride = res['pkg_order_id']?.toString();
        tostmsg('Driver confirmed. Please pay the advance to confirm your booking.');
        _openRide(ride, {'order_id': ride});
      }
      await _load(silent: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final sure = await Get.dialog<bool>(AlertDialog(
      title: const Text('Cancel this order?'),
      content: const Text('Drivers will no longer be able to send offers.'),
      actions: [
        TextButton(onPressed: () => Get.back(result: false), child: const Text('Keep it')),
        TextButton(onPressed: () => Get.back(result: true), child: const Text('Cancel order')),
      ],
    ));
    if (sure != true) return;
    final res = await CustomiseApi.cancel(widget.orderId);
    tostmsg(CustomiseApi.ok(res) ? 'Order cancelled.' : CustomiseApi.message(res));
    await _load(silent: true);
  }

  static const _statusText = {
    'scheduled': 'Waiting for bargaining to start',
    'open': 'Drivers can send offers',
    'converted': 'Driver confirmed',
    'expired': 'Expired, no driver was confirmed',
    'cancelled': 'Cancelled',
  };

  Widget _line(String label, String? value) => (value == null || value.isEmpty || value == 'null')
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 120, child: Text(label, style: TextStyle(color: greaycolor, fontSize: 13))),
            Expanded(child: Text(value, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 13))),
          ]),
        );

  Widget _box(String title, List<Widget> children) => Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: notifier.getContainer, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 15)),
          const SizedBox(height: 8),
          ...children,
        ]),
      );

  Widget _offerTile(Map<String, dynamic> o, bool canDecide) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(border: Border.all(color: linercolor.withOpacity(0.4)), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text('${o['driver_name'] ?? 'Driver'}${o['vehicle'] != null ? '  ·  ${o['vehicle']}' : ''}',
                  style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold')),
            ),
            Text('₹${o['amount']}', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 18)),
          ]),
          Text(o['kind'] == 'accept' ? 'Accepted your price' : 'Counter offer', style: TextStyle(color: greaycolor, fontSize: 12)),
          if (canDecide)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(children: [
                Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _decide(o, false), child: const Text('Reject'))),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: linercolor),
                    onPressed: _busy ? null : () => _decide(o, true),
                    child: const Text('Accept', style: TextStyle(color: Colors.white)),
                  ),
                ),
              ]),
            ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final o = _order;
    final status = o?['status']?.toString() ?? '';
    final live = status == 'open' || status == 'scheduled';
    final goods = (o?['goods'] as Map?) ?? {};
    final stops = (o?['stops'] as List?) ?? [];
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        backgroundColor: linercolor,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(icon: const Icon(Icons.arrow_back_ios, color: Colors.white), onPressed: () => Get.back()),
        title: Text('Customise Order #${widget.orderId}', style: const TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold', fontSize: 18)),
      ),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(color: notifier.lightBgColor, borderRadius: const BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24))),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null && o == null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: notifier.text))))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(padding: const EdgeInsets.all(16), children: [
                      _box('Status', [
                        _line('Status', _statusText[status] ?? status),
                        _line('Your price', '₹${o?['initial_fare']}'),
                        _line('Agreed price', o?['agreed_fare'] != null ? '₹${o?['agreed_fare']}' : null),
                        _line('Bargaining starts', _when(o?['bargain_start_at'])),
                        _line('Offers close', _when(o?['expires_at'])),
                      ]),
                      _box('Offers (${_offers.length})', [
                        if (_offers.isEmpty)
                          Text(live ? 'No offers yet. Drivers will appear here as they respond.' : 'No offers.', style: TextStyle(color: greaycolor)),
                        for (final f in _offers) _offerTile(f, status == 'open'),
                      ]),
                      _box('Route', [
                        _line('Pickup', '${(o?['pickup'] as Map?)?['address'] ?? ''}${(o?['pickup'] as Map?)?['exact'] == false ? ' (approximate)' : ''}'),
                        for (final s in stops) _line('Stop ${s['seq']}', '${s['address']}'),
                        _line('Drop', '${(o?['drop'] as Map?)?['address'] ?? ''}'),
                      ]),
                      _box('Goods', [
                        _line('Goods', '${goods['description'] ?? ''}'),
                        _line('Items', '${goods['quantity'] ?? ''}'),
                        _line('Weight', '${goods['weight_kg'] ?? ''} kg'),
                        _line('Vehicle', o?['category']?.toString() ?? 'Any vehicle'),
                      ]),
                      if (live)
                        OutlinedButton(
                          style: OutlinedButton.styleFrom(foregroundColor: Colors.red, side: const BorderSide(color: Colors.red)),
                          onPressed: _cancel,
                          child: const Text('Cancel order'),
                        ),
                    ]),
                  ),
      ),
    );
  }

  String? _when(dynamic iso) {
    final t = DateTime.tryParse('$iso')?.toLocal();
    if (t == null) return null;
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(t.day)}/${two(t.month)}/${t.year}  ${two(t.hour)}:${two(t.minute)}';
  }
}
