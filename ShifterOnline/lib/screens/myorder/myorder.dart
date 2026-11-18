// ignore_for_file: deprecated_member_use

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:goParcel/Api/AppModelApi/order_history_api_model.dart';
import 'package:goParcel/controllers/p_d_order_histroy_api_controller.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:flutter/material.dart';
import 'widgets/order_card.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../home/select_vehicle.dart';
import '../../utils/colors.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_skeleton.dart';

class MyOrder extends StatefulWidget {
  final String? type;
  const MyOrder({super.key, this.type});
  @override
  State<MyOrder> createState() => _MyOrderState();
}

class _MyOrderState extends State<MyOrder> with SingleTickerProviderStateMixin {

  PDOrderHistroyApiController pdOrderHistroyApiController = Get.put(PDOrderHistroyApiController());

  final ScrollController scrollController = ScrollController();

  bool orderLoding = false;

  @override
  void initState() {
    super.initState();
    var uid = getdata.read("Uid") ?? "";
    pdOrderHistroyApiController.orderHistroyApi(uid: uid, type: "recent").then(
      (value) {
        pdOrderHistroyApiController.orderHistroyApi(uid: uid, type: "past").then((value) {
          pdOrderHistroyApiController.orderHistroyApi(uid: uid, type: "favorite").then((value) {
            if (mounted) {
              setState(() {
                orderLoding = true;
              });
            }
          });
        });
      },
    );
  }

  List tabBarTitle = ["Recently".tr, "Completed".tr, "Favorite".tr];

  int selectTab = 0;
  
  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final p = AppPalette.current;
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: p.surface,
        centerTitle: widget.type == "Profile" ? true : false,
        title: Text(
          "My orders".tr,
          style: AppText.title(p.ink),
        ),
      ),
      body: Container(
        width: Get.width,
        padding: EdgeInsets.only(top: 14, right: 16, left: 16),
        color: p.canvas,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 40,
              child: ListView.separated(
                itemCount: tabBarTitle.length,
                shrinkWrap: true,
                scrollDirection: Axis.horizontal,
                itemBuilder: (context, index) {
                  return InkWell(
                    onTap: () {
                      setState(() {
                        selectTab = index;
                      });
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        if (scrollController.hasClients) scrollController.jumpTo(0);
                      });
                    },
                    borderRadius: BorderRadius.circular(20),
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: selectTab == index ? p.brandTint : p.surface,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                            color: selectTab == index ? p.brand : p.line, width: selectTab == index ? 1.5 : 1),
                      ),
                      child: Center(
                        child: Text(
                          "${tabBarTitle[index]}",
                          style: AppText.bodyStrong(selectTab == index ? p.brandText : p.ink).copyWith(
                            fontSize: 14,
                            fontFamily: selectTab == index ? 'Gilroy_Bold' : 'Gilroy_Medium',
                          ),
                        ),
                      ),
                    ),
                  );
                },
                separatorBuilder: (BuildContext context, int index) {
                  return SizedBox(width: 10);
                },
              ),
            ),
            SizedBox(height: 15),
            Expanded(
              child: GetBuilder<PDOrderHistroyApiController>(
                builder: (pdOrderHistroyApiController) {
                  if (!orderLoding) {
                    return ListView(
                      children: const [
                        AppSkeleton(height: 170, radius: 16),
                        SizedBox(height: 12),
                        AppSkeleton(height: 170, radius: 16),
                        SizedBox(height: 12),
                        AppSkeleton(height: 170, radius: 16),
                      ],
                    );
                  }
                  final model = selectTab == 2
                      ? pdOrderHistroyApiController.favoriteOrderApiModel
                      : selectTab == 1
                          ? pdOrderHistroyApiController.completedOrderApiModel
                          : pdOrderHistroyApiController.recentlyOrderApiModel;
                  final orders = model?.orderHistory ?? const <OrderHistory>[];
                  if (model == null || model.result == "false" || orders.isEmpty) {
                    return Column(
                      children: [
                        SizedBox(height: Get.height * 0.2),
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(color: p.surface, shape: BoxShape.circle, border: Border.all(color: p.line)),
                          child: Icon(selectTab == 2 ? Icons.favorite_border_rounded : Icons.receipt_long_outlined,
                              color: p.inkSubtle, size: 32),
                        ),
                        const SizedBox(height: 14),
                        Center(
                          child: Text(
                            selectTab == 2
                                ? "No favorite orders yet".tr
                                : "${model?.responseMsg ?? "No Order History Found!"}",
                            textAlign: TextAlign.center,
                            style: AppText.bodyStrong(p.ink).copyWith(fontSize: 16),
                          ),
                        ),
                      ],
                    );
                  }
                  return ListView.separated(
                    controller: scrollController,
                    shrinkWrap: true,
                    itemCount: orders.length,
                    padding: EdgeInsets.only(bottom: Get.height / 8),
                    physics: BouncingScrollPhysics(),
                    itemBuilder: (context, index) {
                      final order = orders[index];
                      // Favorite / Book Again only make sense for finished trips.
                      final isFinished = selectTab != 0;
                      return orderlistBox(
                        context,
                        image: "assets/package_box_file.svg",
                        title: "#${order.id}",
                        discription: "${order.flowMsg}",
                        ordertype: "${order.status}",
                        dropAddress: "${order.dropAddress}",
                        pickupAddress: "${order.pickAddress}",
                        orderDate: DateFormat("EEE, d MMM, yyyy").format(DateTime.parse("${order.orderDate}")),
                        details: _orderDetailRows(order),
                        amount: (order.total ?? '').trim().isEmpty ? null : '₹${order.total}',
                        vehicleName: order.vehicleType,
                        isFavorite: order.isFavorite,
                        showActions: isFinished,
                        onTap: () {
                          save("OrderID", "${order.id}");
                          Get.to(() => TrackingWay(type: "Pickup", isback: true));
                        },
                        onAddFav: () async {
                          final uid = (getdata.read("Uid") ?? "").toString();
                          final nowFavorite = await pdOrderHistroyApiController.toggleFavoriteOrder(uid: uid, orderId: order.id ?? "");
                          if (nowFavorite != null) {
                            tostmsg(nowFavorite ? "Added to Favorite Orders!" : "Removed from Favorite Orders");
                          }
                        },
                        onBookAgain: () => _bookAgainFromOrder(order),
                      );
                    },
                    separatorBuilder: (BuildContext context, int index) {
                      return SizedBox(height: 10);
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}


/// Label/value rows for the order detail box: vehicle type, trip start/end
/// time and the assigned driver. Rows with no data are skipped (e.g. a
/// cancelled order that never got a driver).
List<MapEntry<String, String>> _orderDetailRows(OrderHistory order) {
  String time(String? raw) {
    if (raw == null || raw.isEmpty) return "";
    final parsed = DateTime.tryParse(raw);
    return parsed == null ? raw : DateFormat("d MMM, hh:mm a").format(parsed);
  }

  final rows = <MapEntry<String, String>>[];
  final vehicle = [order.vehicleType, order.modelTitle].where((v) => v != null && v.trim().isNotEmpty).join(" · ");
  if (vehicle.isNotEmpty) rows.add(MapEntry("Vehicle Type", vehicle));
  final start = time(order.tripStartTime);
  if (start.isNotEmpty) rows.add(MapEntry("Trip Start", start));
  final end = time(order.tripEndTime);
  if (end.isNotEmpty) rows.add(MapEntry("Trip End", end));
  final cancelReason = (order.cancelReason ?? "").trim();
  if (cancelReason.isNotEmpty) rows.add(MapEntry("Cancellation Reason", cancelReason));
  final penalty = double.tryParse(order.cancelCharge ?? "") ?? 0;
  if (penalty > 0) rows.add(MapEntry("Cancellation Penalty", "₹${penalty.toStringAsFixed(penalty % 1 == 0 ? 0 : 2)}"));
  final driver = [order.driverName, order.driverVehicleNo].where((v) => v != null && v.trim().isNotEmpty).join(" · ");
  if (driver.isNotEmpty) rows.add(MapEntry("Driver", driver));
  return rows;
}

/// Re-books a past order using that order's real pickup/drop/stop
/// coordinates, then checks which drivers are available around the pickup
/// (same availability API the home flow uses) before opening vehicle
/// selection. Previously this used hardcoded coordinates, so availability
/// was always evaluated in the wrong city ("No Driver Available").
Future<void> _bookAgainFromOrder(OrderHistory order) async {
  final pickupLat = double.tryParse(order.plat ?? "");
  final pickupLng = double.tryParse(order.plong ?? "");
  final dropLat = double.tryParse(order.dlat ?? "");
  final dropLng = double.tryParse(order.dlong ?? "");
  if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
    tostmsg("This order's location is missing, so it can't be booked again.");
    return;
  }

  Get.dialog(
    Center(child: CircularProgressIndicator(color: linercolor)),
    barrierDismissible: false,
  );

  try {
    final user = getdata.read("UserLogin");
    final name = user is Map ? user["name"]?.toString() ?? "Customer" : "Customer";
    final mobile = user is Map ? user["mobile"]?.toString() ?? "" : "";
    final uid = getdata.read("Uid") ?? (user is Map ? user["id"]?.toString() ?? "" : "");
    String firstNonEmpty(String? a, String fallback) => (a != null && a.trim().isNotEmpty) ? a : fallback;

    final Map<String, dynamic> pickupData = {
      "address": firstNonEmpty(order.pickAddress, "Pickup Location"),
      "c_ddress": order.pickAddress ?? "",
      "c_name": firstNonEmpty(order.pickName, name),
      "c_number": firstNonEmpty(order.pmobile, mobile),
      "type": firstNonEmpty(order.pickType, "Other"),
      "lat_map": pickupLat,
      "long_map": pickupLng,
    };
    final Map<String, dynamic> dropData = {
      "address": firstNonEmpty(order.dropAddress, "Drop Location"),
      "c_ddress": order.dropAddress ?? "",
      "c_name": firstNonEmpty(order.dropName, name),
      "c_number": firstNonEmpty(order.dmobile, mobile),
      "type": firstNonEmpty(order.dropType, "Other"),
      "lat_map": dropLat,
      "long_map": dropLng,
    };
    final stops = <Map<String, dynamic>>[];
    for (final stop in order.stops) {
      final lat = double.tryParse(stop["lat"]?.toString() ?? "");
      final lng = double.tryParse(stop["lng"]?.toString() ?? "");
      if (lat == null || lng == null) continue;
      stops.add({
        "address": stop["address"]?.toString() ?? "",
        "hno": stop["hno"]?.toString() ?? "",
        "landmark": stop["landmark"]?.toString() ?? "",
        "c_name": stop["contact_name"]?.toString() ?? "",
        "c_number": stop["contact_number"]?.toString() ?? "",
        "lat_map": lat,
        "long_map": lng,
      });
    }

    await getdata.write("PickupAddress", [pickupData]);
    await getdata.write("DropeAddress", [dropData]);

    if (pickupiteam.isEmpty) {
      final res = await ApiWrapper.dataPostNode(Config.nodeHome, {"uid": uid.toString()});
      if (res != null && res["ResultData"] is List) {
        pickupiteam = res["ResultData"];
      }
    }

    // Live driver availability around this order's pickup point.
    final availabilityById = <String, Map<String, dynamic>>{};
    String? availabilityError;
    try {
      final response = await http
          .post(
            Uri.parse(Config.availableVehiclesUrl),
            headers: const {"Content-Type": "application/json"},
            body: jsonEncode({"pickup_lat": pickupLat, "pickup_lng": pickupLng}),
          )
          .timeout(const Duration(seconds: 15));
      final body = jsonDecode(response.body);
      final vehicles = body is Map ? body["vehicles"] : null;
      if (response.statusCode != 200 || body is! Map || body["success"] != true || vehicles is! List) {
        throw const FormatException("Availability service returned an invalid response");
      }
      for (final vehicle in vehicles.whereType<Map>()) {
        final id = vehicle["id"]?.toString();
        if (id != null && id.isNotEmpty) availabilityById[id] = Map<String, dynamic>.from(vehicle);
      }
      if (body["serviceable"] != true) {
        availabilityError = "This pickup area is currently outside our service area.";
      }
    } catch (_) {
      availabilityError = "Could not check nearby drivers. Please try again.";
    }

    if (Get.isDialogOpen ?? false) Get.back();

    final options = <Map<String, dynamic>>[];
    for (final category in pickupiteam.whereType<Map>()) {
      options.add({
        "category": Map<String, dynamic>.from(category),
        "availability": _availabilityForCategory(availabilityById, category),
      });
    }

    Get.to(() => SelectVehicleScreen(
      pickup: pickupData,
      drop: dropData,
      stops: stops,
      vehicles: options,
      bookingType: 1,
      availabilityError: availabilityError,
    ));
  } catch (e) {
    if (Get.isDialogOpen ?? false) Get.back();
    tostmsg("Could not rebook order: $e");
  }
}

// Same category -> live-availability matching home.dart uses: category id
// first, then the legacy model id, then vehicle-type/name text.
Map<String, dynamic>? _availabilityForCategory(Map<String, Map<String, dynamic>> byId, Map category) {
  final categoryId = category["id"]?.toString().trim() ?? "";
  if (categoryId.isNotEmpty) {
    for (final vehicle in byId.values) {
      final ids = [vehicle["category_id"], vehicle["cat_id"]].map((v) => v?.toString().trim()).toSet();
      if (ids.contains(categoryId)) return vehicle;
    }
    final exact = byId[categoryId];
    if (exact != null) return exact;
  }
  final categoryName = (category["cat_name"] ?? category["name"] ?? "").toString().trim().toLowerCase();
  if (categoryName.isEmpty) return null;
  for (final vehicle in byId.values) {
    final type = (vehicle["vehicle_type"] ?? "").toString().trim().toLowerCase();
    final name = (vehicle["name"] ?? "").toString().trim().toLowerCase();
    if ((type.isNotEmpty && (type == categoryName || type.contains(categoryName) || categoryName.contains(type))) ||
        (name.isNotEmpty && (name == categoryName || name.contains(categoryName)))) {
      return vehicle;
    }
  }
  return null;
}

// Fallback for callers that only have address text (no coordinates) - the
// Store (Buy Anything) orders list has no real pickup/drop coordinates to
// rebook from.
Future<void> _handleBookAgain(BuildContext context, String pickupAddress, String dropAddress) async {
  tostmsg("Please book again from the Pickup/Drop Orders list.");
}

Widget orderlistBox(
  BuildContext context, {
  required String image,
  required String title,
  required String discription,
  required String pickupAddress,
  required String dropAddress,
  required String ordertype,
  required String orderDate,
  VoidCallback? onTap,
  VoidCallback? onBookAgain,
  VoidCallback? onAddFav,
  List<MapEntry<String, String>> details = const [],
  bool isFavorite = false,
  bool showActions = true,
  String? amount,
  String? vehicleName,
}) {
  notifier = Provider.of(context, listen: true);
  // Porter-style card; the null-callback fallbacks are the same as before the redesign.
  return OrderCard(
    title: title,
    vehicleName: vehicleName,
    amount: amount,
    status: ordertype,
    date: orderDate,
    pickup: pickupAddress,
    drop: dropAddress,
    note: discription,
    details: details,
    isFavorite: isFavorite,
    showActions: showActions,
    onTap: onTap,
    onFavorite: () {
      if (onAddFav != null) {
        onAddFav();
      } else {
        tostmsg("Added to Favorite Orders!");
      }
    },
    onBookAgain: () {
      if (onBookAgain != null) {
        onBookAgain();
      } else {
        _handleBookAgain(context, pickupAddress, dropAddress);
      }
    },
  );
}
