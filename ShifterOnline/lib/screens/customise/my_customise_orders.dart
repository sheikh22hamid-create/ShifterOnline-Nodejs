import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_buttons.dart';
import '../../theme/widgets/app_skeleton.dart';
import '../../theme/widgets/app_top_bar.dart';
import '../../theme/widgets/route_marker.dart';
import '../../theme/widgets/v2_art.dart';
import '../../utils/colors.dart';
import 'customise_api.dart';
import 'customise_order_detail.dart';
import 'customise_order_form.dart';
import 'customise_ui.dart';

/// Entry point of the Customise Order feature: the customer's own orders, and a button to post a new one.
class MyCustomiseOrders extends StatefulWidget {
  const MyCustomiseOrders({super.key});

  @override
  State<MyCustomiseOrders> createState() => _MyCustomiseOrdersState();
}

class _MyCustomiseOrdersState extends State<MyCustomiseOrders> {
  List<Map<String, dynamic>> _orders = [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final res = await CustomiseApi.mine();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (CustomiseApi.ok(res)) {
        _error = null;
        _orders = [for (final o in (res['orders'] as List? ?? [])) Map<String, dynamic>.from(o as Map)];
      } else {
        _error = CustomiseApi.message(res);
      }
    });
  }

  Future<void> _open(Widget page) async {
    await Get.to(() => page);
    if (mounted) _load();
  }

  Widget _orderCard(Map<String, dynamic> o) {
    final p = AppPalette.current;
    final status = '${o['status']}';
    final offers = int.tryParse('${o['offer_count']}') ?? 0;
    final goods = '${o['goods_desc'] ?? ''}'.trim();
    Widget place(Widget marker, String text) => Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(children: [
            marker,
            const SizedBox(width: 10),
            Expanded(
              child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body(p.ink).copyWith(fontSize: 13.5)),
            ),
          ]),
        );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.card),
          onTap: () => _open(CustomiseOrderDetail(orderId: int.tryParse('${o['order_id']}') ?? 0)),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.card), boxShadow: AppShadow.card, color: p.surface),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(goods.isEmpty ? '${'Order'.tr} #${o['order_id']}' : goods,
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong(p.ink)),
                        Text('${'Order'.tr} #${o['order_id']}', style: AppText.caption(p.inkSubtle)),
                      ],
                    ),
                  ),
                  CustomiseStatusChip(status),
                ]),
                place(const RouteMarker.pickup(size: 18), '${o['pickup_address'] ?? ''}'),
                place(const RouteMarker.drop(size: 18), '${o['drop_address'] ?? ''}'),
                const SizedBox(height: 12),
                Divider(height: 1, color: p.divider),
                const SizedBox(height: 10),
                Row(children: [
                  Text('Your price'.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                  const SizedBox(width: 6),
                  Text('₹${o['initial_fare']}', style: AppText.bodyStrong(p.ink)),
                  const Spacer(),
                  if (offers > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(color: p.brand, borderRadius: BorderRadius.circular(20)),
                      child: Text('$offers ${(offers == 1 ? 'offer' : 'offers').tr}',
                          style: AppText.caption(p.onBrand).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 12)),
                    )
                  else
                    Text('No offers yet'.tr, style: AppText.caption(p.inkSubtle)),
                  const SizedBox(width: 4),
                  Icon(Icons.chevron_right_rounded, size: 20, color: p.inkSubtle),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _empty() {
    final p = AppPalette.current;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 120),
      children: [
        const Center(child: V2Art(asset: 'assets/v2/tile_customise.png', placeholderLabel: 'T4', width: 200, height: 133)),
        const SizedBox(height: 12),
        Text('Name your own price'.tr, textAlign: TextAlign.center, style: AppText.title(p.ink)),
        const SizedBox(height: 6),
        Text('Tell drivers what you want to pay. They accept it or offer their own price.'.tr,
            textAlign: TextAlign.center, style: AppText.body(p.inkMuted).copyWith(fontSize: 14, height: 1.4)),
        const SizedBox(height: 20),
        const CustomiseHowItWorks(),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final p = AppPalette.current;
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(title: 'Customise Orders'.tr, subtitle: 'Offer your own fare'.tr),
      bottomNavigationBar: _error == null && !_loading
          ? Material(
              color: p.surface,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  child: AppPrimaryButton(
                    label: '+  ${'New Customise Order'.tr}',
                    onPressed: () => _open(const CustomiseOrderForm()),
                  ),
                ),
              ),
            )
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(16), children: const [
              AppSkeleton(height: 150, radius: 16),
              SizedBox(height: 12),
              AppSkeleton(height: 150, radius: 16),
            ])
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.cloud_off_rounded, size: 40, color: p.inkSubtle),
                      const SizedBox(height: 10),
                      Text(_error!, textAlign: TextAlign.center, style: AppText.body(p.inkMuted)),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: () {
                          setState(() => _loading = true);
                          _load();
                        },
                        child: Text('Try again'.tr, style: AppText.bodyStrong(p.brandText)),
                      ),
                    ]),
                  ),
                )
              : RefreshIndicator(
                  color: p.brand,
                  onRefresh: _load,
                  child: _orders.isEmpty
                      ? _empty()
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                          itemCount: _orders.length,
                          itemBuilder: (_, i) => _orderCard(_orders[i]),
                        ),
                ),
    );
  }
}
