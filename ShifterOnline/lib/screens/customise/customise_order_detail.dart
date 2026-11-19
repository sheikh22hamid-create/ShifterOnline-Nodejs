// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_buttons.dart';
import '../../theme/widgets/app_skeleton.dart';
import '../../theme/widgets/app_top_bar.dart';
import '../../theme/widgets/route_marker.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../../utils/node_socket_manager.dart';
import '../myorder/trackingway.dart';
import 'customise_api.dart';
import 'customise_ui.dart';

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


  Widget _line(String label, String? value) {
    final p = AppPalette.current;
    if (value == null || value.isEmpty || value == 'null') return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 110, child: Text(label.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13))),
        Expanded(child: Text(value, style: AppText.body(p.ink).copyWith(fontSize: 13.5))),
      ]),
    );
  }

  Widget _place(Widget marker, String text) {
    final p = AppPalette.current;
    if (text.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        marker,
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: AppText.body(p.ink).copyWith(fontSize: 13.5, height: 1.35))),
      ]),
    );
  }

  Widget _offerTile(Map<String, dynamic> o, bool canDecide) {
    final p = AppPalette.current;
    final accepted = o['kind'] == 'accept';
    final name = '${o['driver_name'] ?? 'Driver'}';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.input),
        border: Border.all(color: accepted ? p.success : p.line, width: accepted ? 1.5 : 1),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
            child: Text(name.isEmpty ? 'D' : name[0].toUpperCase(), style: AppText.bodyStrong(p.brandText)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong(p.ink)),
              if (o['vehicle'] != null) Text('${o['vehicle']}', style: AppText.caption(p.inkMuted)),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('₹${o['amount']}', style: AppText.title(p.ink).copyWith(fontSize: 20)),
            Text((accepted ? 'Accepted your price' : 'Counter offer').tr,
                style: AppText.caption(accepted ? p.successText : p.brandText).copyWith(fontFamily: 'Gilroy_Bold')),
          ]),
        ]),
        if (canDecide)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Row(children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: p.ink,
                    side: BorderSide(color: p.line),
                    minimumSize: const Size(0, 46),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.input)),
                  ),
                  onPressed: _busy ? null : () => _decide(o, false),
                  child: Text('Reject'.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: AppPrimaryButton(
                  label: '${'Accept'.tr} ₹${o['amount']}',
                  onPressed: _busy ? null : () => _decide(o, true),
                ),
              ),
            ]),
          ),
      ]),
    );
  }

  Widget _statusHero(String status, Map<String, dynamic>? o) {
    final p = AppPalette.current;
    final (fg, bg) = CustomiseStatus.colors(status);
    final info = CustomiseStatus.of(status);
    final agreed = o?['agreed_fare'];
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: p.surface, borderRadius: BorderRadius.circular(AppRadius.card), boxShadow: AppShadow.card),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(
              status == 'converted'
                  ? Icons.check_circle_rounded
                  : status == 'open'
                      ? Icons.campaign_rounded
                      : status == 'scheduled'
                          ? Icons.schedule_rounded
                          : Icons.block_rounded,
              color: fg,
              size: 24,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(info.label.tr, style: AppText.section(p.ink)),
              if (info.hint.isNotEmpty) Text(info.hint.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 12.5)),
            ]),
          ),
        ]),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Your price'.tr, style: AppText.caption(p.inkMuted)),
              Text('₹${o?['initial_fare']}', style: AppText.title(p.ink).copyWith(fontSize: 22)),
            ]),
          ),
          if (agreed != null && '$agreed' != 'null')
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text('Agreed price'.tr, style: AppText.caption(p.inkMuted)),
              Text('₹$agreed', style: AppText.title(p.successText).copyWith(fontSize: 22)),
            ]),
        ]),
        const SizedBox(height: 8),
        _line('Offers open from', _when(o?['bargain_start_at'])),
        _line('Offers close at', _when(o?['expires_at'])),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final p = AppPalette.current;
    final o = _order;
    final status = o?['status']?.toString() ?? '';
    final live = status == 'open' || status == 'scheduled';
    final goods = (o?['goods'] as Map?) ?? {};
    final stops = (o?['stops'] as List?) ?? [];
    final pickup = (o?['pickup'] as Map?) ?? {};
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(title: 'Customise Order'.tr, subtitle: '${'Order'.tr} #${widget.orderId}'),
      bottomNavigationBar: live && o != null
          ? Material(
              color: p.surface,
              child: SafeArea(
                top: false,
                child: Center(
                  heightFactor: 1,
                  child: TextButton(
                    style: TextButton.styleFrom(foregroundColor: p.danger, minimumSize: const Size(160, 48)),
                    onPressed: _cancel,
                    child: Text('Cancel order'.tr, style: AppText.bodyStrong(p.danger).copyWith(fontSize: 14)),
                  ),
                ),
              ),
            )
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(16), children: const [
              AppSkeleton(height: 170, radius: 16),
              SizedBox(height: 12),
              AppSkeleton(height: 120, radius: 16),
            ])
          : _error != null && o == null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(_error!, textAlign: TextAlign.center, style: AppText.body(p.inkMuted)),
                  ),
                )
              : RefreshIndicator(
                  color: p.brand,
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: [
                    _statusHero(status, o),
                    CustomiseSection(
                      title: '${'Offers'.tr} (${_offers.length})',
                      subtitle: status == 'open' ? 'Accept the one you like. It becomes a normal ride at that price' : null,
                      children: [
                        if (_offers.isEmpty)
                          Row(children: [
                            if (live) ...[
                              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: p.brand)),
                              const SizedBox(width: 12),
                            ],
                            Expanded(
                              child: Text(
                                (live ? 'No offers yet. Drivers will appear here as they respond.' : 'No offers.').tr,
                                style: AppText.body(p.inkMuted).copyWith(fontSize: 13.5),
                              ),
                            ),
                          ]),
                        for (final f in _offers) _offerTile(f, status == 'open'),
                      ],
                    ),
                    CustomiseSection(title: 'Route', children: [
                      _place(const RouteMarker.pickup(size: 20),
                          '${pickup['address'] ?? ''}${pickup['exact'] == false ? ' (${'approximate'.tr})' : ''}'),
                      for (final s in stops) _place(RouteMarker.stop(int.tryParse('${s['seq']}') ?? 1, size: 20), '${s['address']}'),
                      _place(const RouteMarker.drop(size: 20), '${(o?['drop'] as Map?)?['address'] ?? ''}'),
                    ]),
                    CustomiseSection(title: 'Goods', children: [
                      _line('Goods', '${goods['description'] ?? ''}'),
                      _line('Items', '${goods['quantity'] ?? ''}'),
                      _line('Weight', goods['weight_kg'] == null ? null : '${goods['weight_kg']} kg'),
                      _line('Vehicle', o?['category']?.toString() ?? 'Any vehicle'.tr),
                    ]),
                  ]),
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
