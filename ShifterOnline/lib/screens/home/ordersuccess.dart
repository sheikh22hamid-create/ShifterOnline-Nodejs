import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/home/trackingpoliyline.dart';
import 'trakingStore.dart';

class TrakingOrder extends StatefulWidget {
  final String? type;
  const TrakingOrder({super.key, this.type});

  @override
  State<TrakingOrder> createState() => _TrakingOrderState();
}

class _TrakingOrderState extends State<TrakingOrder> {
  @override
  void initState() {
    super.initState();
    print("✅ TrakingOrder initState called");
    print("📦 Widget Type: ${widget.type}");

    // Class open hote hi trackOrder call ho jayega
    WidgetsBinding.instance.addPostFrameCallback((_) {
      print("🎯 Post Frame Callback - Calling _trackOrder");
      _trackOrder();
    });
  }

  void _trackOrder() {
    print("🚀 _trackOrder called automatically");
    print("📊 Current Route: ${Get.currentRoute}");
    print("🔍 Type check: ${widget.type}");
    print("🛒 Is Buy type: ${widget.type == "Buy"}");

    try {
      if (widget.type == "Buy") {
        print("🛍️ Navigating to TrakingStore...");
        Get.off(() => TrakingStore(type: "OrderDone"));
        print("✅ Successfully navigated to TrakingStore");
      } else {
        print("📦 Navigating to Tracklast...");
        Get.off(() => Tracklast(type: "OrderDone"));
        print("✅ Successfully navigated to Tracklast");
      }
    } catch (e) {
      print("❌ Navigation Error: $e");
      print("📝 StackTrace: ${StackTrace.current}");
      Get.snackbar("Error".tr, "Unable to load tracking: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    print("🎨 TrakingOrder build method called");

    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 20),
            Text("Loading tracking...".tr),
            SizedBox(height: 10),
            Text("Type: @value".trParams({"value": '${widget.type ?? 'Not specified'}'})),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    print("🗑️ TrakingOrder dispose called");
    super.dispose();
  }
}