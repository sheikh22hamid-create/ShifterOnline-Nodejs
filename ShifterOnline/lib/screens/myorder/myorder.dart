// ignore_for_file: deprecated_member_use

import 'dart:convert';

import 'package:flutter_svg/svg.dart';
import 'package:http/http.dart' as http;
import 'package:goParcel/Api/AppModelApi/order_history_api_model.dart';
import 'package:goParcel/controllers/p_d_order_histroy_api_controller.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/trackingpoliyline.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:dotted_line/dotted_line.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../home/select_vehicle.dart';
import '../../utils/colors.dart';

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
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: linercolor,
        centerTitle: widget.type == "Profile" ? true : false,
        title: Text(
          "Pickup/Drop Orders".tr,
          style: TextStyle(
            color: whitecolor,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
      ),
      body: Container(
        width: Get.width,
        padding: EdgeInsets.only(top: 15, right: 15, left: 15),
        decoration: BoxDecoration(
          // color: lightbgcolor,
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 30,
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
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        color: selectTab == index
                            ? linercolor
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(40),
                        border: Border.all(
                          color: selectTab == index ? linercolor : greaycolor,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          "${tabBarTitle[index]}",
                          style: TextStyle(
                            color: selectTab == index ? whitecolor : notifier.isDark ? notifier.text : greaycolor,
                            fontSize: 15,
                            fontFamily: "Gilroy_Regular",
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
                    return Center(child: CircularProgressIndicator(color: linercolor));
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
                        SizedBox(height: Get.height * 0.32),
                        Center(
                          child: Text(
                            selectTab == 2
                                ? "No favorite orders yet".tr
                                : "${model?.responseMsg ?? "No Order History Found!"}",
                            style: TextStyle(
                              color: blackcolor,
                              fontSize: 18,
                              fontFamily: "Gilroy_Bold",
                            ),
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
}) {
  Color? statusColor;
  switch (ordertype) {
    case "Pending":
      statusColor = const Color(0xffFFC96E);
      break;
    case "Processing":
      statusColor = notifier.darklinercolor;
      break;
    case "On Route":
      statusColor = const Color(0xff00D261);
      break;
    case "Cancelled":
      statusColor = const Color(0xffF44336);
      break;
    case "Completed":
      statusColor = const Color(0xff00D261);
      break;
    default:
  }
  notifier = Provider.of(context, listen: true);
  return Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: BoxDecoration(
      color: notifier.getBgColor,
      borderRadius: BorderRadius.circular(20),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withOpacity(0.04),
          blurRadius: 10,
          offset: const Offset(0, 4),
        ),
      ],
    ),
    child: Column(
      children: [
        InkWell(
          onTap: onTap,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      height: 46,
                      width: 46,
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: notifier.lightBgColor,
                      ),
                      child: SvgPicture.asset(
                        image,
                        color: linercolor,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                title,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontSize: 17,
                                  fontFamily: "Gilroy_Bold",
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(20),
                                  color: statusColor?.withOpacity(0.12) ?? greaycolor.withOpacity(0.2),
                                ),
                                child: Text(
                                  ordertype,
                                  style: TextStyle(
                                    color: statusColor ?? greencolor,
                                    fontSize: 12,
                                    fontFamily: "Gilroy_Bold",
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            discription,
                            style: TextStyle(
                              color: greaycolor,
                              fontSize: 14,
                              fontFamily: "Gilroy_Medium",
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Divider(color: greaycolor.withOpacity(0.2)),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Column(
                      children: [
                        Container(
                          height: 10,
                          width: 10,
                          decoration: BoxDecoration(
                            color: greaycolor,
                            shape: BoxShape.circle,
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 0),
                          child: DottedLine(
                            dashGapLength: 3,
                            lineThickness: 2,
                            dashColor: greaycolor.withOpacity(0.4),
                            dashGapColor: Colors.transparent,
                            direction: Axis.vertical,
                            lineLength: 36,
                          ),
                        ),
                        Image.asset(
                          "assets/location_drop.png",
                          height: 18,
                          color: greaycolor,
                        ),
                      ],
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            pickupAddress,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: notifier.text,
                              fontSize: 13,
                              fontFamily: "Gilroy_Medium",
                            ),
                          ),
                          const SizedBox(height: 8),
                          Divider(height: 1, color: greaycolor.withOpacity(0.15)),
                          const SizedBox(height: 8),
                          Text(
                            dropAddress,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: notifier.text,
                              fontSize: 13,
                              fontFamily: "Gilroy_Medium",
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (details.isNotEmpty) ...[
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: notifier.lightBgColor,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      children: [
                        for (final row in details)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                SizedBox(
                                  width: 86,
                                  child: Text(
                                    row.key.tr,
                                    style: TextStyle(color: greaycolor, fontSize: 12, fontFamily: "Gilroy_Medium"),
                                  ),
                                ),
                                Expanded(
                                  child: Text(
                                    row.value,
                                    style: TextStyle(color: notifier.text, fontSize: 12.5, fontFamily: "Gilroy_Bold"),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text(
                      orderDate,
                      style: TextStyle(
                        color: notifier.isDark ? greaycolor : linercolor,
                        fontSize: 12,
                        fontFamily: "Gilroy_Bold",
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        
        // ── Modern Action Buttons ──────────────────────────────────────────
        if (showActions) ...[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Divider(color: greaycolor.withOpacity(0.2)),
        ),
        Padding(
          padding: const EdgeInsets.only(left: 12, right: 12, top: 4),
          child: Row(
            children: [
              // 1. Add Fav Order Button
              Expanded(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () {
                      if (onAddFav != null) {
                        onAddFav();
                      } else {
                        tostmsg("Added to Favorite Orders!");
                      }
                    },
                    child: Container(
                      height: 40,
                      decoration: BoxDecoration(
                        color: linercolor.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: linercolor.withOpacity(0.25),
                          width: 1,
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                            size: 17,
                            color: isFavorite ? Colors.red : linercolor,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            isFavorite ? "Favorite" : "Add Fav Order",
                            style: TextStyle(
                              color: linercolor,
                              fontSize: 13,
                              fontFamily: "Gilroy_Bold",
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              // 2. Book Again Button
              Expanded(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () {
                      if (onBookAgain != null) {
                        onBookAgain();
                      } else {
                        _handleBookAgain(context, pickupAddress, dropAddress);
                      }
                    },
                    child: Container(
                      height: 40,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xfffa5700), Color(0xffdd6012)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xfffa5700).withOpacity(0.3),
                            blurRadius: 6,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.autorenew_rounded,
                            size: 18,
                            color: Colors.white,
                          ),
                          SizedBox(width: 6),
                          Text(
                            "Book Again",
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontFamily: "Gilroy_Bold",
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        ],
      ],
    ),
  );
}
