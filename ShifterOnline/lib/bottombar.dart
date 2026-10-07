// ignore_for_file: deprecated_member_use

import 'package:flutter_svg/svg.dart';
import 'package:get_storage/get_storage.dart';
import 'package:intl/intl.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:geolocator/geolocator.dart';
import 'package:goParcel/controllers/page_list_api_controller.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/wallet_page.dart';
import 'package:goParcel/screens/myorder/myorder.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/screens/profile/myprofile.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:goParcel/utils/scheduled_order_watch.dart';
import 'package:provider/provider.dart';
import '../../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/utils/booking_guarantee.dart';

import 'screens/authscreen/signin.dart';

class Bottombar extends StatefulWidget {
  const Bottombar({super.key, this.tabIndex});
  final int? tabIndex;

  @override
  BottombarState createState() => BottombarState();
}

class BottombarState extends State<Bottombar> {
  late int _lastTimeBackButtonWasTapped;
  static const exitTimeInMillis = 2000;
  int _selectedIndex = 0;
  var isLogin = false;

  PageListApiController pageListApiController =
      Get.put(PageListApiController());

  NodeSocketSubscription? _scheduledOrderSubscription;

  @override
  void initState() {
    super.initState();
    _selectedIndex = widget.tabIndex ?? 0;
    debugPrint("========== _select Index ========= $_selectedIndex");
    isLogin = getdata.read("firstLogin") ?? false;
    pageListApiController.pageListApi();
    getCurrentData();
    _listenForScheduledOrderAssignment();
    _checkPendingScheduleConfirmations();
    setState(() {});
  }

  // Scheduled (booking_type=2) orders leave no screen watching for
  // order:assigned once their confirmation dialog closes (see
  // select_vehicle.dart's ScheduledOrderWatch.add call) — a driver may only
  // accept 30+ minutes later. Bottombar stays mounted for the whole
  // post-login session, so it's the natural place for that catch-up
  // listener: without it, the customer never sees the advance-payment
  // prompt for scheduled bookings unless they happen to manually open that
  // order's tracking screen within the payment window.
  void _listenForScheduledOrderAssignment() {
    _scheduledOrderSubscription = NodeSocketManager.instance.addListeners(onOrderAssigned: (data) {
      final orderId = data['order_id']?.toString();
      if (orderId == null || orderId.isEmpty) return;
      if (!ScheduledOrderWatch.remove(orderId)) return; // not a scheduled order we're catching up on
      if (!mounted) return;
      Get.to(() => TrackingWay(type: "Pickup", initialOrderData: data));
    }, onNoDriverFound: (data) {
      // Scheduled orders leave no screen watching for order:no_driver_found
      // either - tell the customer here so they know nobody accepted.
      final orderId = data['order_id']?.toString();
      if (orderId == null || orderId.isEmpty) return;
      if (!ScheduledOrderWatch.remove(orderId)) return;
      if (!mounted) return;
      Get.dialog(
        AlertDialog(
          title: Text("No drivers found".tr),
          content: Text(parseGuaranteeAmount(data['compensation_amount']) > 0
              ? "No driver accepted your scheduled order #$orderId. ${noDriverMessage(parseGuaranteeAmount(data['compensation_amount'])).replaceFirst('No driver found. ', '')}".tr
              : "None of the available drivers accepted your scheduled order #$orderId. Please try booking again.".tr),
          actions: [TextButton(onPressed: () => Get.back(), child: Text("OK".tr))],
        ),
      );
    }, onScheduleConfirm: (data) {
      _checkPendingScheduleConfirmations();
    });
  }

  bool _scheduleConfirmDialogOpen = false;

  // "Do you still want to continue with this scheduled ride?" - the server
  // asks the admin-configured number of minutes before the scheduled time
  // (socket event while the app is open; this fetch covers a closed app).
  Future<void> _checkPendingScheduleConfirmations() async {
    if (_scheduleConfirmDialogOpen) return;
    final uid = GetStorage().read('Uid') ?? GetStorage().read('UserLogin')?['id'];
    if (uid == null || uid.toString().isEmpty || uid.toString() == '0') return;
    try {
      final response = await ApiWrapper.dataPostNode(Config.nodeScheduleConfirmations, {'uid': int.tryParse(uid.toString()) ?? 0});
      if (response is! Map || response['data'] is! List) return;
      for (final item in (response['data'] as List).whereType<Map>()) {
        if (!mounted) return;
        await _showScheduleConfirmDialog(Map<String, dynamic>.from(item), int.tryParse(uid.toString()) ?? 0);
      }
    } catch (e) {
      debugPrint('schedule confirmations check failed: $e');
    }
  }

  Future<void> _showScheduleConfirmDialog(Map<String, dynamic> order, int uid) async {
    final orderId = int.tryParse(order['order_id'].toString()) ?? 0;
    if (orderId == 0) return;
    String when = '';
    final parsed = DateTime.tryParse(order['schedule_date_time']?.toString() ?? '');
    if (parsed != null) when = DateFormat('EEE, d MMM · h:mm a').format(parsed.toLocal());
    _scheduleConfirmDialogOpen = true;
    final choice = await Get.dialog<String>(
      AlertDialog(
        title: Text("Scheduled ride".tr),
        content: Text(
          "Do you still want to continue with this scheduled ride?".tr + (when.isEmpty ? '' : "\n\n$when"),
        ),
        actions: [
          TextButton(onPressed: () => Get.back(result: 'cancel'), child: Text("Cancel".tr)),
          ElevatedButton(onPressed: () => Get.back(result: 'continue'), child: Text("Continue".tr)),
        ],
      ),
      barrierDismissible: false,
    );
    _scheduleConfirmDialogOpen = false;
    if (choice == null) return;
    final response = await ApiWrapper.dataPostNode(Config.nodeScheduleConfirm, {'uid': uid, 'order_id': orderId, 'action': choice});
    if (choice == 'cancel') {
      ScheduledOrderWatch.remove(orderId.toString());
      ApiWrapper.showToastMessage(response is Map && response['Result'].toString() == 'true'
          ? "Scheduled ride cancelled".tr
          : (response is Map ? (response['ResponseMsg']?.toString() ?? "Could not cancel") : "Could not cancel"));
    }
  }

  @override
  void dispose() {
    _scheduledOrderSubscription?.dispose();
    super.dispose();
  }

  Future<bool> _handleWillPop() async {
    final currentTime = DateTime.now().millisecondsSinceEpoch;

    if ((currentTime - _lastTimeBackButtonWasTapped) < exitTimeInMillis) {
      return true;
    } else {
      _lastTimeBackButtonWasTapped = DateTime.now().millisecondsSinceEpoch;
      return false;
    }
  }

  Future<Position> getLatLong() async {
    bool serviceEnabled;
    LocationPermission permission;
    serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await Geolocator.openLocationSettings();
      return Future.error('Location services are disabled.');
    }
    permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return Future.error('Location permissions are denied');
      }
    }
    if (permission == LocationPermission.deniedForever) {
      return Future.error(
          'Location permissions are permanently denied, we cannot request permissions.');
    }
    return await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high);
  }

  Future<void> getCurrentData() async {
    Position position = await getLatLong();
    debugPrint("========= position ========= $position");
    currentLat = position.latitude;
    currentLong = position.longitude;
    setState(() {});
  }

  SnackBar getExitSnackBar(
    BuildContext context,
  ) {
    return SnackBar(
      content: Text("Press BACK again to exit!".tr),
      backgroundColor: Colors.red,
      duration: Duration(seconds: 2),
      behavior: SnackBarBehavior.floating,
    );
  }

  List icon = [
    "assets/home.svg",
    "assets/package_box.svg",
    "assets/fast_delivery.svg",
    "assets/user-circle.svg",
  ];

  List iconFile = [
    "assets/home_file.svg",
    "assets/package_box_file.svg",
    "assets/fast_delivery_file.svg",
    "assets/user-circle_file.svg",
  ];

  final _pageOption = [
    Home(),
    MyOrder(),
    WalletPage(),
    // StoreOrder(),
    MyProfile(),
  ];

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return WillPopScope(
      onWillPop: _handleWillPop,
      child: Scaffold(
        resizeToAvoidBottomInset: false,
        bottomNavigationBar: _buildBottomBar(context),
        body: _pageOption[_selectedIndex],
      ),
    );
  }

  Widget _buildBottomBar(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
          10, 9, 10, 8 + MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
        boxShadow: [
          BoxShadow(
            color: linercolor.withOpacity(.12),
            blurRadius: 22,
            offset: const Offset(0, -5),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(child: _navItem(0, 'Home'.tr)),
          Expanded(child: _navItem(1, 'Orders'.tr)),
          Expanded(child: _bookAction()),
          Expanded(child: _navItem(2, 'Wallet'.tr)),
          Expanded(child: _navItem(3, 'Account'.tr)),
        ],
      ),
    );
  }

  Widget _navItem(int index, String label) {
    final selected = _selectedIndex == index;
    return InkWell(
      onTap: () => _selectTab(index),
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 6),
              decoration: BoxDecoration(
                color:
                    selected ? linercolor.withOpacity(.12) : Colors.transparent,
                borderRadius: BorderRadius.circular(14),
              ),
              child: SvgPicture.asset(
                selected ? iconFile[index] : icon[index],
                color: selected ? linercolor : greaycolor,
                height: 23,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: selected ? linercolor : greaycolor,
                fontFamily: selected ? 'Gilroy_Bold' : 'Gilroy_Medium',
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bookAction() {
    return InkWell(
      onTap: () => _selectTab(0),
      borderRadius: BorderRadius.circular(30),
      child: Transform.translate(
        offset: const Offset(0, -14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 58,
              width: 58,
              decoration: BoxDecoration(
                color: linercolor,
                shape: BoxShape.circle,
                border: Border.all(color: notifier.getBgColor, width: 5),
                boxShadow: [
                  BoxShadow(
                    color: linercolor.withOpacity(.28),
                    blurRadius: 12,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: Center(
                child: SvgPicture.asset(
                  'assets/package_box_file.svg',
                  color: Colors.white,
                  height: 27,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'Book now',
              style: TextStyle(
                color: linercolor,
                fontFamily: 'Gilroy_Bold',
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _selectTab(int index) {
    final bool loggedIn = (getdata.read("UserLogin") != null) ||
        (getdata.read("firstLogin") ?? false) == true;
    debugPrint("bottom_nav_loggedIn: $loggedIn");
    if (loggedIn || index == 0) {
      setState(() => _selectedIndex = index);
    } else {
      Get.to(() => const SignIn());
    }
  }
}
