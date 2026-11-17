// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:provider/provider.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';

class CustomOrderBidList extends StatefulWidget {
  final int orderId;
  const CustomOrderBidList({super.key, required this.orderId});

  @override
  State<CustomOrderBidList> createState() => _CustomOrderBidListState();
}

class _CustomOrderBidListState extends State<CustomOrderBidList> {
  final getdata = GetStorage();
  List bids = [];
  bool isLoading = true;
  bool isAssigning = false;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _fetchBids();
    // Auto-refresh every 10 seconds to get new bids
    _refreshTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted) _fetchBids();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchBids() async {
    try {
      var data = {"order_id": widget.orderId, "user_id": getdata.read("Uid") ?? ""};
      var response = await ApiWrapper.dataPostNode(Config.nodeCustomOrderBids, data);
      debugPrint("🟢 Bid List Response: $response");
      if (response != null && (response['Result'] == true || response['Result'] == "true")) {
        if (mounted) {
          setState(() {
            bids = response['bids'] ?? [];
            isLoading = false;
          });
        }
      } else {
        if (mounted) setState(() => isLoading = false);
      }
    } catch (e) {
      debugPrint("🔴 Error fetching bids: $e");
      if (mounted) setState(() => isLoading = false);
    }
  }

  Future<void> _acceptBid(int riderId, String driverName, String bidAmount) async {
    // Show confirmation dialog
    bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: notifier.lightBgColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(
          "Accept Bid",
          style: TextStyle(
            color: notifier.text,
            fontFamily: 'Gilroy_Bold',
            fontSize: 18,
          ),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Do you want to assign this order to:",
              style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 14),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: notifier.getBgColor,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: linercolor.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.person, color: linercolor, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(driverName, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 15)),
                        Text("Bid: ₹@bidAmount".trParams({"bidAmount": '$bidAmount'}), style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 14)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text("Cancel".tr, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium')),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: linercolor,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: Text("Accept".tr, style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold')),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => isAssigning = true);
    try {
      var data = {
        "order_id": widget.orderId,
        "rider_id": riderId,
      };
      var response = await ApiWrapper.dataPostNode(Config.nodeCustomOrderConvert, data);
      debugPrint("🟢 Convert Response: $response");

      if (response != null && (response['Result'] == true || response['Result'] == "true")) {
        tostmsg("Order assigned to $driverName successfully!");
        Get.back(); // Go back to home or previous screen
      } else {
        tostmsg(response?['msg'] ?? "Failed to assign order. Please try again.");
      }
    } catch (e) {
      debugPrint("🔴 Error assigning bid: $e");
      tostmsg("Something went wrong. Please try again.");
    } finally {
      if (mounted) setState(() => isAssigning = false);
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
          "Driver Bids",
          style: TextStyle(
            color: Colors.white,
            fontFamily: 'Gilroy_Bold',
            fontSize: 18,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: () {
              setState(() => isLoading = true);
              _fetchBids();
            },
            tooltip: "Refresh bids".tr,
          ),
        ],
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
        child: isAssigning
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircularProgressIndicator(color: linercolor),
                    const SizedBox(height: 16),
                    Text(
                      "Assigning order...",
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
              )
            : isLoading
                ? Center(child: CircularProgressIndicator(color: linercolor))
                : Column(
                    children: [
                      // Order ID banner
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(
                            color: linercolor.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: linercolor.withOpacity(0.25)),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.receipt_long_rounded, color: linercolor, size: 22),
                              const SizedBox(width: 10),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    "Order #${widget.orderId}",
                                    style: TextStyle(
                                      color: notifier.text,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                    "Waiting for driver bids...",
                                    style: TextStyle(
                                      color: greaycolor,
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                              const Spacer(),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.orange.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  "${bids.length} ${bids.length == 1 ? 'Bid' : 'Bids'}",
                                  style: const TextStyle(
                                    color: Colors.orange,
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      // Bids list
                      Expanded(
                        child: bids.isEmpty
                            ? _buildEmptyState()
                            : ListView.separated(
                                padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
                                itemCount: bids.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 12),
                                itemBuilder: (context, i) {
                                  final bid = bids[i];
                                  return _buildBidCard(bid);
                                },
                              ),
                      ),
                    ],
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
              color: linercolor.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.pending_actions, color: linercolor, size: 48),
          ),
          const SizedBox(height: 20),
          Text(
            "Waiting for Bids",
            style: TextStyle(
              color: notifier.text,
              fontFamily: 'Gilroy_Bold',
              fontSize: 20,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            "Drivers are reviewing your order.\nThis page auto-refreshes every 10 seconds.",
            textAlign: TextAlign.center,
            style: TextStyle(
              color: greaycolor,
              fontFamily: 'Gilroy_Medium',
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 24),
          // Animated waiting indicator
          SizedBox(
            width: 50,
            height: 50,
            child: CircularProgressIndicator(
              color: linercolor,
              strokeWidth: 3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBidCard(Map bid) {
    String driverName = bid['first_name']?.toString() ?? 'Driver';
    String vehicle = bid['vehicle']?.toString() ?? '';
    String bidAmount = bid['bid_amount']?.toString() ?? '0';
    String status = bid['status']?.toString() ?? 'pending';
    int riderId = int.tryParse(bid['rider_id']?.toString() ?? '0') ?? 0;

    // Format bid amount (remove trailing .00 if needed)
    try {
      double amt = double.parse(bidAmount);
      bidAmount = amt % 1 == 0 ? amt.toInt().toString() : amt.toStringAsFixed(2);
    } catch (_) {}

    return Container(
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
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                // Driver Avatar
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: linercolor.withOpacity(0.8),
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      driverName.isNotEmpty ? driverName[0].toUpperCase() : 'D',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),

                // Driver Info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        driverName,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(Icons.two_wheeler, color: greaycolor, size: 15),
                          const SizedBox(width: 4),
                          Text(
                            vehicle,
                            style: TextStyle(
                              color: greaycolor,
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                // Bid Amount
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: linercolor,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        "₹$bidAmount",
                        style: const TextStyle(
                          color: Colors.white,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 16,
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    _buildStatusChip(status),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 12),

            // Accept Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _acceptBid(riderId, driverName, bidAmount),
                style: ElevatedButton.styleFrom(
                  backgroundColor: linercolor,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 0,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: const [
                    Icon(Icons.check_circle_outline, size: 18),
                    SizedBox(width: 8),
                    Text(
                      "Accept This Bid",
                      style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 15,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusChip(String status) {
    Color chipColor;
    String label;
    switch (status.toLowerCase()) {
      case 'pending':
        chipColor = Colors.orange;
        label = 'Pending';
        break;
      case 'accepted':
        chipColor = Colors.green;
        label = 'Accepted';
        break;
      case 'rejected':
        chipColor = Colors.red;
        label = 'Rejected';
        break;
      default:
        chipColor = greaycolor;
        label = status;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: chipColor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: chipColor,
          fontFamily: 'Gilroy_Medium',
          fontSize: 11,
        ),
      ),
    );
  }
}
