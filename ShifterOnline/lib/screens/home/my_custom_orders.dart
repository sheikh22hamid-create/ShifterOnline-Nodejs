// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import 'custom_order_bid_list.dart';

class MyCustomOrders extends StatefulWidget {
  const MyCustomOrders({super.key});

  @override
  State<MyCustomOrders> createState() => _MyCustomOrdersState();
}

class _MyCustomOrdersState extends State<MyCustomOrders> {
  final getdata = GetStorage();
  List _orders = [];

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  void _loadOrders() {
    setState(() {
      _orders = getdata.read("CustomOrders") ?? [];
    });
  }

  void _deleteOrder(int index) {
    setState(() {
      _orders.removeAt(index);
      getdata.write("CustomOrders", _orders);
    });
    tostmsg("Order removed from list");
  }

  String _formatDate(String? iso) {
    if (iso == null) return '';
    try {
      final dt = DateTime.parse(iso).toLocal();
      return DateFormat('d MMM, hh:mm a').format(dt);
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        backgroundColor: linercolor,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
          onPressed: () => Get.back(),
        ),
        title: const Text(
          "My Custom Orders",
          style: TextStyle(
            color: Colors.white,
            fontFamily: 'Gilroy_Bold',
            fontSize: 18,
          ),
        ),
      ),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: _orders.isEmpty
            ? _buildEmptyState()
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 30),
                itemCount: _orders.length,
                separatorBuilder: (_, __) => const SizedBox(height: 14),
                itemBuilder: (context, i) => _buildOrderCard(_orders[i], i),
              ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: const Color(0xff7B2FF7).withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.tune_rounded, color: Color(0xff7B2FF7), size: 48),
          ),
          const SizedBox(height: 20),
          Text(
            "No Custom Orders Yet",
            style: TextStyle(
              color: notifier.text,
              fontFamily: 'Gilroy_Bold',
              fontSize: 20,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            "Create a custom order to set\nyour own price and let drivers bid.",
            textAlign: TextAlign.center,
            style: TextStyle(
              color: greaycolor,
              fontFamily: 'Gilroy_Medium',
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 28),
          ElevatedButton.icon(
            onPressed: () => Get.back(),
            icon: const Icon(Icons.add, size: 18),
            label: const Text(
              "Create Custom Order",
              style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xff7B2FF7),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              elevation: 0,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderCard(dynamic order, int index) {
    int orderId = int.tryParse(order['order_id']?.toString() ?? '0') ?? 0;
    String pickup = order['pickup']?.toString() ?? '';
    String drop = order['drop']?.toString() ?? '';
    String category = order['category']?.toString() ?? '';
    int price = int.tryParse(order['price']?.toString() ?? '0') ?? 0;
    String description = order['description']?.toString() ?? '';
    String date = _formatDate(order['created_at']?.toString());

    return Dismissible(
      key: Key('custom_order_$orderId'),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(
          color: Colors.red.withOpacity(0.12),
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Icon(Icons.delete_outline, color: Colors.red, size: 26),
      ),
      confirmDismiss: (_) async {
        return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: notifier.lightBgColor,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: Text("Remove Order?".tr,
                style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold')),
            content: Text(
              "This will only remove it from your local list. The actual order on server remains.",
              style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 13),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text("Cancel".tr, style: TextStyle(color: greaycolor)),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: Text("Remove".tr, style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold')),
              ),
            ],
          ),
        ) ?? false;
      },
      onDismissed: (_) => _deleteOrder(index),
      child: Container(
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          children: [
            // Header row
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xff7B2FF7).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.tune_rounded, color: Color(0xff7B2FF7), size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Order #$orderId",
                          style: TextStyle(
                            color: notifier.text,
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 15,
                          ),
                        ),
                        if (date.isNotEmpty)
                          Text(
                            date,
                            style: TextStyle(
                              color: greaycolor,
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  // Price badge
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: const Color(0xff7B2FF7).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      "₹$price",
                      style: const TextStyle(
                        color: Color(0xff7B2FF7),
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 14,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Divider
            Divider(height: 1, color: notifier.bordecolor),

            // Pickup / Drop
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
              child: Column(
                children: [
                  _buildAddressRow(
                    icon: Icons.radio_button_checked,
                    iconColor: Colors.green,
                    label: "Pickup".tr,
                    address: pickup,
                  ),
                  const SizedBox(height: 2),
                  Padding(
                    padding: const EdgeInsets.only(left: 10),
                    child: Container(width: 1.5, height: 16, color: greaycolor.withOpacity(0.3)),
                  ),
                  const SizedBox(height: 2),
                  _buildAddressRow(
                    icon: Icons.location_on,
                    iconColor: linercolor,
                    label: "Drop".tr,
                    address: drop,
                  ),
                ],
              ),
            ),

            // Tags row (category + description snippet)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 4, 14, 10),
              child: Row(
                children: [
                  if (category.isNotEmpty)
                    _buildTag(Icons.two_wheeler, category, Colors.blue),
                  if (category.isNotEmpty) const SizedBox(width: 8),
                  if (description.isNotEmpty)
                    Expanded(
                      child: Text(
                        description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: greaycolor,
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 12,
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // View Bids button
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {
                    Get.to(() => CustomOrderBidList(orderId: orderId));
                  },
                  icon: const Icon(Icons.gavel_rounded, size: 18),
                  label: const Text(
                    "View Bids",
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xff7B2FF7),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    elevation: 0,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAddressRow({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String address,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: iconColor, size: 16),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            address.isEmpty ? label : address,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: address.isEmpty ? greaycolor : notifier.text,
              fontFamily: 'Gilroy_Medium',
              fontSize: 13,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildTag(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 12),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontFamily: 'Gilroy_Medium',
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}
