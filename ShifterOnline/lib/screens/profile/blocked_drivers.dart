import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';
import '../../../utils/colors.dart';

/// Drivers the customer has blocked (they are never offered this customer's
/// orders). Unblocking uses the same toggle endpoint as blocking.
class BlockedDriversScreen extends StatefulWidget {
  const BlockedDriversScreen({super.key});

  @override
  State<BlockedDriversScreen> createState() => _BlockedDriversScreenState();
}

class _BlockedDriversScreenState extends State<BlockedDriversScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _drivers = [];
  String? _errorMessage;
  int _maxBlocked = 0;

  late ColorNotifier notifier;

  String get _userId =>
      getdata.read("UserLogin")?["id"]?.toString() ?? getdata.read("Uid")?.toString() ?? "1";

  @override
  void initState() {
    super.initState();
    _fetchBlockedDrivers();
  }

  Future<void> _fetchBlockedDrivers() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final response = await ApiWrapper.dataPostNode(
        Config.nodeBlockedDriversList,
        {"user_id": _userId},
      );
      if (response != null && response["Result"] == true) {
        final data = response["data"];
        setState(() {
          _drivers = data is List ? List<Map<String, dynamic>>.from(data) : [];
          _maxBlocked = int.tryParse("${response["max_blocked"]}") ?? 0;
          _isLoading = false;
        });
      } else {
        setState(() {
          _drivers = [];
          _isLoading = false;
          _errorMessage = response?["msg"]?.toString();
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = "Something went wrong. Please try again.".tr;
      });
      debugPrint("BlockedDrivers Error: $e");
    }
  }

  Future<void> _unblock(Map<String, dynamic> driver) async {
    final riderId = driver["id"]?.toString() ?? "";
    if (riderId.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        backgroundColor: notifier.getBgColor,
        title: Text(
          "Unblock Driver".tr,
          style: TextStyle(fontFamily: "Gilroy_Bold", color: notifier.text),
        ),
        content: Text(
          "${driver["name"] ?? "This driver"} ${"can be offered your orders again.".tr}",
          style: TextStyle(fontFamily: "Gilroy_Medium", color: notifier.text.withOpacity(0.8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text("Cancel".tr, style: TextStyle(color: greaycolor, fontFamily: "Gilroy_Medium")),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: linercolor,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text("Unblock".tr, style: const TextStyle(color: Colors.white, fontFamily: "Gilroy_Bold")),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final res = await ApiWrapper.dataPostNode(Config.nodeBlockedDriversToggle, {
        "user_id": _userId,
        "rider_id": riderId,
      });
      if (res != null && res["Result"] == true && res["blocked"] == false) {
        setState(() => _drivers.removeWhere((d) => d["id"]?.toString() == riderId));
        tostmsg(res["msg"]?.toString() ?? "Driver unblocked");
      } else {
        tostmsg(res?["msg"]?.toString() ?? "Failed to unblock driver");
      }
    } catch (e) {
      tostmsg("Error unblocking driver");
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of<ColorNotifier>(context, listen: true);

    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: linercolor,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
          onPressed: () => Get.back(),
        ),
        title: Text(
          "Blocked Drivers".tr,
          style: const TextStyle(color: Colors.white, fontFamily: "Gilroy_Bold"),
        ),
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: linercolor))
          : _drivers.isEmpty
              ? _buildEmptyState()
              : RefreshIndicator(
                  color: linercolor,
                  onRefresh: _fetchBlockedDrivers,
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                    padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 15),
                    itemCount: _drivers.length + 1,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      if (index == 0) return _buildInfo();
                      return _buildDriverCard(_drivers[index - 1]);
                    },
                  ),
                ),
    );
  }

  Widget _buildInfo() {
    final limit = _maxBlocked > 0 ? " (${_drivers.length}/$_maxBlocked)" : "";
    return Text(
      "${"Blocked drivers are never offered your orders.".tr}$limit",
      style: TextStyle(
        fontFamily: "Gilroy_Medium",
        fontSize: 12.5,
        color: notifier.text.withOpacity(0.6),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.block_rounded, size: 80, color: linercolor.withOpacity(0.4)),
            const SizedBox(height: 16),
            Text(
              "No Blocked Drivers".tr,
              style: TextStyle(fontFamily: "Gilroy_Bold", fontSize: 18, color: notifier.text),
            ),
            const SizedBox(height: 8),
            Text(
              _errorMessage ?? "Drivers you block will appear here.".tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: "Gilroy_Medium",
                fontSize: 14,
                color: notifier.text.withOpacity(0.5),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDriverCard(Map<String, dynamic> driver) {
    final String name = driver["name"]?.toString() ?? "Unknown";
    final String vehicle = driver["vehicle"]?.toString() ?? "";
    final String initials = name.isNotEmpty
        ? name.trim().split(" ").map((e) => e.isNotEmpty ? e[0] : "").take(2).join().toUpperCase()
        : "?";

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Row(
        children: [
          Container(
            height: 50,
            width: 50,
            decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.grey.shade300),
            child: Center(
              child: Text(
                initials,
                style: TextStyle(color: Colors.grey.shade700, fontFamily: "Gilroy_Bold", fontSize: 17),
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15, color: notifier.text),
                ),
                if (vehicle.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.two_wheeler_outlined, size: 14, color: notifier.text.withOpacity(0.6)),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          vehicle,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: "Gilroy_Medium",
                            fontSize: 13,
                            color: notifier.text.withOpacity(0.6),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          OutlinedButton(
            onPressed: () => _unblock(driver),
            style: OutlinedButton.styleFrom(
              side: BorderSide(color: linercolor),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: Text(
              "Unblock".tr,
              style: TextStyle(color: linercolor, fontFamily: "Gilroy_Bold", fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}
