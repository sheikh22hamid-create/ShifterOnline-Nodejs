import 'package:goParcel/bottombar.dart';
import 'package:goParcel/services/app_update_service.dart';
import 'package:goParcel/onboarding.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/waiting_screen.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../utils/colors.dart';
import '../../../utils/node_socket_manager.dart';

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../authscreen/signin.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {

  ColorNotifier notifier = ColorNotifier();

  @override
  void initState() {
    super.initState();
    AppUpdateService.start();
    initialization();
  }

  void initialization() async {
    // Check if user is logged in by checking both UserLogin data and firstLogin flag
    bool? isLogIn = getdata.read("firstLogin") ?? false;
    bool hasUserData = getdata.read("UserLogin") != null;

    SharedPreferences prefs = await SharedPreferences.getInstance();
    debugPrint("-------------> is Loginuse ${getdata.read("firstLogin")}");
    debugPrint("-------------> hasUserData $hasUserData");
    notifier.setIsDark = prefs.getBool("isDark");

    Future.delayed(Duration(seconds: 2), () {
      // If user is logged in (either firstLogin is true OR UserLogin data exists), go to main app
      if (isLogIn == true || hasUserData) {
        var uid = getdata.read("Uid");
        final waitingOrderId = getdata.read('active_waiting_order_id')?.toString();
        final waitingExpiry = int.tryParse(
          getdata.read('active_waiting_expires_at')?.toString() ?? '',
        );
        final hasActiveWaitingOrder = waitingOrderId != null &&
            waitingOrderId.isNotEmpty &&
            waitingExpiry != null &&
            waitingExpiry > DateTime.now().millisecondsSinceEpoch;
        if (uid != null) {
          NodeSocketManager.instance.connectCustomer(
            int.tryParse(uid.toString()) ?? 0,
            orderId: hasActiveWaitingOrder ? waitingOrderId : null,
          );
        }
        if (hasActiveWaitingOrder) {
          Get.offAll(() => WaitingScreen(orderId: waitingOrderId!));
          return;
        } else if (waitingOrderId != null || waitingExpiry != null) {
          getdata.remove('active_waiting_order_id');
          getdata.remove('active_waiting_expires_at');
        }
        Get.offAll(() => Bottombar());
      } else {
        // If not logged in, go to onboarding/signin
        Get.offAll(() => SignIn(paymenttype: "onboarding"));
      }
    }).then((_) => AppUpdateService.promptIfAvailable());
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: notifier.isDark ? notifier.lightBgColor : notifier.getBgColor,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              "assets/logo2.png",
              height: Get.height / 6,
            ),
            SizedBox(height: Get.height / 100),
            Text(
              "Shifter Online".tr,
              style: TextStyle(
                color: notifier.text,
                fontFamily: 'Gilroy_Bold',
                fontSize: 20,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
