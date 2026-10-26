// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import '../../utils/colors.dart';
import 'customise_api.dart';
import 'customise_order_detail.dart';
import 'customise_order_form.dart';

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

  Color _tone(String s) => s == 'converted' ? Colors.green : (s == 'open' ? linercolor : (s == 'scheduled' ? Colors.blueGrey : Colors.red));

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        backgroundColor: linercolor,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(icon: const Icon(Icons.arrow_back_ios, color: Colors.white), onPressed: () => Get.back()),
        title: const Text('Customise Orders', style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold', fontSize: 18)),
      ),
      floatingActionButton: _error == null
          ? FloatingActionButton.extended(
              backgroundColor: linercolor,
              onPressed: () => _open(const CustomiseOrderForm()),
              icon: const Icon(Icons.add, color: Colors.white),
              label: const Text('New order', style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold')),
            )
          : null,
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(color: notifier.lightBgColor, borderRadius: const BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24))),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium'))))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _orders.isEmpty
                        ? ListView(children: [
                            const SizedBox(height: 120),
                            Center(child: Text('No Customise Orders yet.\nTap "New order" to name your price.', textAlign: TextAlign.center, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium'))),
                          ])
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
                            itemCount: _orders.length,
                            itemBuilder: (_, i) {
                              final o = _orders[i];
                              final status = '${o['status']}';
                              return InkWell(
                                onTap: () => _open(CustomiseOrderDetail(orderId: int.tryParse('${o['order_id']}') ?? 0)),
                                child: Container(
                                  margin: const EdgeInsets.only(bottom: 12),
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(color: notifier.getContainer, borderRadius: BorderRadius.circular(14)),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Expanded(child: Text('#${o['order_id']}  ${o['goods_desc']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold'))),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(color: _tone(status).withOpacity(0.12), borderRadius: BorderRadius.circular(20)),
                                        child: Text(status, style: TextStyle(color: _tone(status), fontSize: 12, fontFamily: 'Gilroy_Bold')),
                                      ),
                                    ]),
                                    const SizedBox(height: 6),
                                    Text('${o['pickup_address']}  →  ${o['drop_address']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: greaycolor, fontSize: 12)),
                                    const SizedBox(height: 8),
                                    Row(children: [
                                      Text('Your price ₹${o['initial_fare']}', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium')),
                                      const Spacer(),
                                      Text('${o['offer_count']} offer(s)', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold')),
                                    ]),
                                  ]),
                                ),
                              );
                            },
                          ),
                  ),
      ),
    );
  }
}
