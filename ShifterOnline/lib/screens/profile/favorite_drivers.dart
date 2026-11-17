import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';
import '../../../utils/colors.dart';

class FavoriteDriversScreen extends StatefulWidget {
  const FavoriteDriversScreen({super.key});

  @override
  State<FavoriteDriversScreen> createState() => _FavoriteDriversScreenState();
}

class _FavoriteDriversScreenState extends State<FavoriteDriversScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _drivers = [];
  String? _errorMessage;

  late ColorNotifier notifier;

  @override
  void initState() {
    super.initState();
    _fetchFavoriteDrivers();
  }

  Future<void> _fetchFavoriteDrivers() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final userId = getdata.read("UserLogin")?["id"]?.toString() ??
          getdata.read("Uid")?.toString() ??
          "1";

      final response = await ApiWrapper.dataPostNode(
        Config.nodeFavoritesList,
        {"user_id": userId},
      );

      if (response != null && response["Result"] == true) {
        final data = response["data"];
        if (data is List) {
          setState(() {
            _drivers = List<Map<String, dynamic>>.from(data);
            _isLoading = false;
          });
        } else {
          setState(() {
            _drivers = [];
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _drivers = [];
          _isLoading = false;
          _errorMessage = response?["msg"] ?? "No favorite drivers found.";
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = "Something went wrong. Please try again.";
      });
      debugPrint("FavoriteDrivers Error: $e");
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
          "My Favorite Drivers".tr,
          style: const TextStyle(
            color: Colors.white,
            fontFamily: "Gilroy_Bold",
          ),
        ),
      ),
      body: _isLoading
          ? Center(
              child: CircularProgressIndicator(color: linercolor),
            )
          : _drivers.isEmpty
              ? _buildEmptyState()
              : RefreshIndicator(
                  color: linercolor,
                  onRefresh: _fetchFavoriteDrivers,
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(
                        parent: BouncingScrollPhysics()),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 15, vertical: 15),
                    itemCount: _drivers.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      return _buildDriverCard(_drivers[index]);
                    },
                  ),
                ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.favorite_border_rounded,
            size: 80,
            color: linercolor.withOpacity(0.4),
          ),
          const SizedBox(height: 16),
          Text(
            "No Favorite Drivers",
            style: TextStyle(
              fontFamily: "Gilroy_Bold",
              fontSize: 18,
              color: notifier.text,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            "Drivers you mark as favorite\nwill appear here.",
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: "Gilroy_Medium",
              fontSize: 14,
              color: notifier.text.withOpacity(0.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDriverCard(Map<String, dynamic> driver) {
    final String name = driver["name"]?.toString() ?? "Unknown";
    final String mobile = driver["fmobile"]?.toString() ?? "-";
    final String vehicle = driver["vehicle"]?.toString() ?? "-";

    // Generate avatar initials for the icon placeholder
    final String initials = name.isNotEmpty
        ? name.trim().split(" ").map((e) => e.isNotEmpty ? e[0] : "").take(2).join().toUpperCase()
        : "?";

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          // Avatar circle
          Container(
            height: 55,
            width: 55,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: linercolor,
            ),
            child: Center(
              child: Text(
                initials,
                style: const TextStyle(
                  color: Colors.white,
                  fontFamily: "Gilroy_Bold",
                  fontSize: 18,
                ),
              ),
            ),
          ),
          const SizedBox(width: 14),

          // Info column
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(
                    fontFamily: "Gilroy_Bold",
                    fontSize: 15,
                    color: notifier.text,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.phone_outlined,
                        size: 14, color: notifier.text.withOpacity(0.6)),
                    const SizedBox(width: 4),
                    Text(
                      mobile,
                      style: TextStyle(
                        fontFamily: "Gilroy_Medium",
                        fontSize: 13,
                        color: notifier.text.withOpacity(0.6),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.two_wheeler_outlined,
                        size: 14, color: notifier.text.withOpacity(0.6)),
                    const SizedBox(width: 4),
                    Text(
                      vehicle,
                      style: TextStyle(
                        fontFamily: "Gilroy_Medium",
                        fontSize: 13,
                        color: notifier.text.withOpacity(0.6),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Favorite heart icon with interactive remove action
          InkWell(
            onTap: () => _removeFavoriteDriver(driver),
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.redAccent.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.favorite_rounded,
                color: Colors.redAccent,
                size: 22,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _removeFavoriteDriver(Map<String, dynamic> driver) async {
    final riderId = driver["id"]?.toString() ?? "";
    if (riderId.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        backgroundColor: notifier.getBgColor,
        title: Text(
          "Remove Favorite Driver".tr,
          style: TextStyle(fontFamily: "Gilroy_Bold", color: notifier.text),
        ),
        content: Text(
          "Are you sure you want to remove ${driver["name"] ?? "this driver"} from your favorites?".tr,
          style: TextStyle(fontFamily: "Gilroy_Medium", color: notifier.text.withOpacity(0.8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text("Cancel".tr, style: TextStyle(color: greaycolor, fontFamily: "Gilroy_Medium")),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text("Remove".tr, style: const TextStyle(color: Colors.white, fontFamily: "Gilroy_Bold")),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final userId = getdata.read("UserLogin")?["id"]?.toString() ??
          getdata.read("Uid")?.toString() ??
          "1";

      final res = await ApiWrapper.dataPostNode(Config.nodeFavoritesToggle, {
        "user_id": userId,
        "rider_id": riderId,
      });

      if (res != null && res["Result"] == true) {
        setState(() {
          _drivers.removeWhere((d) => d["id"]?.toString() == riderId);
        });
        tostmsg(res["msg"]?.toString() ?? "Removed from favorites");
      } else {
        tostmsg(res?["msg"]?.toString() ?? "Failed to remove favorite driver");
      }
    } catch (e) {
      tostmsg("Error removing favorite driver");
    }
  }
}
