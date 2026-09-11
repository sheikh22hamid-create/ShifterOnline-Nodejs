// ignore_for_file: deprecated_member_use, prefer_typing_uninitialized_variables

import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:goParcel/Api/AppModelApi/packagelist_api_model.dart';
import 'package:goParcel/Api/AppModelApi/payment_gatwey_api_model.dart';
import 'package:goParcel/Payment/pay_stack_payment.dart';
import 'package:goParcel/Payment/paypal/src/screens/paypal_screen.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:flutter_svg/svg.dart';
import 'package:get/get.dart';
import 'package:goParcel/Payment/web_view.dart';
import 'package:goParcel/screens/home/CouponList.dart';
import 'package:goParcel/screens/home/wallet_page.dart';
import 'package:goParcel/screens/myorder/myordertabs/completed_order.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../Payment/InputFormater.dart';
import '../../Payment/Payment_card.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../authscreen/signin.dart';
import '../home/home.dart';
import 'waiting_screen.dart';
import '../../bottombar.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'orderSuccess.dart';
import 'traking.dart';
import 'confirm_order_map.dart';

class PickUpDrop extends StatefulWidget {
  final String? type;
  const PickUpDrop({super.key, this.type});

  @override
  State<PickUpDrop> createState() => _PickUpDropState();
}

class _PickUpDropState extends State<PickUpDrop> {

  //!--------- new caluculation variable ----------
  double ukms = 0;
  double aukms = 0;
  double utprice = 0;
  double afprice = 0;
  double additionalKmCharge = 0;
  double deliveryfees = 0;
  double totalDeliveryfees = 0;
  double dcharge = 0;
  double exmilecharge = 0;
  double totaldistance = 0.0;

  //!--------- KM Range Selection ----------
  int _selectedKm = 1; // Default 1 KM selected
  double _extraKmCharges = 0.0;

  //!--------- Wheeler charges from SelectedWheeler ----------
  double minCharge = 8.0; // Default value
  double pickupCharges = 8.0; // Default value

  //!--------- Booking Type ----------
  // 1 = Current Booking, 2 = Schedule Booking, 3 = Next Day Booking
  int selectedBookingType = 1;
  DateTime? scheduledDateTime;

  //!--------- new caluculation variable ----------



// ----------- toolTip ---------------

  final GlobalKey _buttonKey = GlobalKey();
  OverlayEntry? _overlayEntry;
  bool _tooltipVisible = false;

// ------------------------------------

  int groupValue = -1;
  int? _payValue;
  List addressList = [];
  String? paddress;
  String? paddresstype;
  String? daddress = "Choose drop address".tr;
  String? daddresstype;

  // Multiple drop locations
  List<Map<String, dynamic>> dropLocations = [];
  int dropLocationCount = 1;
  int maxExtraStops = 2;
  String? taskselectitem;
  String? taskDetail;
  String? paymenttital;
  String addressId = "0";
  String paddressID = "0";
  String daddressID = "0";
  bool itemValue = false;
  int itemValue1 = 0;
  String phno = "";
  String dhno = "";
  String? plandmark;
  String? dlandmark;
  String? validationAddress;
  String? selectid = "0";
  bool? pick = false;
  bool? drop = false;
  String? pname;
  String? dname;

  bool isPaymentLoding = false;

//  ------------ Apply coupon -------------

  String? couponcode = "Apply Now";
  String? applycode = "applied";
  String? cid = "0";
  String? camount = "0";
  String? totalfees = "0";


//  ------------ change button -------------

  bool? changepick = false;
  bool? changedrop = false;
  var changelat1;
  var changelon1;
  var changelat2;
  var changelon2;
  String changephno = "";
  String changedhno = "";
  String? changeplandmark;
  String? changedlandmark;
  String? changepaddress;
  String? changedaddress = "Choose drop address".tr;
  String? changepaddresstype;
  String? changedaddresstype;
  String changecustNumber = "";
  String changedropNumber = "";
  String changeaddressId = "0";
  String changepaddressID = "0";
  String changedaddressID = "0";
  String? changepname;
  String? changedname;

//  -----------------------------------------
  String selectedWheelerName = "2 Wheeler"; // Default value

  bool? showButton = false;
  var lat1;
  var lon1;
  var lat2;
  var lon2;
  dynamic totaltime;

  var removevat = "0";
  var vatremove = "0";

  var packageSize = "0";
  var packageWeight = "0";

  String custNumber = "";
  String dropNumber = "";

  List packagedetails = ["Max weight".tr, "Cost".tr];

  // ============= task details =================

  List items = [];
  List itemsImages = [];
  String dropdownvalue = "";
  List imageList = [];
  String? itemID;

  // ============================================

  RazorPayClass razorPayClass = RazorPayClass();

  TextEditingController dropnote = TextEditingController();
  TextEditingController gstNumberController = TextEditingController();

  bool firstLogin = false;
  bool isLoading = true;

  @override
  void initState() {
    super.initState();

    // Initialize KM selection
    _selectedKm = start_range.toInt(); // Start from start_range
    _extraKmCharges = 0.0;

    // Initialize priceData with default values
    priceData = {
      "ukms": "5",
      "kilo_limit": "10",
      "mile_charge": "10",
      "is_wether_bad": "0"
    };

    initStatData();
  }

  initStatData (){
   packageListApi();

    _paymentCard.type = CardType.Others;
    numberController.addListener(_getCardTypeFrmNumber);
    firstLogin = getdata.read("firstLogin") ?? false;
    setState(() {});
    debugPrint("========== firstLogin ========= $firstLogin");

    // Set default user name and mobile number from logged-in user data
    try {
      var userLogin = getdata.read("UserLogin");
      if (userLogin != null && userLogin is Map) {
        // Set default pickup name and number from logged-in user
        if ((pname == null || pname!.isEmpty) && userLogin["name"] != null) {
          pname = userLogin["name"].toString();
          changepname = pname;
        }
        if (custNumber.isEmpty && userLogin["mobile"] != null) {
          String ccode = userLogin["ccode"]?.toString() ?? "";
          custNumber = "$ccode${userLogin["mobile"].toString()}";
          changecustNumber = custNumber;
        }
        debugPrint("========== Default user name: $pname, number: $custNumber ========");
      }
    } catch (e) {
      debugPrint("Error setting default user data: $e");
    }

    if (widget.type == "signin") {
      signinreturn();
    }

    // Set default pickup location to current location if no pickup address exists
    _setDefaultPickupLocation();
    _loadSavedDropLocation();
    checkAddress();
    paymenrgatway();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: handlePaymentSuccess,
      handlePaymentError: handlePaymentError,
      handleExternalWallet: handleExternalWallet,
    );

    // PROPERLY get selected wheeler name from storage
    String? savedWheeler = getdata.read("SelectedWheeler");
    debugPrint("🟢 PickUpDrop: Retrieved from storage: $savedWheeler");

    // Set selectedWheelerName for button text
    if (savedWheeler != null && savedWheeler.isNotEmpty) {
      selectedWheelerName = savedWheeler;
    } else {
      selectedWheelerName = "Vehicle";
    }

    debugPrint("🟢 PickUpDrop: Button will show: Book $selectedWheelerName");

    // Read min_charge and pickup_charges from storage
    var savedMinCharge = getdata.read("min_charge");
    var savedPickupCharges = getdata.read("pickup_charges");

    if (savedMinCharge != null) {
      minCharge = double.tryParse(savedMinCharge.toString()) ?? 8.0;
    }
    if (savedPickupCharges != null) {
      pickupCharges = double.tryParse(savedPickupCharges.toString()) ?? 8.0;
    }

    debugPrint("🟢 PickUpDrop: min_charge = $minCharge, pickup_charges = $pickupCharges");

    // Set dropdownvalue for package selection
    if (savedWheeler != null && savedWheeler.isNotEmpty) {
      dropdownvalue = savedWheeler; // ← YAHAN CORRECT VARIABLE USE KARO
    } else {
      // Fallback to first item if no selection
      for (var i = 0; i < pickupiteam.length; i++) {
        items.add(pickupiteam[i]["cat_name"]);
        itemsImages.add(pickupiteam[i]["cat_img"]);
      }
      dropdownvalue = items.isNotEmpty ? items.first : "";
    }

    debugPrint("=============== item ============ $items");
    debugPrint("=========== itemsImages ========= $itemsImages");
    debugPrint("========== dropdownvalue ======== $dropdownvalue");
  }

  // The home flow already collected the destination. Hydrate it here so the
  // task form shows the saved drop instead of asking for it a second time.
  void _loadSavedDropLocation() {
    final savedDrop = getdata.read("DropeAddress");
    if (savedDrop is! List || savedDrop.isEmpty || savedDrop.first is! Map) return;
    final saved = savedDrop.first;
    setState(() {
      lat2 = double.tryParse(saved["lat_map"].toString());
      lon2 = double.tryParse(saved["long_map"].toString());
      dhno = saved["hno"]?.toString() ?? "";
      dlandmark = saved["landmark"]?.toString() ?? "";
      daddress = saved["address"]?.toString() ?? "";
      daddresstype = saved["type"]?.toString();
      dname = saved["c_name"]?.toString();
      dropNumber = saved["c_number"]?.toString() ?? "";
      drop = true;
      changedrop = true;
      changedaddress = daddress;
      changedaddresstype = daddresstype;
      changelat2 = lat2;
      changelon2 = lon2;
      changedhno = dhno;
      changedlandmark = dlandmark;
      changedname = dname;
      changedropNumber = dropNumber;
    });
    if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
      calculateDistance(lat1, lon1, lat2, lon2);
    }
  }

  void handlePaymentSuccess(PaymentSuccessResponse response) {
    debugPrint("++++++++++++++++++++++++ Payment success :");
    orderParcelApi(response.paymentId);
  }

  void handlePaymentError(PaymentFailureResponse response) {
    isPaymentLoding = false;
    setState(() {});
    debugPrint("++++++++++++++++++++++++ Payment failed : $response");
  }

  void handleExternalWallet(ExternalWalletResponse response) {
    isPaymentLoding = false;
    setState(() {});
  }

  signinreturn() {
    setState(() {
      lat1 = getdata.read("PickupAddress")[0]["lat_map"];
      lon1 = getdata.read("PickupAddress")[0]["long_map"];
      phno = getdata.read("PickupAddress")[0]["hno"];
      plandmark = getdata.read("PickupAddress")[0]["landmark"];
      paddress = getdata.read("PickupAddress")[0]["address"];
      paddresstype = getdata.read("PickupAddress")[0]["type"];
      pname = getdata.read("PickupAddress")[0]["c_name"]?.toString();
      // Fallback to logged-in user name if address doesn't have name
      if (pname == null || pname!.isEmpty || pname == "null") {
        try {
          var userLogin = getdata.read("UserLogin");
          if (userLogin != null && userLogin is Map && userLogin["name"] != null) {
            pname = userLogin["name"].toString();
          }
        } catch (e) {
          debugPrint("Error getting user name: $e");
        }
      }
      custNumber = getdata.read("PickupAddress")[0]["c_number"]?.toString() ?? "";
      // Fallback to logged-in user mobile if address doesn't have number
      if (custNumber.isEmpty || custNumber == "null") {
        try {
          var userLogin = getdata.read("UserLogin");
          if (userLogin != null && userLogin is Map && userLogin["mobile"] != null) {
            String ccode = userLogin["ccode"]?.toString() ?? "";
            custNumber = "$ccode${userLogin["mobile"].toString()}";
          }
        } catch (e) {
          debugPrint("Error getting user mobile: $e");
        }
      }
      addAdressApi("Pickup");
    });
    setState(() {
      lat2 = getdata.read("DropeAddress")[0]["lat_map"];
      lon2 = getdata.read("DropeAddress")[0]["long_map"];
      dhno = getdata.read("DropeAddress")[0]["hno"];
      dlandmark = getdata.read("DropeAddress")[0]["landmark"];

      daddress = getdata.read("DropeAddress")[0]["address"];
      daddresstype = getdata.read("DropeAddress")[0]["type"];
      dropNumber = getdata.read("DropeAddress")[0]["c_number"];
// ✅ ADD THIS WHEREVER ADDRESS CHANGES
      if (lat1 != null && lat2 != null && lon1 != null && lon2 != null) {
        calculateDistance(lat1, lon1, lat2, lon2);

        // ✅ UPDATE DELIVERY FEES BASED ON NEW DISTANCE
        if (selectedDeliveryTypeIndexes.isNotEmpty) {
          _updateDeliveryFeesForMultiSelect();
        }
      }      addAdressApi("Drope");
    });
    setState(() {
      taskDetail = getdata.read("TaskDetails")["taskDetail"];
      taskselectitem = getdata.read("TaskDetails")["itemvalue"];
    });
  }

  void _addComprehensiveDebugLogs() {
    debugPrint("=== 🚀 PICKUP DROP DEBUG LOGS ===");
    debugPrint("📍 Pickup: $paddress (lat: $lat1, lon: $lon1)");
    debugPrint("📍 Drop: $daddress (lat: $lat2, lon: $lon2)");
    debugPrint("📏 Distance: ${totaldistance.toStringAsFixed(2)} km");
    debugPrint("🎯 Selected Wheeler: $selectedWheelerName");
    debugPrint("💰 Min Charge: $minCharge, Pickup Charges: $pickupCharges");
    debugPrint("📦 Delivery Types Count: ${deliveryTypes.length}");
    debugPrint("✅ Selected Delivery Indexes: $selectedDeliveryTypeIndexes");

    if (deliveryTypes.isNotEmpty && selectedDeliveryTypeIndexes.isNotEmpty) {
      debugPrint("🎯 Highest-cost Delivery: ${deliveryTypes[selectedDeliveryTypeIndex]}");
    }

    debugPrint("💳 Final Delivery Fees: $currency$deliveryfees");
    debugPrint("=== 🏁 END DEBUG LOGS ===");
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    debugPrint("🟡 CALCULATE DISTANCE CALLED");
    debugPrint("📍 Pickup: lat=$lat1, lon=$lon1");
    debugPrint("📍 Drop: lat=$lat2, lon=$lon2");

    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
      debugPrint("⚠️ WARNING: Lat/Lon is null!");
      totaldistance = 1.0;
      return totaldistance;
    }

    // ✅ SAME OR NEARLY SAME LOCATION CHECK (difference < 0.0001 degrees is approx < 10 meters)
    double latDiff = (lat1 - lat2).abs();
    double lonDiff = (lon1 - lon2).abs();

    if ((lat1 == lat2 && lon1 == lon2) || (latDiff < 0.0001 && lonDiff < 0.0001)) {
      debugPrint("⚠️ WARNING: Pickup and Drop locations are same or extremely close!");
      totaldistance = 1.0; // Minimum distance for same/close location
      setState(() {});

      if (selectedDeliveryTypeIndexes.isNotEmpty) {
        _updateDeliveryFeesForMultiSelect();
      }
      return totaldistance;
    }

    // ✅ HAVERSINE AIR DISTANCE WITH 1.25x ROAD FACTOR FOR ACCURATE ESTIMATE
    var p = 0.017453292519943295;
    var c = cos;
    var a = 0.5 -
        c((lat2 - lat1) * p) / 2 +
        c(lat1 * p) * c(lat2 * p) *
            (1 - c((lon2 - lon1) * p)) / 2;

    double airDistance = 12742 * asin(sqrt(a)); // Straight-line distance in kilometers

    // Convert straight-line distance to estimated road driving distance (1.25x road factor)
    double estimatedRoadDist = airDistance * 1.25;

    // Enforce minimum distance if calculated distance is <= 0 or extremely close (< 0.1 km)
    if (estimatedRoadDist.isNaN || estimatedRoadDist.isInfinite || estimatedRoadDist < 0.1) {
      totaldistance = 1.0;
    } else {
      totaldistance = double.parse(estimatedRoadDist.toStringAsFixed(2));
      if (totaldistance <= 0) {
        totaldistance = 1.0;
      }
    }

    debugPrint("📏 Initial Estimated Distance: ${totaldistance.toStringAsFixed(2)} km");

    // Fetch exact driving distance from backend get_distance.php API
    _fetchDistanceApi(lat1, lon1, lat2, lon2);

    // ✅ UPDATE ALL DELIVERY TYPE COSTS BASED ON NEW DISTANCE
    _updateAllDeliveryTypeCosts();

    // ✅ UPDATE FEES AFTER DISTANCE CALCULATION
    if (selectedDeliveryTypeIndexes.isNotEmpty) {
      _updateDeliveryFeesForMultiSelect();
    } else if (deliveryTypes.isNotEmpty) {
      // Auto-select first delivery type if none selected
      selectedDeliveryTypeIndexes.add(0);
      _updateDeliveryFeesForMultiSelect();
    }

    setState(() {});
    return totaldistance;
  }

  Future<void> _fetchDistanceApi(double l1, double lo1, double l2, double lo2) async {
    try {
      Map<String, dynamic> data = {
        "pickup_lat": l1,
        "pickup_lng": lo1,
        "drop_lat": l2,
        "drop_lng": lo2,
      };
      debugPrint("📡 Requesting distance from Node (${Config.nodeDistance}): $data");

      ApiWrapper.dataPostNode(Config.nodeDistance, data).then((val) {
        debugPrint("🟢 Node distance API RESPONSE: $val");
        if (val != null && val is Map) {
          if (val['ResponseCode'] == "200" && (val['Result'] == "true" || val['Result'] == true)) {
            var distanceData = val['DistanceData'];
            if (distanceData != null && distanceData is Map) {
              double distKm = double.tryParse(distanceData['distance_km']?.toString() ?? '0') ?? 0.0;
              if (distKm > 0) {
                debugPrint("✅ [GET_DISTANCE API] Received distance_km: $distKm km");
                if (mounted) {
                  setState(() {
                    totaldistance = distKm;
                    _updateAllDeliveryTypeCosts();
                    if (selectedDeliveryTypeIndexes.isNotEmpty) {
                      _updateDeliveryFeesForMultiSelect();
                    }
                  });
                }
              }
            }
          }
        }
      });
    } catch (e) {
      debugPrint("🔴 Error calling get_distance.php API: $e");
    }
  }


  //! User login Add Address Api
  addAdressApi(String pickuptype) {
    var pickupdata = {
      "uid": getdata.read("Uid") ?? "",
      "address": getdata.read("PickupAddress")[0]["address"],
      "houseno": getdata.read("PickupAddress")[0]["hno"],
      "type": getdata.read("PickupAddress")[0]["type"],
      "lat_map": getdata.read("PickupAddress")[0]["lat_map"],
      "long_map": getdata.read("PickupAddress")[0]["long_map"],
      "aid": "0",
      "c_name": getdata.read("PickupAddress")[0]["c_name"],
      "c_number": getdata.read("DropeAddress")[0]["c_number"],
      "landmark": getdata.read("PickupAddress")[0]["landmark"] ?? ""
    };
    var dropepdata = {
      "uid": getdata.read("Uid") ?? "",
      "address": getdata.read("DropeAddress")[0]["address"],
      "houseno": getdata.read("DropeAddress")[0]["hno"],
      "type": getdata.read("DropeAddress")[0]["type"],
      "lat_map": getdata.read("DropeAddress")[0]["lat_map"],
      "long_map": getdata.read("DropeAddress")[0]["long_map"],
      "aid": "0",
      "c_name": getdata.read("DropeAddress")[0]["c_name"],
      "c_number": getdata.read("DropeAddress")[0]["c_number"],
      "landmark": getdata.read("DropeAddress")[0]["landmark"] ?? ""
    };
    ApiWrapper.dataPost(Config.addressUser,
            pickuptype == "Pickup" ? pickupdata : dropepdata)
        .then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
        }
      }
    });
  }

  double _calculateExtraKmChargesForRate(double perKmRate) {
    if (_selectedKm > 1) {
      return (_selectedKm - 1) * perKmRate;
    }
    return 0.0;
  }

  double get _currentExtraKmCharges {
    double perKmRate = pickupCharges;
    if (selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty) {
      int bestIdx = _highestCostSelectedIndex;
      if (bestIdx != -1 && bestIdx < deliveryTypes.length) {
        var item = deliveryTypes[bestIdx];
        double pickupPerKm = double.tryParse(item['pickup_per_km_charge']?.toString() ?? '') ??
            double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
        if (pickupPerKm > 0) {
          perKmRate = pickupPerKm;
        }
      }
    }
    return _calculateExtraKmChargesForRate(perKmRate);
  }

  // Calculate extra charges based on KM selection
  void _calculateExtraCharges() {
    setState(() {
      _extraKmCharges = _currentExtraKmCharges;

      // Update all delivery type costs based on distance
      _updateAllDeliveryTypeCosts();

      // Update total delivery fees with extra charges
      if (selectedDeliveryTypeIndexes.isNotEmpty) {
        _updateDeliveryFeesForMultiSelect();
      }
    });
  }

  // Update all delivery type costs based on current distance
  void _updateAllDeliveryTypeCosts() {
    _extraKmCharges = _currentExtraKmCharges;

    for (var i = 0; i < deliveryTypes.length; i++) {
      var item = deliveryTypes[i];
      
      double perKmCharge = double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
      double pickupPerKm = double.tryParse(item['pickup_per_km_charge']?.toString() ?? '') ?? perKmCharge;
      double minChargeValue = double.tryParse(item['min_charge']?.toString() ?? '0') ?? 0.0;
      double serviceChargePercent = double.tryParse(item['service_charge_percent']?.toString() ?? '0') ?? 0.0;
      double waitingCharge = double.tryParse(item['waiting_charge']?.toString() ?? '0') ?? 0.0;
      double nightChargeFixed = double.tryParse(item['applied_night_charge_percent']?.toString() ?? '0') ?? 0.0;
      int isNight = int.tryParse(item['is_night']?.toString() ?? '0') ?? 0;

      // Calculate all charges dynamically
      double deliveryChargeAmount = perKmCharge * totaldistance;
      double serviceChargeAmount = (serviceChargePercent / 100) * deliveryChargeAmount;
      double nightChargeAmount = (isNight == 1) ? nightChargeFixed : 0.0;

      double pickupChargesAmount = _calculateExtraKmChargesForRate(pickupPerKm > 0 ? pickupPerKm : pickupCharges);
      double minimumChargeAmount = minChargeValue;

      // waitingCharge is NOT part of the upfront fare — it's only ever
      // charged after a trip completes, based on actual wait time beyond
      // free_waiting_time (see the Node backend's tripLifecycle.js
      // 'complete' handler). Node's own authoritative fare formula
      // (pricingEngine.calculateFare, matching the live PHP backend's
      // pks_order.php) never adds it either — including it here made this
      // screen's estimate a flat ₹waiting_charge higher than what the
      // driver's popup (and the order's actual charge) shows for every
      // single model, since every model has its own non-zero waiting_charge.
      double totalCost = pickupChargesAmount + minimumChargeAmount + serviceChargeAmount + deliveryChargeAmount + nightChargeAmount;
      // Whole-rupee rounded — matches Node's calculateFare exactly, so this
      // screen's estimate is the same number the driver's popup and the
      // order's actual charge end up showing, not off by rounding.
      totalCost = totalCost.roundToDouble();

      deliveryTypes[i]['cost'] = '$currency${totalCost.toStringAsFixed(0)}';
      deliveryTypes[i]['calculatedCost'] = totalCost;
      deliveryTypes[i]['deliveryChargeOnly'] = deliveryChargeAmount;
      deliveryTypes[i]['serviceChargeAmount'] = serviceChargeAmount;
      deliveryTypes[i]['nightChargeAmount'] = nightChargeAmount;
      deliveryTypes[i]['waitingChargeAmount'] = waitingCharge;
    }
    setState(() {});
  }
  Widget _buildDeliveryTypeRow(
      String type,
      String cost,
     // String time,
      bool isSelected,
      Function(bool) onSwitchChanged,
      ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            flex: 2,
            child: Text(
              type,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: notifier.text,
              ),
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              cost,
              style: TextStyle(
                color: notifier.text,
              ),
            ),
          ),
          /*Expanded(
            flex: 3,
            child: Text(
              time,
              style: TextStyle(
                color: notifier.text,
              ),
            ),
          ),*/
          Expanded(
            flex: 2,
            child: Switch(
              value: isSelected,
              onChanged: onSwitchChanged,
              activeColor: linercolor,
            ),
          ),
        ],
      ),
    );
  }



  void showPaymentConfirmationDialog() {
    // ✅ ADD VALIDATION HERE
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
      tostmsg("Please select both pickup and drop locations");
      return;
    }

    if (paddresstype == null || daddresstype == null) {
      tostmsg("Please select address types");
      return;
    }

    if (custNumber.isEmpty || dropNumber.isEmpty) {
      tostmsg("Please ensure contact numbers are provided");
      return;
    }

    if (deliveryfees <= 0) {
      tostmsg("Delivery fees calculation error. Please reselect locations.");
      return;
    }

    _fetchWalletBalance().then((walletBalance) {
      int selectedPaymentMethod = 2; // 1 for Wallet, 2 for COD (Default Cash)
      showDialog(
        context: context,
        barrierDismissible: true,
        builder: (BuildContext context) {
          return StatefulBuilder(
            builder: (context, setDialogState) {
              return Dialog(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
                backgroundColor: notifier.lightBgColor,
                child: Container(
                  padding: EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header
                      Center(
                        child: Text(
                          "Select Payment Method".tr,
                          style: TextStyle(
                            fontSize: 20,
                            color: notifier.text,
                            fontFamily: 'Gilroy_Bold',
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      SizedBox(height: 20),

                      // Payment Methods Title
                      Text(
                        "Payment Methods".tr,
                        style: TextStyle(
                          fontSize: 16,
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                        ),
                      ),
                      SizedBox(height: 15),

                      // Cash Option (Top)
                      GestureDetector(
                        onTap: () {
                          setDialogState(() {
                            selectedPaymentMethod = 2;
                          });
                        },
                        child: Container(
                          width: double.infinity,
                          padding: EdgeInsets.symmetric(horizontal: 15, vertical: 12),
                          decoration: BoxDecoration(
                            color: selectedPaymentMethod == 2 ? notifier.darklinercolor.withOpacity(0.1) : notifier.getBgColor,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: selectedPaymentMethod == 2 ? notifier.darklinercolor : notifier.bordecolor,
                              width: selectedPaymentMethod == 2 ? 2 : 1,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.money, color: notifier.darklinercolor),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  "Cash".tr,
                                  style: TextStyle(
                                    color: notifier.text,
                                    fontFamily: 'Gilroy_Medium',
                                  ),
                                ),
                              ),
                              SizedBox(width: 10),
                              if (selectedPaymentMethod == 2)
                                Icon(Icons.check_circle, color: notifier.darklinercolor),
                            ],
                          ),
                        ),
                      ),
                      SizedBox(height: 10),

                      // Shifter Wallet Option with actual balance (Bottom)
                      GestureDetector(
                        onTap: () {
                          setDialogState(() {
                            selectedPaymentMethod = 1;
                          });
                        },
                        child: Container(
                          width: double.infinity,
                          padding: EdgeInsets.symmetric(horizontal: 15, vertical: 12),
                          decoration: BoxDecoration(
                            color: selectedPaymentMethod == 1 ? notifier.darklinercolor.withOpacity(0.1) : notifier.getBgColor,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: selectedPaymentMethod == 1 ? notifier.darklinercolor : notifier.bordecolor,
                              width: selectedPaymentMethod == 1 ? 2 : 1,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.credit_card, color: notifier.darklinercolor),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  "Shifter Wallet (₹${walletBalance.toStringAsFixed(2)})".tr,
                                  style: TextStyle(
                                    color: notifier.text,
                                    fontFamily: 'Gilroy_Medium',
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              SizedBox(width: 10),
                              // Show "ADD MONEY" button if wallet balance is low
                              if (walletBalance < deliveryfees && selectedPaymentMethod == 1)
                                GestureDetector(
                                  onTap: () {
                                    Get.back(); // Close payment dialog
                                    Get.to(() => WalletPage()); // Navigate to wallet page
                                  },
                                  child: Container(
                                    constraints: BoxConstraints(
                                      minWidth: 80,
                                    ),
                                    child: Text(
                                      "ADD MONEY".tr,
                                      style: TextStyle(
                                        color: notifier.darklinercolor,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 12,
                                      ),
                                      textAlign: TextAlign.right,
                                    ),
                                  ),
                                )
                              else if (selectedPaymentMethod == 1)
                                Icon(Icons.check_circle, color: notifier.darklinercolor),
                            ],
                          ),
                        ),
                      ),
                      SizedBox(height: 20),

                      // Terms Text
                      Text(
                        "By booking you agree to our new terms of service and privacy policy".tr,
                        style: TextStyle(
                          fontSize: 12,
                          color: greaycolor,
                          fontFamily: 'Gilroy_Medium',
                        ),
                        textAlign: TextAlign.center,
                      ),
                      SizedBox(height: 20),

                      // Confirm Payment Button with wallet balance check
                      Container(
                        width: double.infinity,
                        height: 50,
                        child: ElevatedButton(
                          onPressed: () {
                            if (selectedPaymentMethod == 1) {
                              // Check if wallet balance is sufficient for wallet payment
                              if (walletBalance >= deliveryfees) {
                                // Process wallet payment
                                setState(() {
                                  paymenttital = "Wallet";
                                  _payValue = -2; // Wallet payment identifier
                                  isPaymentLoding = true;
                                });
                                processWalletPayment(fromDialog: true);
                              } else {
                                // Show insufficient balance message
                                tostmsg("Insufficient wallet balance. Please add money to your wallet.".tr);
                              }
                            } else if (selectedPaymentMethod == 2) {
                              // Process COD payment
                              setState(() {
                                paymenttital = "Cash";
                                _payValue = 1; // Cash payment identifier
                                isPaymentLoding = true;
                              });
                              processCashPayment();
                            }
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: (selectedPaymentMethod == 1 && walletBalance < deliveryfees)
                                ? Colors.grey
                                : notifier.darklinercolor,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: Text(
                            (selectedPaymentMethod == 1 && walletBalance < deliveryfees)
                                ? "Insufficient Balance".tr
                                : "Confirm\n Amount $currency${deliveryfees.toStringAsFixed(2)}".tr,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: whitecolor,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(height: 10),

                      // View Breakup Button
                      TextButton(
                        onPressed: () {
                          // Show price breakdown
                          showPriceBreakupDialog();
                        },
                        child: Text(
                          "View Breakup".tr,
                          style: TextStyle(
                            color: notifier.darklinercolor,
                            fontFamily: 'Gilroy_Bold',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      );
    });

  }



// Add this method to fetch wallet balance
  Future<double> _fetchWalletBalance() async {
    try {
      var mobile = getdata.read("UserLogin")["mobile"];
      var data = {
        "mobile": mobile,
        "wallet_type": "user"
      };

      var response = await ApiWrapper.dataPost(Config.walletHistory, data);

      if (response != null && response.isNotEmpty) {
        if (response['Result'] == true || response['Result'] == "true") {
          double balance = double.tryParse(response["wallet_balance"]?.toString() ?? "0.0") ?? 0.0;
          debugPrint("🟢 Wallet Balance Fetched: ₹$balance");
          return balance;
        }
      }
      return 0.0;
    } catch (e) {
      debugPrint("🔴 Error fetching wallet balance: $e");
      return 0.0;
    }
  }

// Add this method for wallet payment processing
  void processWalletPayment({bool fromDialog = false}) {
    // For wallet payment, deduct amount from wallet and proceed
    if (fromDialog) {
      Get.back(); // Close payment dialog
    }

    // Check if wallet has sufficient balance one more time before proceeding
    _fetchWalletBalance().then((walletBalance) {
      if (walletBalance >= deliveryfees) {
        // Process wallet payment
        deductWalletAmount().then((success) {
          if (success) {
            orderParcelApi("wallet_payment_${DateTime.now().millisecondsSinceEpoch}");
          } else {
            setState(() {
              isPaymentLoding = false;
            });
            tostmsg("Wallet payment failed. Please try again.".tr);
          }
        });
      } else {
        setState(() {
          isPaymentLoding = false;
        });
        tostmsg("Insufficient wallet balance. Please add money to your wallet.".tr);
      }
    });
  }

// Add this method to deduct amount from wallet
  Future<bool> deductWalletAmount() async {
    try {
      var mobile = getdata.read("UserLogin")["mobile"];
      var data = {
        "mobile": mobile,
        "wallet_type": "user",
        "amount": deliveryfees.toStringAsFixed(2),
        "remark": "Payment for $selectedWheelerName delivery"
      };

      var response = await ApiWrapper.dataPost(Config.withdrawWallet, data);

      if (response != null && response.isNotEmpty) {
        if (response['Result'] == true || response['Result'] == "true") {
          debugPrint("🟢 Wallet amount deducted successfully");
          return true;
        }
      }
      return false;
    } catch (e) {
      debugPrint("🔴 Error deducting wallet amount: $e");
      return false;
    }
  }

  void processCashPayment() {
    // For cash payment, we can proceed directly without payment gateway
    Get.back(); // Close payment dialog
    orderParcelApi("cash_payment_${DateTime.now().millisecondsSinceEpoch}");
  }

  void showPriceBreakupDialog() {
    // ✅ Get all values from selected delivery type dynamically
    double pickupChargesAmount = _currentExtraKmCharges;
    double minimumChargeAmount = 0.0;
    double serviceChargeAmount = 0.0;
    double deliveryChargeAmount = 0.0;
    double waitingChargeAmount = 0.0;
    double nightChargeAmount = 0.0;
    int isNight = 0;

    if (selectedDeliveryTypeIndex != -1 && deliveryTypes.isNotEmpty) {
      var item = deliveryTypes[selectedDeliveryTypeIndex];
      
      double perKmCharge = double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
      minimumChargeAmount = double.tryParse(item['min_charge']?.toString() ?? '0') ?? 0.0;
      double serviceChargePercent = double.tryParse(item['service_charge_percent']?.toString() ?? '0') ?? 0.0;
      // waitingChargeAmount = double.tryParse(item['waiting_charge']?.toString() ?? '0') ?? 0.0;
      waitingChargeAmount = 0.0; // Waiting charge disabled
      double nightChargeFixed = double.tryParse(item['applied_night_charge_percent']?.toString() ?? '0') ?? 0.0;
      isNight = int.tryParse(item['is_night']?.toString() ?? '0') ?? 0;

      // Calculate charges
      deliveryChargeAmount = perKmCharge * totaldistance;
      serviceChargeAmount = (serviceChargePercent / 100) * deliveryChargeAmount;
      nightChargeAmount = (isNight == 1) ? nightChargeFixed : 0.0;
    }

    showDialog(
      context: context,
      builder: (BuildContext context) {
        return Dialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          backgroundColor: notifier.lightBgColor,
          child: Container(
            padding: EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Price Breakup".tr,
                  style: TextStyle(
                    fontSize: 18,
                    color: notifier.text,
                    fontFamily: 'Gilroy_Bold',
                  ),
                ),
                SizedBox(height: 15),

                // Pickup Charges
                if (pickupChargesAmount > 0)
                  priceBreakupRow(
                    "Pickup Charges",
                    "$currency${pickupChargesAmount.toStringAsFixed(2)}"
                  ),

                // Minimum Charge
                if (minimumChargeAmount > 0)
                  priceBreakupRow(
                    "Minimum Charge",
                    "$currency${minimumChargeAmount.toStringAsFixed(2)}"
                  ),

                // Service Charge
                if (serviceChargeAmount > 0)
                  priceBreakupRow(
                    "Service Charge",
                    "$currency${serviceChargeAmount.toStringAsFixed(2)}"
                  ),

                // Delivery Charge
                priceBreakupRow(
                  "Delivery Charge (${totaldistance.toStringAsFixed(2)} km)",
                  "$currency${deliveryChargeAmount.toStringAsFixed(2)}"
                ),

                // Waiting Charge (Disabled)
                /* if (waitingChargeAmount > 0)
                  priceBreakupRow(
                    "Waiting Charge",
                    "$currency${waitingChargeAmount.toStringAsFixed(2)}"
                  ), */

                // Night Charge (only if is_night == 1)
                if (isNight == 1 && nightChargeAmount > 0)
                  priceBreakupRow(
                    "Night Charge",
                    "$currency${nightChargeAmount.toStringAsFixed(2)}"
                  ),

                // Coupon Discount
                if (double.parse(camount!) > 0)
                  priceBreakupRow(
                    "Coupon Discount",
                    "- $currency$camount"
                  ),

                Divider(color: greaycolor),

                // Total
                priceBreakupRow(
                  "Total Amount",
                  "$currency${deliveryfees.toStringAsFixed(2)}",
                  isBold: true
                ),

                SizedBox(height: 20),

                Center(
                  child: ElevatedButton(
                    onPressed: () => Get.back(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: notifier.darklinercolor,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: Text(
                      "Close".tr,
                      style: TextStyle(color: whitecolor),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildBillBreakdown() {
    // ✅ Yahan calculate karo aur variables store karo
    double selectedKmForBill = _getSelectedKmForBill();
    double pickupChargesAmount = _currentExtraKmCharges;
    double serviceChargeAmount = minCharge;
    double deliveryChargeAmount = selectedKmForBill * totaldistance;

    // ✅ DEBUG EK HI BAAR
    debugPrint("🧾 Bill Breakdown - Selected KM: $selectedKmForBill, Distance: $totaldistance, Delivery Charge: $deliveryChargeAmount");

    return Column(
      children: [
        // 1. Pickup charges
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text("Pickup charges".tr),
            Text("$currency${pickupChargesAmount.toStringAsFixed(2)}"),
          ],
        ),
        SizedBox(height: 10),

        // 2. Service charge
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text("Service charge".tr),
            Text("$currency${serviceChargeAmount.toStringAsFixed(2)}"),
          ],
        ),
        SizedBox(height: 10),

        // 3. Delivery Charge
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text("Delivery Charge".tr),
            Text("$currency${deliveryChargeAmount.toStringAsFixed(2)}"),
          ],
        ),
        SizedBox(height: 10),

        // ... rest of bill breakdown
      ],
    );
  }

  Widget priceBreakupRow(String title, String amount, {bool isBold = false}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: TextStyle(
              color: notifier.text,
              fontFamily: isBold ? 'Gilroy_Bold' : 'Gilroy_Medium',
              fontSize: 14,
            ),
          ),
          Text(
            amount,
            style: TextStyle(
              color: isBold ? notifier.darklinercolor : notifier.text,
              fontFamily: isBold ? 'Gilroy_Bold' : 'Gilroy_Medium',
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
     // bottomNavigationBar:dropnote.text.isNotEmpty && paddresstype != null && daddresstype != null
      bottomNavigationBar: paddresstype != null && daddresstype != null
          ? Container(
        padding: EdgeInsets.only(
          left: 10,
          right: 10,
          top: 5,
          bottom: MediaQuery.of(context).padding.bottom + 10,
        ),
        width: Get.width,
        color: notifier.lightBgColor,
        child: appButton(
          onTap: () {
            if (firstLogin == true) {
              if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
                tostmsg("Please select both pickup and drop locations");
                return;
              }

              // ✅ FIX: Safety-net recalculation
              if (totaldistance <= 0) {
                debugPrint("🔴 [SAFETY-NET] totaldistance was 0 before booking — recalculating now");
                calculateDistance(lat1, lon1, lat2, lon2);
                debugPrint("🟢 [SAFETY-NET] Recalculated totaldistance = $totaldistance");
              }

              if (paddresstype == null || daddresstype == null) {
                tostmsg("Please select address types");
                return;
              }

              if (custNumber.isEmpty || dropNumber.isEmpty) {
                tostmsg("Please ensure contact numbers are provided");
                return;
              }

              if (deliveryfees <= 0) {
                tostmsg("Delivery fees calculation error. Please reselect locations.");
                return;
              }

              // ✅ FINAL CALCULATION EK HI BAAR
              _calculateFinalFees();

              if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
                // Get delivery type IDs (comma-separated) before navigating
                String deliveryTypeId = "0";
                if (selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty) {
                  deliveryTypeId = selectedDeliveryTypeIndexes
                      .map((i) => deliveryTypes[i]['id']?.toString() ?? "0")
                      .join(',');
                }

                _fetchWalletBalance().then((walletBalance) {
                  Get.to(() => ConfirmOrderMap(
                    startLat: lat1!,
                    startLng: lon1!,
                    endLat: lat2!,
                    endLng: lon2!,
                    deliveryFees: deliveryfees,
                    walletBalance: walletBalance,
                    currency: currency ?? '',
                    deliveryType: deliveryTypeId,
                    onConfirmPayment: (int payValue, String paymentTitle) {
                      setState(() {
                        paymenttital = paymentTitle;
                        _payValue = payValue;
                        isPaymentLoding = true;
                      });
                      if (payValue == -2) {
                        processWalletPayment(fromDialog: false);
                      } else if (payValue == 1) {
                        processCashPayment();
                      }
                    },
                    onViewBreakup: () {
                      showPriceBreakupDialog();
                    },
                  ));
                });
              }
            } else {
              Get.to(() => SignIn(paymenttype: "payment"))!.then((value) {
                initStatData();
              });
            }
          },
          tital: "Book $selectedWheelerName".tr, // ← YAHAN DYNAMIC NAME AAYEGA
        ),
      )
          : SizedBox(height: 0,width: 0),
      appBar: AppBar(
        backgroundColor: linercolor,
        elevation: 0,
        centerTitle: true,
        title: Text(
          "Set up your task".tr,
          style: TextStyle(
            color: whitecolor,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
      ),
      body: Container(
        width: Get.width,
        height: Get.height,
        padding: EdgeInsets.only(top: 1.5),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: isLoading
        ? Center(child: CircularProgressIndicator(color: linercolor))
        : Stack(
          children: [
            SingleChildScrollView(
              padding: EdgeInsets.all(15),
              physics: BouncingScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Pickup and drop were already confirmed on the previous
                  // screens. Keep their values in state/storage for booking,
                  // but do not show an editable location section here.
                  if (false) Container(
                    decoration: BoxDecoration(
                      color: notifier.getBgColor,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: EdgeInsets.only(top: 10, left: 10, right: 10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "Pickup location".tr,
                                style: TextStyle(
                                  color: greaycolor,
                                  fontFamily: "Gilroy_Medium",
                                ),
                              ),
                              SizedBox(height: 5),
                              InkWell(
                                onTap: () {
                                  if (addressList.isNotEmpty) {
                                    bottomsheets(context, "Pickup").then((value) {
                                      setState(() {
                                        checkAddress();
                                      });
                                      cid = "0";
                                      camount = "0";
                                      couponcode = "Apply Now";
                                      setState(() {});
                                    });
                                  } else {
                                    getdata.remove("PickupAddress");
                                    Get.to(() => Traking(type: "Pickup", addressAdd: "0"))!.then((value) {
                                      if (value != null && value != "back") {
                                        setState(() {
                                          pick = true;
                                          changepick = pick;
                                          lat1 = getdata.read("PickupAddress")[0]["lat_map"];
                                          changelat1 = lat1;
                                          lon1 = getdata.read("PickupAddress")[0]["long_map"];
                                          changelon1 = lon1;
                                          phno = getdata.read("PickupAddress")[0]["hno"];
                                          changephno = phno;
                                          pname = getdata.read("PickupAddress")[0]["c_name"]?.toString();
                                          // Fallback to logged-in user name if address doesn't have name
                                          if (pname == null || pname!.isEmpty || pname == "null") {
                                            try {
                                              var userLogin = getdata.read("UserLogin");
                                              if (userLogin != null && userLogin is Map && userLogin["name"] != null) {
                                                pname = userLogin["name"].toString();
                                              }
                                            } catch (e) {
                                              debugPrint("Error getting user name: $e");
                                            }
                                          }
                                          changepname = pname;
                                          plandmark = getdata.read("PickupAddress")[0]["landmark"];
                                          changeplandmark = plandmark;
                                          paddress = getdata.read("PickupAddress")[0]["address"];
                                          changepaddress = paddress;
                                          paddresstype = getdata.read("PickupAddress")[0]["type"];
                                          changepaddresstype = paddresstype;
                                          custNumber = getdata.read("PickupAddress")[0]["c_number"]?.toString() ?? "";
                                          // Fallback to logged-in user mobile if address doesn't have number
                                          if (custNumber.isEmpty || custNumber == "null") {
                                            try {
                                              var userLogin = getdata.read("UserLogin");
                                              if (userLogin != null && userLogin is Map && userLogin["mobile"] != null) {
                                                String ccode = userLogin["ccode"]?.toString() ?? "";
                                                custNumber = "$ccode${userLogin["mobile"].toString()}";
                                              }
                                            } catch (e) {
                                              debugPrint("Error getting user mobile: $e");
                                            }
                                          }
                                          changecustNumber = custNumber;
                                        });
                                        if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                          calculateDistance(lat1, lon1, lat2, lon2);
                                        }
                                      }
                                    });
                                  }
                                },
                                child: Column(
                                  children: [
                                    Row(
                                      crossAxisAlignment: CrossAxisAlignment.center,
                                      children: [
                                        Image.asset(
                                          "assets/radio.png",
                                          height: 25,
                                        ),
                                        SizedBox(width: 10),
                                        Expanded(
                                          child: paddresstype == null
                                              ? Text(
                                                  paddress ?? "Fetching location...".tr,
                                                  textAlign: TextAlign.left,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(color: greaycolor),
                                                )
                                              : Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text(
                                                      "$paddresstype",
                                                      style: TextStyle(
                                                        color: notifier.text,
                                                        fontFamily: 'Gilroy_Bold',
                                                        fontSize: 15,
                                                      ),
                                                    ),
                                                    Text(
                                                      plandmark != ""
                                                          ? "$phno, " "$plandmark, " "$paddress"
                                                          : "$phno, " "$paddress",
                                                      maxLines: 2,
                                                      overflow: TextOverflow.ellipsis,
                                                      style: TextStyle(
                                                        color: greaycolor.withOpacity(0.8),
                                                        fontFamily: 'Gilroy_Medium',
                                                        fontSize: 12,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                        ),
                                       /* Icon(
                                          Icons.arrow_forward_ios,
                                          color: greaycolor,
                                          size: 20,
                                        ),*/
                                      ],
                                    ),
                                    paddresstype == null
                                    ? SizedBox()
                                    : SizedBox(height: 8),
                                    paddresstype == null
                                    ? SizedBox()
                                    : addressCustomerdetails(
                                        name: "$pname",
                                        number: custNumber,
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Expanded(
                              child: Container(
                                height: 1,
                                color: greaycolor.withOpacity(0.4),
                              ),
                            ),
                            InkWell(
                              onTap: () {
                                if (paddresstype != null && daddresstype != null) {
                                  setState(() {
                                    pick = changedrop;
                                    lat1 = changelat2;
                                    lon1 = changelon2;
                                    phno = changedhno;
                                    plandmark = changedlandmark;
                                    paddress = changedaddress;
                                    paddresstype = changedaddresstype;
                                    pname = changedname;
                                    custNumber = changedropNumber;
                                    paddressID = changepaddressID;
                                    daddressID = changedaddressID;
                                    addressId = changeaddressId;
                                    drop = changepick;
                                    lat2 = changelat2;
                                    lon2 = changelon2;
                                    dhno = changephno;
                                    dlandmark = changeplandmark;
                                    daddress = changepaddress;
                                    daddresstype = changepaddresstype;
                                    dname = changepname;
                                    dropNumber = changecustNumber;
                                  });
                                  setState(() {
                                    changepick = pick;
                                    changedrop = drop;
                                    changelat1 = lat1;
                                    changelon1 = lon1;
                                    changelat2 = lat2;
                                    changelon2 = lon2;
                                    changephno = phno;
                                    changedhno = dhno;
                                    changeplandmark = plandmark;
                                    changedlandmark = dlandmark;
                                    changepaddress = paddress;
                                    changedaddress = daddress;
                                    changepaddresstype = paddresstype;
                                    changedaddresstype = daddresstype;
                                    changecustNumber = custNumber;
                                    changedropNumber = dropNumber;
                                    changepaddressID = paddressID;
                                    changedaddressID = daddressID;
                                    changepaddressID = paddressID;
                                    changedaddressID = daddressID;
                                    changeaddressId = addressId;
                                    changepname = pname;
                                    changedname = dname;
                                  });
                                }
                              },
                              child: Container(
                                padding: EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: notifier.lightBgColor,
                                  borderRadius: BorderRadius.only(
                                    topLeft: Radius.circular(20),
                                    bottomLeft: Radius.circular(20),
                                  ),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    /*SvgPicture.asset(
                                      "assets/arrow-down-arrow-up.svg",
                                      color: notifier.darklinercolor,
                                    ),*/
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        // Main Stop Location 1
                        Container(
                          padding: EdgeInsets.only(bottom: 10, left: 10, right: 10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Drop Location ".tr,
                                    style: TextStyle(
                                      color: greaycolor,
                                      fontFamily: "Gilroy_Medium",
                                      fontSize: 14,
                                    ),
                                  ),
                                  Container(
                                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: linercolor.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(
                                      "Main Drop".tr,
                                      style: TextStyle(
                                        color: linercolor,
                                        fontSize: 10,
                                        fontFamily: 'Gilroy_Bold',
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 8),
                              // Interactive Card Design for Main Drop Location
                              Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  onTap: () {
                                    setState(() {
                                      drop = true;
                                    });
                                    if (addressList.isNotEmpty) {
                                      bottomsheets(context, "Drope").then((value) {
                                        debugPrint("======= value ======= $value");
                                        setState(() {});
                                        cid = "0";
                                        camount = "0";
                                        couponcode = "Apply Now";
                                        setState(() {});
                                      });
                                    } else {
                                      getdata.remove("DropeAddress");
                                      Get.to(
                                            () => const Traking(
                                          type: "Drop",
                                          addressAdd: "0",
                                        ),
                                      )!.then((value) {
                                        if (value != null && value != "back") {
                                          setState(() {
                                            drop = true;
                                            changedrop = drop;
                                            
                                            // Handle return value from Traking screen
                                            var addrData;
                                            // Check if value is a List (legacy/storage format) or Map
                                            if (value is List && value.isNotEmpty) {
                                               addrData = value[0];
                                               // Update GetStorage to sync state
                                               getdata.write("DropeAddress", value);
                                            } else if (value is Map) {
                                               addrData = value;
                                               // Update GetStorage
                                               getdata.write("DropeAddress", [value]);
                                            } else {
                                               // Fallback to storage read
                                               var stored = getdata.read("DropeAddress");
                                               if (stored != null && stored.isNotEmpty) {
                                                   addrData = stored[0];
                                               }
                                            }
                                            
                                            if (addrData != null) {
                                                lat2 = addrData["lat_map"];
                                                changelat2 = lat2;
                                                lon2 = addrData["long_map"];
                                                changelon2 = lon2;
                                                dhno = addrData["hno"];
                                                changedhno = dhno;
                                                dname = addrData["c_name"];
                                                changedname = dname;
                                                dlandmark = addrData["landmark"];
                                                changedlandmark = dlandmark;
                                                daddress = addrData["address"];
                                                changedaddress = daddress;
                                                daddresstype = addrData["type"];
                                                changedaddresstype = daddresstype;
                                                dropNumber = addrData["c_number"];
                                                changedropNumber = dropNumber;
                                                
                                                // Try to refresh address list in background
                                                try {
                                                  checkAddress();
                                                } catch(e) {
                                                  debugPrint("Error calling checkAddress: $e");
                                                }

                                                // Update main drop location
                                                Map<String, dynamic> mainDropData = {
                                                  'id': 'drop_1',
                                                  'type': daddresstype,
                                                  'address': daddress,
                                                  'hno': dhno,
                                                  'landmark': dlandmark,
                                                  'c_name': dname,
                                                  'c_number': dropNumber,
                                                  'lat_map': lat2,
                                                  'long_map': lon2,
                                                  'is_main': true,
                                                };
                                                
                                                if (dropLocations.isEmpty) {
                                                  dropLocations.add(mainDropData);
                                                } else {
                                                  dropLocations[0] = mainDropData;
                                                }

                                                calculateDistance(lat1, lon1, lat2, lon2);
                                            }
                                          });
                                        }
                                      });
                                    }
                                  },
                                  borderRadius: BorderRadius.circular(12),
                                  splashColor: linercolor.withOpacity(0.2),
                                  highlightColor: linercolor.withOpacity(0.1),
                                  child: Container(
                                    width: double.infinity,
                                    decoration: BoxDecoration(
                                      color: daddresstype == null
                                          ? linercolor.withOpacity(0.05)
                                          : notifier.getBgColor,
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(
                                        color: daddresstype == null
                                            ? linercolor.withOpacity(0.5)
                                            : notifier.bordecolor,
                                        width: daddresstype == null ? 2 : 1,
                                      ),
                                      boxShadow: [
                                        BoxShadow(
                                          color: Colors.black.withOpacity(0.05),
                                          blurRadius: 6,
                                          offset: Offset(0, 3),
                                        ),
                                      ],
                                    ),
                                    child: Padding(
                                      padding: EdgeInsets.all(16),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              // Location Icon
                                              Container(
                                                padding: EdgeInsets.all(8),
                                                decoration: BoxDecoration(
                                                  color: daddresstype == null
                                                      ? linercolor.withOpacity(0.1)
                                                      : linercolor,
                                                  shape: BoxShape.circle,
                                                ),
                                                child: Icon(
                                                  daddresstype == null
                                                      ? Icons.add_location_alt_outlined
                                                      : Icons.location_on,
                                                  color: daddresstype == null
                                                      ? linercolor
                                                      : whitecolor,
                                                  size: 20,
                                                ),
                                              ),
                                              SizedBox(width: 12),

                                              // Main Content
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    // Title
                                                    Text(
                                                      daddresstype == null
                                                          ? "Add Main Drop Location".tr
                                                          : "Drop Location".tr,
                                                      style: TextStyle(
                                                        color: daddresstype == null
                                                            ? linercolor
                                                            : notifier.text,
                                                        fontFamily: 'Gilroy_Bold',
                                                        fontSize: 16,
                                                      ),
                                                    ),
                                                    SizedBox(height: 4),

                                                    // Address or Instruction Text
                                                    daddresstype == null
                                                        ? Text(
                                                      "Tap to select main drop-off point".tr,
                                                      style: TextStyle(
                                                        color: greaycolor,
                                                        fontFamily: 'Gilroy_Medium',
                                                        fontSize: 13,
                                                      ),
                                                    )
                                                        : Column(
                                                      crossAxisAlignment: CrossAxisAlignment.start,
                                                      children: [
                                                        // Address Type Badge
                                                        if (daddresstype != null)
                                                          Container(
                                                            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                            decoration: BoxDecoration(
                                                              color: linercolor.withOpacity(0.1),
                                                              borderRadius: BorderRadius.circular(4),
                                                            ),
                                                            child: Text(
                                                              daddresstype!,
                                                              style: TextStyle(
                                                                color: linercolor,
                                                                fontSize: 11,
                                                                fontFamily: 'Gilroy_Bold',
                                                              ),
                                                            ),
                                                          ),
                                                        SizedBox(height: 8),

                                                        // Address Details
                                                        Row(
                                                          children: [
                                                            Icon(
                                                              Icons.location_pin,
                                                              color: greaycolor,
                                                              size: 14,
                                                            ),
                                                            SizedBox(width: 4),
                                                            Expanded(
                                                              child: Text(
                                                                dlandmark != ''
                                                                    ? "$dhno, $dlandmark, $daddress"
                                                                    : "$dhno, $daddress",
                                                                maxLines: 2,
                                                                overflow: TextOverflow.ellipsis,
                                                                style: TextStyle(
                                                                  color: notifier.text,
                                                                  fontFamily: 'Gilroy_Medium',
                                                                  fontSize: 13,
                                                                ),
                                                              ),
                                                            ),
                                                          ],
                                                        ),
                                                      ],
                                                    ),
                                                  ],
                                                ),
                                              ),

                                              // Arrow Icon
                                              Icon(
                                                Icons.arrow_forward_ios,
                                                color: daddresstype == null
                                                    ? linercolor
                                                    : greaycolor,
                                                size: 16,
                                              ),
                                            ],
                                          ),

                                          // Show Customer Details when selected
                                          if (daddresstype != null) ...[
                                            SizedBox(height: 16),
                                            Divider(color: notifier.bordecolor),
                                            SizedBox(height: 12),

                                            // Customer Info
                                            Row(
                                              children: [
                                                Icon(
                                                  Icons.person_outline,
                                                  color: greaycolor,
                                                  size: 16,
                                                ),
                                                SizedBox(width: 8),
                                                Text(
                                                  "$dname",
                                                  style: TextStyle(
                                                    color: notifier.text,
                                                    fontFamily: 'Gilroy_Medium',
                                                    fontSize: 13,
                                                  ),
                                                ),
                                                Spacer(),
                                                Icon(
                                                  Icons.phone_outlined,
                                                  color: greaycolor,
                                                  size: 16,
                                                ),
                                                SizedBox(width: 8),
                                                Text(
                                                  dropNumber,
                                                  style: TextStyle(
                                                    color: notifier.text,
                                                    fontFamily: 'Gilroy_Medium',
                                                    fontSize: 13,
                                                  ),
                                                ),
                                              ],
                                            ),

                                            // Edit Button
                                            SizedBox(height: 12),
                                            Align(
                                              alignment: Alignment.centerRight,
                                              child: InkWell(
                                                onTap: () {
                                                  // Edit functionality for main drop
                                                  Get.to(
                                                        () => const Traking(
                                                      type: "Drop",
                                                      addressAdd: "0",
                                                    ),
                                                  )!.then((value) {
                                                    if (value != null && value != "back") {
                                                      setState(() {
                                                        lat2 = getdata.read("DropeAddress")[0]["lat_map"];
                                                        lon2 = getdata.read("DropeAddress")[0]["long_map"];
                                                        dhno = getdata.read("DropeAddress")[0]["hno"];
                                                        dname = getdata.read("DropeAddress")[0]["c_name"];
                                                        dlandmark = getdata.read("DropeAddress")[0]["landmark"];
                                                        daddress = getdata.read("DropeAddress")[0]["address"];
                                                        daddresstype = getdata.read("DropeAddress")[0]["type"];
                                                        dropNumber = getdata.read("DropeAddress")[0]["c_number"];

                                                        // Update main drop location
                                                        Map<String, dynamic> mainDropData = {
                                                          'id': 'drop_1',
                                                          'type': daddresstype,
                                                          'address': daddress,
                                                          'hno': dhno,
                                                          'landmark': dlandmark,
                                                          'c_name': dname,
                                                          'c_number': dropNumber,
                                                          'lat_map': lat2,
                                                          'long_map': lon2,
                                                          'is_main': true,
                                                        };
                                                        
                                                        if (dropLocations.isEmpty) {
                                                          dropLocations.add(mainDropData);
                                                        } else {
                                                          dropLocations[0] = mainDropData;
                                                        }

                                                        calculateDistance(lat1, lon1, lat2, lon2);
                                                      });
                                                    }
                                                  });
                                                },
                                                child: Container(
                                                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                                  decoration: BoxDecoration(
                                                    color: linercolor.withOpacity(0.1),
                                                    borderRadius: BorderRadius.circular(8),
                                                  ),
                                                  child: Row(
                                                    mainAxisSize: MainAxisSize.min,
                                                    children: [
                                                      Icon(
                                                        Icons.edit,
                                                        color: linercolor,
                                                        size: 14,
                                                      ),
                                                      SizedBox(width: 4),
                                                      Text(
                                                        "Change Location".tr,
                                                        style: TextStyle(
                                                          color: linercolor,
                                                          fontSize: 12,
                                                          fontFamily: 'Gilroy_Medium',
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),

                        // Display additional drop locations
                       if (dropLocations.length > 1)
                          Column(
                            children: dropLocations.asMap().entries.map((entry) {
                              final index = entry.key;
                              final dropLocation = entry.value;

                              // Skip the first one as it's already shown above
                              if (index == 0) return SizedBox();

                              return Container(
                                margin: EdgeInsets.only(bottom: 10),
                                padding: EdgeInsets.only(bottom: 10, left: 10, right: 10),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Text(
                                          "Stop Location ${index + 1}".tr,
                                          style: TextStyle(
                                            color: greaycolor,
                                            fontFamily: "Gilroy_Medium",
                                            fontSize: 14,
                                          ),
                                        ),
                                        Row(
                                          children: [
                                            Container(
                                              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: Colors.blue.withOpacity(0.1),
                                                borderRadius: BorderRadius.circular(4),
                                              ),
                                              child: Text(
                                                "Additional".tr,
                                                style: TextStyle(
                                                  color: Colors.blue,
                                                  fontSize: 10,
                                                  fontFamily: 'Gilroy_Bold',
                                                ),
                                              ),
                                            ),
                                            SizedBox(width: 8),
                                            InkWell(
                                              onTap: () {
                                                removeDropLocation(dropLocation['id']);
                                              },
                                              child: Container(
                                                padding: EdgeInsets.all(4),
                                                decoration: BoxDecoration(
                                                  color: Colors.red.withOpacity(0.1),
                                                  borderRadius: BorderRadius.circular(15),
                                                ),
                                                child: Icon(
                                                  Icons.close,
                                                  color: Colors.red,
                                                  size: 18,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    SizedBox(height: 8),
                                    // Interactive Card for Additional Drop Locations
                                    Material(
                                      color: Colors.transparent,
                                      child: InkWell(
                                        onTap: () {
                                          selectDropLocation(dropLocation['id']);
                                        },
                                        borderRadius: BorderRadius.circular(12),
                                        splashColor: Colors.blue.withOpacity(0.2),
                                        highlightColor: Colors.blue.withOpacity(0.1),
                                        child: Container(
                                          width: double.infinity,
                                          decoration: BoxDecoration(
                                            color: dropLocation['type'] == null
                                                ? Colors.blue.withOpacity(0.05)
                                                : notifier.getBgColor,
                                            borderRadius: BorderRadius.circular(12),
                                            border: Border.all(
                                              color: dropLocation['type'] == null
                                                  ? Colors.blue.withOpacity(0.5)
                                                  : notifier.bordecolor,
                                              width: dropLocation['type'] == null ? 2 : 1,
                                            ),
                                            boxShadow: [
                                              BoxShadow(
                                                color: Colors.black.withOpacity(0.05),
                                                blurRadius: 6,
                                                offset: Offset(0, 3),
                                              ),
                                            ],
                                          ),
                                          child: Padding(
                                            padding: EdgeInsets.all(16),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Row(
                                                  children: [
                                                    // Location Icon
                                                    Container(
                                                      padding: EdgeInsets.all(8),
                                                      decoration: BoxDecoration(
                                                        color: dropLocation['type'] == null
                                                            ? Colors.blue.withOpacity(0.1)
                                                            : Colors.blue,
                                                        shape: BoxShape.circle,
                                                      ),
                                                      child: Icon(
                                                        dropLocation['type'] == null
                                                            ? Icons.add_location_alt_outlined
                                                            : Icons.location_on,
                                                        color: dropLocation['type'] == null
                                                            ? Colors.blue
                                                            : whitecolor,
                                                        size: 20,
                                                      ),
                                                    ),
                                                    SizedBox(width: 12),

                                                    // Main Content
                                                    Expanded(
                                                      child: Column(
                                                        crossAxisAlignment: CrossAxisAlignment.start,
                                                        children: [
                                                          // Title
                                                          Text(
                                                            dropLocation['type'] == null
                                                                ? "Add Stop Location ${index + 1}".tr
                                                                : "Stop Location ${index + 1}".tr,
                                                            style: TextStyle(
                                                              color: dropLocation['type'] == null
                                                                  ? Colors.blue
                                                                  : notifier.text,
                                                              fontFamily: 'Gilroy_Bold',
                                                              fontSize: 16,
                                                            ),
                                                          ),
                                                          SizedBox(height: 4),

                                                          // Address or Instruction Text
                                                          dropLocation['type'] == null
                                                              ? Text(
                                                            "Tap to select additional drop-off point".tr,
                                                            style: TextStyle(
                                                              color: greaycolor,
                                                              fontFamily: 'Gilroy_Medium',
                                                              fontSize: 13,
                                                            ),
                                                          )
                                                              : Column(
                                                            crossAxisAlignment: CrossAxisAlignment.start,
                                                            children: [
                                                              // Address Type Badge
                                                              if (dropLocation['type'] != null)
                                                                Container(
                                                                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                                  decoration: BoxDecoration(
                                                                    color: Colors.blue.withOpacity(0.1),
                                                                    borderRadius: BorderRadius.circular(4),
                                                                  ),
                                                                  child: Text(
                                                                    dropLocation['type']!,
                                                                    style: TextStyle(
                                                                      color: Colors.blue,
                                                                      fontSize: 11,
                                                                      fontFamily: 'Gilroy_Bold',
                                                                    ),
                                                                  ),
                                                                ),
                                                              SizedBox(height: 8),

                                                              // Address Details
                                                              Row(
                                                                children: [
                                                                  Icon(
                                                                    Icons.location_pin,
                                                                    color: greaycolor,
                                                                    size: 14,
                                                                  ),
                                                                  SizedBox(width: 4),
                                                                  Expanded(
                                                                    child: Text(
                                                                      dropLocation['landmark'] != ''
                                                                          ? "${dropLocation['hno']}, ${dropLocation['landmark']}, ${dropLocation['address']}"
                                                                          : "${dropLocation['hno']}, ${dropLocation['address']}",
                                                                      maxLines: 2,
                                                                      overflow: TextOverflow.ellipsis,
                                                                      style: TextStyle(
                                                                        color: notifier.text,
                                                                        fontFamily: 'Gilroy_Medium',
                                                                        fontSize: 13,
                                                                      ),
                                                                    ),
                                                                  ),
                                                                ],
                                                              ),
                                                            ],
                                                          ),
                                                        ],
                                                      ),
                                                    ),

                                                    // Arrow Icon
                                                    Icon(
                                                      Icons.arrow_forward_ios,
                                                      color: dropLocation['type'] == null
                                                          ? Colors.blue
                                                          : greaycolor,
                                                      size: 16,
                                                    ),
                                                  ],
                                                ),

                                                // Show Customer Details when selected
                                                if (dropLocation['type'] != null) ...[
                                                  SizedBox(height: 16),
                                                  Divider(color: notifier.bordecolor),
                                                  SizedBox(height: 12),

                                                  // Customer Info
                                                  Row(
                                                    children: [
                                                      Icon(
                                                        Icons.person_outline,
                                                        color: greaycolor,
                                                        size: 16,
                                                      ),
                                                      SizedBox(width: 8),
                                                      Text(
                                                        "${dropLocation['c_name']}",
                                                        style: TextStyle(
                                                          color: notifier.text,
                                                          fontFamily: 'Gilroy_Medium',
                                                          fontSize: 13,
                                                        ),
                                                      ),
                                                      Spacer(),
                                                      Icon(
                                                        Icons.phone_outlined,
                                                        color: greaycolor,
                                                        size: 16,
                                                      ),
                                                      SizedBox(width: 8),
                                                      Text(
                                                        dropLocation['c_number'],
                                                        style: TextStyle(
                                                          color: notifier.text,
                                                          fontFamily: 'Gilroy_Medium',
                                                          fontSize: 13,
                                                        ),
                                                      ),
                                                    ],
                                                  ),

                                                  // Edit Button
                                                  SizedBox(height: 12),
                                                  Align(
                                                    alignment: Alignment.centerRight,
                                                    child: InkWell(
                                                      onTap: () {
                                                        selectDropLocation(dropLocation['id']);
                                                      },
                                                      child: Container(
                                                        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                                        decoration: BoxDecoration(
                                                          color: Colors.blue.withOpacity(0.1),
                                                          borderRadius: BorderRadius.circular(8),
                                                        ),
                                                        child: Row(
                                                          mainAxisSize: MainAxisSize.min,
                                                          children: [
                                                            Icon(
                                                              Icons.edit,
                                                              color: Colors.blue,
                                                              size: 14,
                                                            ),
                                                            SizedBox(width: 4),
                                                            Text(
                                                              "Change Location".tr,
                                                              style: TextStyle(
                                                                color: Colors.blue,
                                                                fontSize: 12,
                                                                fontFamily: 'Gilroy_Medium',
                                                              ),
                                                            ),
                                                          ],
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ],
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                          ),

                        Center(
                          child: InkWell(
                            onTap: () {
                              // Add new drop location functionality
                              addNewDropLocation();
                            },
                            borderRadius: BorderRadius.circular(25),
                            child: Container(
                              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                              decoration: BoxDecoration(
                                color: notifier.getBgColor,
                                borderRadius: BorderRadius.circular(25),
                                border: Border.all(
                                  color: Colors.blue,
                                  width: 2,
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.blue.withOpacity(0.2),
                                    blurRadius: 8,
                                    offset: Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    padding: EdgeInsets.all(6),
                                    decoration: BoxDecoration(
                                      color: Colors.blue.withOpacity(0.1),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(
                                      Icons.add,
                                      color: Colors.blue,
                                      size: 20,
                                    ),
                                  ),
                                  SizedBox(width: 8),
                                  Text(
                                    "Add Stop Location".tr,
                                    style: TextStyle(
                                      color: Colors.blue,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 16,
                                    ),
                                  ),
                                  SizedBox(width: 4),
                                  Icon(
                                    Icons.arrow_forward_ios,
                                    color: Colors.blue,
                                    size: 16,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 10),
                  paddresstype == null || daddresstype == null
                  ? Container()
                  : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [

                      // KM Range Selection with Horizontal Progress Bar
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                        margin: EdgeInsets.only(bottom: 10),
                        decoration: BoxDecoration(
                          color: notifier.getBgColor,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black12,
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Header
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  "Select Distance Range".tr,
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: notifier.text,
                                    fontSize: 16,
                                  ),
                                ),
                                Text(
                                  "${_selectedKm.toInt()} KM",
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: linercolor,
                                    fontSize: 16,
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 8),

                            // Progress Bar
                            Container(
                              height: 30,
                              child: // In the build method, Slider section:
                              Slider(
                                value: _selectedKm.toDouble(),
                                min: start_range, // Now properly defined
                                max: end_range,   // Now properly defined
                                divisions: (end_range - start_range).toInt(), // Dynamic divisions based on range
                                label: '${_selectedKm.toInt()} KM',
                                activeColor: linercolor,
                                inactiveColor: greaycolor.withOpacity(0.3),
                                onChanged: (double value) {
                                  setState(() {
                                    _selectedKm = value.toInt();
                                    _calculateExtraCharges();
                                  });
                                },
                              ),
                            ),
                            SizedBox(height: 8),

                            // KM Labels
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  "${start_range.toInt()} KM",
                                  style: TextStyle(
                                    color: greaycolor,
                                    fontSize: 12,
                                  ),
                                ),
                                Text(
                                  "${end_range.toInt()} KM",
                                  style: TextStyle(
                                    color: greaycolor,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 8),

                            // Charges Info
                            Builder(
                              builder: (context) {
                                // Get pickup_per_km_charge from highest-cost selected delivery type, or use default
                                double perKmRate = pickupCharges; // Default fallback
                                
                                if (selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty) {
                                  int bestIdx = _highestCostSelectedIndex;
                                  if (bestIdx != -1 && bestIdx < deliveryTypes.length) {
                                    var item = deliveryTypes[bestIdx];
                                    double pickupPerKm = double.tryParse(item['pickup_per_km_charge']?.toString() ?? '') ??
                                        double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
                                    if (pickupPerKm > 0) {
                                      perKmRate = pickupPerKm;
                                    }
                                  }
                                }
                                
                                return Container(
                                  padding: EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: _selectedKm > 1 ? Colors.orange.withOpacity(0.1) : Colors.green.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: _selectedKm > 1 ? Colors.orange : Colors.green,
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        _selectedKm > 1 ? Icons.info_outline : Icons.check_circle,
                                        color: _selectedKm > 1 ? Colors.orange : Colors.green,
                                        size: 18,
                                      ),
                                      SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          _selectedKm > 1
                                              ? "Extra charges: ${((_selectedKm - 1) * perKmRate).toStringAsFixed(2)} ₹ (${_selectedKm - 1} KM × $perKmRate ₹/KM)"
                                              : "First 1 KM is free!",
                                          style: TextStyle(
                                            color: _selectedKm > 1 ? Colors.orange : Colors.green,
                                            fontSize: 12,
                                            fontFamily: 'Gilroy_Medium',
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                          ],
                        ),
                      ),

// Dynamic Delivery Types Section - USING PACKAGE API DATA
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                        decoration: BoxDecoration(
                          color: notifier.getBgColor,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black12,
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: isLoading
                            ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(20.0),
                            child: CircularProgressIndicator(color: linercolor),
                          ),
                        )
                            : !hasDeliveryData || deliveryTypes.isEmpty
                            ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(20.0),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.local_shipping_outlined,
                                  color: Colors.grey,
                                  size: 50,
                                ),
                                SizedBox(height: 10),
                                Text(
                                  isLoading ? "Loading delivery options..." : "No delivery options available".tr,
                                  style: TextStyle(
                                    color: greaycolor,
                                    fontFamily: 'Gilroy_Medium',
                                    fontSize: 16,
                                  ),
                                ),
                                if (!isLoading && deliveryTypes.isEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 8.0),
                                    child: Text(
                                      "Check API response format",
                                      style: TextStyle(
                                        color: Colors.orange,
                                        fontSize: 12,
                                        fontFamily: 'Gilroy_Medium',
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        )
                            : Column(
                          children: [
                            // Header Row
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    flex: 2,
                                    child: Text(
                                      "Delivery Type".tr,
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: notifier.text,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ),
                                  Expanded(
                                    flex: 3,
                                    child: Text(
                                      "Cost".tr,
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: notifier.text,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ),
                                  Expanded(
                                    flex: 2,
                                    child: Text(
                                      "Select".tr,
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: notifier.text,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const Divider(),

                            // Dynamic Data Rows from PACKAGE API - MULTI SELECT
                            Column(
                              children: deliveryTypes.asMap().entries.map((entry) {
                                final index = entry.key;
                                final item = entry.value;
                                bool isChecked = selectedDeliveryTypeIndexes.contains(index);
                                bool isHighest = selectedDeliveryTypeIndex == index && selectedDeliveryTypeIndexes.length > 1;

                                // Calculate total cost for display
                                double perKmCharge = double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
                                double pickupPerKm = double.tryParse(item['pickup_per_km_charge']?.toString() ?? '') ?? perKmCharge;
                                double minChargeValue = double.tryParse(item['min_charge']?.toString() ?? '0') ?? 0.0;
                                double serviceChargePercent = double.tryParse(item['service_charge_percent']?.toString() ?? '0') ?? 0.0;
                                // double waitingCharge = double.tryParse(item['waiting_charge']?.toString() ?? '0') ?? 0.0;
                                double waitingCharge = 0.0; // Waiting charge disabled
                                double nightChargeFixed = double.tryParse(item['applied_night_charge_percent']?.toString() ?? '0') ?? 0.0;
                                int isNight = int.tryParse(item['is_night']?.toString() ?? '0') ?? 0;

                                double deliveryChargeAmount = perKmCharge * totaldistance;
                                double serviceChargeAmount = (serviceChargePercent / 100) * deliveryChargeAmount;
                                double nightChargeAmount = (isNight == 1) ? nightChargeFixed : 0.0;
                                double itemExtraKmCharges = _calculateExtraKmChargesForRate(pickupPerKm > 0 ? pickupPerKm : pickupCharges);
                                double totalCost = itemExtraKmCharges + minChargeValue + serviceChargeAmount + deliveryChargeAmount + waitingCharge + nightChargeAmount;
                                String displayCost = '$currency${totalCost.toStringAsFixed(2)}';

                                return Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 6),
                                  child: InkWell(
                                    borderRadius: BorderRadius.circular(10),
                                    onTap: () {
                                      setState(() {
                                        if (isChecked) {
                                          // Don't uncheck if it's the last selected
                                          if (selectedDeliveryTypeIndexes.length > 1) {
                                            selectedDeliveryTypeIndexes.remove(index);
                                          }
                                        } else {
                                          selectedDeliveryTypeIndexes.add(index);
                                        }
                                        _updateDeliveryFeesForMultiSelect();
                                      });
                                    },
                                    child: Container(
                                      padding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                      decoration: BoxDecoration(
                                        color: isChecked
                                            ? linercolor.withOpacity(0.08)
                                            : Colors.transparent,
                                        borderRadius: BorderRadius.circular(10),
                                        border: Border.all(
                                          color: isChecked ? linercolor : notifier.bordecolor,
                                          width: isChecked ? 1.5 : 1,
                                        ),
                                      ),
                                      child: Row(
                                        children: [
                                          Checkbox(
                                            value: isChecked,
                                            activeColor: linercolor,
                                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                                            onChanged: (val) {
                                              setState(() {
                                                if (val == true) {
                                                  selectedDeliveryTypeIndexes.add(index);
                                                } else {
                                                  if (selectedDeliveryTypeIndexes.length > 1) {
                                                    selectedDeliveryTypeIndexes.remove(index);
                                                  }
                                                }
                                                _updateDeliveryFeesForMultiSelect();
                                              });
                                            },
                                          ),
                                          SizedBox(width: 4),
                                          Expanded(
                                            flex: 3,
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  item['title'] ?? 'N/A',
                                                  style: TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                    color: notifier.text,
                                                    fontSize: 14,
                                                  ),
                                                ),
                                                if (isHighest)
                                                  Text(
                                                    "Used for calculation",
                                                    style: TextStyle(
                                                      color: linercolor,
                                                      fontSize: 11,
                                                      fontFamily: 'Gilroy_Medium',
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                          Text(
                                            displayCost,
                                            style: TextStyle(
                                              color: isChecked ? linercolor : notifier.text,
                                              fontFamily: 'Gilroy_Bold',
                                              fontSize: 14,
                                            ),
                                          ),
                                          Padding(
                                            padding: const EdgeInsets.only(left: 8.0),
                                            child: InkWell(
                                              onTap: () {
                                                String imgStr = (item['user_detail_image'] ?? '').toString().trim();
                                                String imageUrl = "";
                                                if (imgStr.isNotEmpty && imgStr != "null") {
                                                  if (imgStr.startsWith("http://") || imgStr.startsWith("https://")) {
                                                    imageUrl = imgStr;
                                                  } else {
                                                    imageUrl = "${Config.imageURLPath}$imgStr";
                                                  }
                                                }

                                                Get.dialog(
                                                  Dialog(
                                                    backgroundColor: Colors.transparent,
                                                    insetPadding: const EdgeInsets.all(10),
                                                    child: Stack(
                                                      alignment: Alignment.center,
                                                      children: [
                                                        InteractiveViewer(
                                                          child: imageUrl.isNotEmpty
                                                              ? FadeInImage.assetNetwork(
                                                                  image: imageUrl,
                                                                  placeholder: "assets/ezgif.com-crop.gif",
                                                                  imageErrorBuilder: (context, error, stackTrace) => Container(
                                                                    padding: const EdgeInsets.all(20),
                                                                    decoration: BoxDecoration(
                                                                      color: notifier.getBgColor,
                                                                      borderRadius: BorderRadius.circular(16),
                                                                    ),
                                                                    child: Column(
                                                                      mainAxisSize: MainAxisSize.min,
                                                                      children: [
                                                                        Icon(Icons.image_not_supported, color: linercolor, size: 50),
                                                                        const SizedBox(height: 10),
                                                                        Text(
                                                                          item['title'] ?? 'Delivery Info'.tr,
                                                                          style: TextStyle(
                                                                            fontSize: 16,
                                                                            fontFamily: 'Gilroy_Bold',
                                                                            color: notifier.text,
                                                                          ),
                                                                        ),
                                                                      ],
                                                                    ),
                                                                  ),
                                                                )
                                                              : Container(
                                                                  padding: const EdgeInsets.all(20),
                                                                  decoration: BoxDecoration(
                                                                    color: notifier.getBgColor,
                                                                    borderRadius: BorderRadius.circular(16),
                                                                  ),
                                                                  child: Column(
                                                                    mainAxisSize: MainAxisSize.min,
                                                                    children: [
                                                                      Icon(Icons.image_outlined, color: linercolor, size: 50),
                                                                      const SizedBox(height: 10),
                                                                      Text(
                                                                        item['title'] ?? 'Delivery Info'.tr,
                                                                        style: TextStyle(
                                                                          fontSize: 16,
                                                                          fontFamily: 'Gilroy_Bold',
                                                                          color: notifier.text,
                                                                        ),
                                                                      ),
                                                                    ],
                                                                  ),
                                                                ),
                                                        ),
                                                        Positioned(
                                                          top: 0,
                                                          right: 0,
                                                          child: IconButton(
                                                            icon: const Icon(Icons.cancel, color: Colors.white, size: 30),
                                                            onPressed: () => Get.back(),
                                                          ),
                                                        ),
                                                      ],
                                                    ),
                                                  ),
                                                );
                                              },
                                              child: Icon(Icons.info, color: linercolor, size: 24),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              }).toList(),
                            ),
                          ],
                        ),
                      ),

// Show selected delivery types summary banner
                      selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty
                          ? Container(
                        margin: EdgeInsets.only(top: 10),
                        padding: EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: linercolor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: linercolor),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(Icons.check_circle, color: linercolor, size: 18),
                                SizedBox(width: 8),
                                Text(
                                  "${selectedDeliveryTypeIndexes.length} type(s) selected",
                                  style: TextStyle(
                                    color: linercolor,
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 4),
                            Text(
                              "Calculation based on: ${selectedDeliveryTypeIndex != -1 ? deliveryTypes[selectedDeliveryTypeIndex]['title'] : ''} (highest cost)",
                              style: TextStyle(
                                color: notifier.text,
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      )
                          : SizedBox(height: 10),

                      SizedBox(height: 10),
                      if (false) Text(
                        "Package Info & Image Upload".tr,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15,
                        ),
                      ),
                      if (false) SizedBox(height: 10),
                      if (false) Container(
                        width: Get.width,
                        decoration: BoxDecoration(
                          color:notifier.getBgColor,
                          border: Border.all(color: notifier.bordecolor, width: 1),
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Column(
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Column(
                                  mainAxisAlignment: MainAxisAlignment.start,
                                  children: [
                                    Padding(
                                      padding: EdgeInsets.only(top: 10, left: 10),
                                      child: Image.asset(
                                        "assets/date.png",
                                        fit: BoxFit.cover,
                                        color: notifier.darklinercolor,
                                        height: 26,
                                      ),
                                    ),
                                  ],
                                ),
                                Expanded(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(15),
                                    child: TextField(
                                      style: TextStyle(
                                        color: notifier.text,
                                        fontFamily: 'Gilroy_Medium',
                                      ),
                                      controller: dropnote,
                                      cursorColor: notifier.darklinercolor,
                                      decoration: InputDecoration(
                                        filled: true,
                                        fillColor: notifier.getBgColor,
                                        border: InputBorder.none,
                                        hintStyle: TextStyle(
                                          fontFamily: 'Gilroy_Medium',
                                          color: greaycolor,
                                        ),
                                        hintText: "Add more details about this task".tr,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                Padding(
                                  padding: EdgeInsets.only(bottom: 10, right: 10),
                                  child: InkWell(
                                    onTap: () => cemerabottomsheet(),
                                    child: Image.asset(
                                      "assets/gallery-add.png",
                                      height: 25,
                                      color: notifier.darklinercolor,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      if (false) SizedBox(height: 10),
                      if (false) imageList.isNotEmpty
                          ? Wrap(
                              runSpacing: 10,
                              spacing: 10,
                              children: [
                                for (int i = 0; i < imageList.length; i++)
                                  Stack(
                                    children: [
                                      Container(
                                        height: 75,
                                        width: 75,
                                        decoration: BoxDecoration(
                                          color: Colors.grey,
                                          borderRadius: BorderRadius.circular(10),
                                          image: DecorationImage(
                                            image: FileImage(
                                              File(imageList[i]),
                                            ),
                                            fit: BoxFit.cover,
                                          ),
                                        ),
                                      ),
                                      Positioned(
                                        top: -12,
                                        right: -12,
                                        child: IconButton(
                                          onPressed: () {
                                            setState(() {});
                                            imageList.remove(imageList[i]);
                                          },
                                          icon: const Icon(
                                            Icons.cancel,
                                            color: Colors.red,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                              ],
                            )
                          : SizedBox(height: 0),
                      if (false) imageList.isEmpty ? Container() : SizedBox(height: 10),

                      /* // GST Number Input Field (Optional)
                      Text(
                        "GST Number (Optional)".tr,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15,
                        ),
                      ),
                      SizedBox(height: 10),
                      Container(
                        width: Get.width,
                        decoration: BoxDecoration(
                          color: notifier.getBgColor,
                          border: Border.all(color: notifier.bordecolor, width: 1),
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Row(
                          children: [
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12),
                              child: Icon(
                                Icons.receipt_long_outlined,
                                color: notifier.darklinercolor,
                                size: 22,
                              ),
                            ),
                            Expanded(
                              child: TextField(
                                controller: gstNumberController,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Medium',
                                ),
                                textCapitalization: TextCapitalization.characters,
                                cursorColor: notifier.darklinercolor,
                                decoration: InputDecoration(
                                  filled: true,
                                  fillColor: notifier.getBgColor,
                                  border: InputBorder.none,
                                  hintStyle: TextStyle(
                                    fontFamily: 'Gilroy_Medium',
                                    color: greaycolor,
                                  ),
                                  hintText: "Enter GST Number (e.g. 22AAAAA0000A1Z5)".tr,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(height: 10); */

                      //! ---------------- Booking Type Selection ---------------
                      if (false) _buildBookingTypeSelector(),
                      if (false) SizedBox(height: 10),

                      //! ---------------- Aplly Coupon code ---------------
                            /*Text(
                              "Apply Coupon".tr,
                              style: TextStyle(
                                color: notifier.text,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 18,
                              ),
                            ),
                            SizedBox(height: 10),
                            applycoupon(
                              title: couponcode,
                              subtitle: couponcode == "Apply Now"
                                  ? ""
                                  : applycode,
                              suffix: couponcode == "Apply Now"
                                  ? InkWell(
                                      onTap: () {
                                        if (firstLogin) {
                                          totalfees = deliveryfees.toString();
                                          Get.to(CouponListPage(bill: deliveryfees))!.then((value) {
                                            if (value != null) {
                                              cid = value["id"];
                                              camount = value["c_value"];
                                              couponcode = value["coupon_code"];
                                              couponcode = value["coupon_code"];
                                              deliveryfees = (deliveryfees - double.parse(value["c_value"].toString())).roundToDouble();
                                            }
                                          });
                                        } else {
                                          Get.to(SignIn(paymenttype: "BuyAnything"))!.then((value) {
                                             initStatData();
                                          });
                                        }
                                      },
                                      child: Image.asset(
                                        "assets/arrowcircleright.png",
                                        height: 24,
                                        color: notifier.darklinercolor,
                                      ),
                                    )
                                  : InkWell(
                                      onTap: () {
                                        deliveryfees = (deliveryfees + double.parse("$camount")).roundToDouble();
                                        setState(() {});
                                        cid = "0";
                                        camount = "0";
                                        couponcode = "Apply Now";
                                        setState(() {});
                                      },
                                      child: Container(
                                        height: 20,
                                        width: 20,
                                        decoration: BoxDecoration(
                                          color: greaycolor,
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: const Center(
                                          child: Icon(
                                            Icons.close,
                                            color: Colors.white,
                                            size: 16,
                                          ),
                                        ),
                                      ),
                                    ),
                            ),
                      SizedBox(height: 10),*/

                            //!------- Bill Breakdown ---------
                      //!------- Bill Breakdown ---------
                      Builder(
                        builder: (context) {
                          // ✅ Get all values from selected delivery type dynamically
                          double pickupChargesAmount = _currentExtraKmCharges;
                          double minimumChargeAmount = 0.0;
                          double serviceChargeAmount = 0.0;
                          double deliveryChargeAmount = 0.0;
                          double waitingChargeAmount = 0.0;
                          double nightChargeAmount = 0.0;
                          String nightTimeStart = "00:00:00";
                          String nightTimeEnd = "00:00:00";
                          String freeWaitingTime = "0";
                          int isNight = 0;

                          if (selectedDeliveryTypeIndex != -1 && deliveryTypes.isNotEmpty) {
                            var item = deliveryTypes[selectedDeliveryTypeIndex];
                            
                            double perKmCharge = double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
                            minimumChargeAmount = double.tryParse(item['min_charge']?.toString() ?? '0') ?? 0.0;
                            double serviceChargePercent = double.tryParse(item['service_charge_percent']?.toString() ?? '0') ?? 0.0;
                            waitingChargeAmount = double.tryParse(item['waiting_charge']?.toString() ?? '0') ?? 0.0;
                            double nightChargeFixed = double.tryParse(item['applied_night_charge_percent']?.toString() ?? '0') ?? 0.0;
                            isNight = int.tryParse(item['is_night']?.toString() ?? '0') ?? 0;
                            
                            nightTimeStart = item['start_time']?.toString() ?? '00:00:00';
                            nightTimeEnd = item['end_time']?.toString() ?? '00:00:00';
                            freeWaitingTime = item['free_waiting_time']?.toString() ?? '0';

                            // Calculate charges
                            deliveryChargeAmount = perKmCharge * totaldistance;
                            serviceChargeAmount = (serviceChargePercent / 100) * deliveryChargeAmount;
                            nightChargeAmount = (isNight == 1) ? nightChargeFixed : 0.0;
                          }

                          return Column(
                            children: [
                              // Night Time Start
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Night Time Start".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                    nightTimeStart,
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 10),

                              // Night Time End
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Night Time End".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                    nightTimeEnd,
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 10),

                              // Free Waiting Time
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Free Waiting Time".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                    "$freeWaitingTime min",
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 20),

                              Text(
                                "Charges".tr,
                                style: TextStyle(
                                  color: Colors.black,
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              SizedBox(height: 10),

                              // Pickup charges
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Pickup charges".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                   "$currency${pickupChargesAmount.toStringAsFixed(2)}",
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 10),

                              // Minimum Charge
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Minimum Charge".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                    "$currency${minimumChargeAmount.toStringAsFixed(2)}",
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 10),

                              // Service Charge
                              if (serviceChargeAmount > 0)
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      "Service Charge".tr,
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.8),
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 15,
                                      ),
                                    ),
                                    Text(
                                      "$currency${serviceChargeAmount.toStringAsFixed(2)}",
                                      style: TextStyle(
                                        color: blackcolor,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 15,
                                      ),
                                    ),
                                  ],
                                ),
                              if (serviceChargeAmount > 0) SizedBox(height: 10),

                              // Delivery Charge
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    "Delivery Charge".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 15,
                                    ),
                                  ),
                                  Text(
                                    "$currency${deliveryChargeAmount.toStringAsFixed(2)}",
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 10),

                              // Waiting Charge
                             /* if (waitingChargeAmount > 0)
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      "Waiting Charge".tr,
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.8),
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 15,
                                      ),
                                    ),
                                    Text(
                                      "$currency${waitingChargeAmount.toStringAsFixed(2)}",
                                      style: TextStyle(
                                        color: blackcolor,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 15,
                                      ),
                                    ),
                                  ],
                                ),*/
                              if (waitingChargeAmount > 0) SizedBox(height: 10),

                              // Night Charge (only if is_night == 1)
                              if (isNight == 1 && nightChargeAmount > 0)
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      "Night Charge".tr,
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.8),
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 15,
                                      ),
                                    ),
                                    Text(
                                      "$currency${nightChargeAmount.toStringAsFixed(2)}",
                                      style: TextStyle(
                                        color: blackcolor,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 15,
                                      ),
                                    ),
                                  ],
                                ),
                              if (isNight == 1 && nightChargeAmount > 0) SizedBox(height: 10),


                              // Coupon discount (if applied)
                              couponcode != "Apply Now"
                                  ? Column(
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        "Coupon discount".tr,
                                        style: TextStyle(
                                          color: greaycolor.withOpacity(0.8),
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 15,
                                        ),
                                      ),
                                      Spacer(),
                                      Text(
                                        "- $currency${camount ?? 0}",
                                        style: TextStyle(
                                          color: greencolor,
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 15,
                                        ),
                                      ),
                                    ],
                                  ),
                                  SizedBox(height: 10),
                                ],
                              )
                                  : SizedBox(),
                              Divider(color: greaycolor),
                              SizedBox(height: 10),

                              // Total
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      couponcode != "Apply Now"
                                          ? Text(
                                        "To Pay".tr,
                                        style: TextStyle(
                                          color: greaycolor.withOpacity(0.8),
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 15,
                                        ),
                                      )
                                          : InkWell(
                                        key: _buttonKey,
                                        onTap: () => _toggleTooltip(),
                                        child: Row(
                                          children: [
                                            Text(
                                              "To Pay".tr,
                                              style: TextStyle(
                                                color: greaycolor.withOpacity(0.8),
                                                fontFamily: 'Gilroy_Medium',
                                                fontSize: 15,
                                              ),
                                            ),
                                            SizedBox(width: 5),
                                            SvgPicture.asset(
                                              "assets/info-circle.svg",
                                              color: greaycolor.withOpacity(0.8),
                                              height: 18,
                                            ),
                                          ],
                                        ),
                                      ),
                                      SizedBox(height: 2),
                                      Text(
                                        "Estimated amount, actual amount may be less".tr,
                                        style: TextStyle(
                                          color: greaycolor.withOpacity(0.7),
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 11,
                                        ),
                                      ),
                                    ],
                                  ),
                                  Text(
                                    "$currency${deliveryfees.toStringAsFixed(2)}",
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: 10),
                            ],
                          );
                        },
                      ),
                     /* SizedBox(height: 10),
                      SizedBox(
                        width: Get.width,
                        child: deliverydistance(
                          title: "${"Your task is for".tr} $totaldistance ${"kms".tr}, ${totaltime ?? ""} ${"mins Delivery partner fees".tr} : $currency${deliveryfees.toStringAsFixed(2)}",
                          iconColor: greencolor,
                          bgcolor: greencolor.withOpacity(0.13),
                          color: greencolor,
                        ),
                      ),*/
                      ],
                    ),

                //  _buildBillBreakdown(),

                ],
              ),
            ),
            isPaymentLoding
            ? Center(child: CircularProgressIndicator(color: linercolor))
            : SizedBox(),
          ],
        ),
      ),
    );
  }

  Future cemerabottomsheet() {
    return showModalBottomSheet(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      context: context,
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  cemerawidget(
                    image: "assets/camera.png",
                    title: "CAMERA".tr,
                    onTap: () {
                      Navigator.pop(context);
                      _openCamera(context);
                    },
                  ),
                  Container(height: 40,width: 1.5, decoration: BoxDecoration(color: lightgrey),),
                  cemerawidget(
                    image: "assets/gallery.png",
                    title: "GALLERY".tr,
                    onTap: () {
                      Navigator.pop(context);
                      _openGallery(context);
                    },
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget cemerawidget({String? image, String? title, Function()? onTap}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: pbordercolor),
        ),
        child: Row(
          children: [
            Container(
              decoration: BoxDecoration(
                color: const Color(0xffF2F4F9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Center(
                child: Image.asset(
                  image!,
                  height: 30,
                ),
              ),
            ),
            SizedBox(width: 5),
            Text(
              title!,
              style: TextStyle(
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
                color: linercolor,
              ),
            )
          ],
        ),
      ),
    );
  }

  void _openCamera(BuildContext context) async {
    try {
      final pickedFile = await ImagePicker().pickImage(
        source: ImageSource.camera,
        imageQuality: 80,
        maxWidth: 1200,
        maxHeight: 1200,
      );
      if (pickedFile != null) {
        String path = pickedFile.path;
        if (mounted) {
          setState(() {
            imageList.add(path);
          });
        }
      }
    } catch (e) {
      debugPrint("🔴 Camera picker exception: $e");
      tostmsg("Could not open camera or permission denied".tr);
    }
  }

  void _openGallery(BuildContext context) async {
    try {
      final pickedFile = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 80,
        maxWidth: 1200,
        maxHeight: 1200,
      );
      if (pickedFile != null) {
        String path = pickedFile.path;
        debugPrint("Gallery picked path: $path");
        if (mounted) {
          setState(() {
            imageList.add(path);
          });
        }
      }
    } catch (e) {
      debugPrint("🔴 Gallery picker exception: $e");
      tostmsg("Could not open gallery".tr);
    }
  }

  deliverydistance({
    String? title,
    Color? color,
    Color? bgcolor,
    Color? iconColor,
  }) {
    return Container(
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(13),
        color: bgcolor,
      ),
      child: Row(
        children: [
          Icon(Icons.info, color: iconColor),
          SizedBox(width: 10),
          Expanded(
            child: SizedBox(
              child: Text(
                title!,
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 15,
                  color: color,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future paymentSheet() {
    int paymentindex = 0;
    notifier = Provider.of(context, listen: false);
    return showModalBottomSheet(
      isScrollControlled: true,
      backgroundColor: notifier.lightBgColor,
      barrierColor: notifier.text.withOpacity(0.3),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      context: context,
      builder: (context) {
        return Container(
          padding: EdgeInsets.all(10),
          constraints: BoxConstraints(maxHeight: Get.height / 1.5),
          child: Scaffold(
            backgroundColor: notifier.lightBgColor,
            floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
            floatingActionButton: isPaymentLoding
              ? Container(
                  width: Get.width,
                  height: Get.height / 16,
                  decoration: BoxDecoration(
                    color: linercolor,
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Center(
                    child: SpinKitThreeBounce(color: whitecolor, size: 25.0),
                  ),
                )
              : InkWell(
              onTap: () {
                save("Lat1", lat1);
                save("lon1", lon1);
                save("Lat2", lat2);
                save("lon2", lon2);
                if (paymenttital != "" && paymenttital != null) {
                  if (isPaymentLoding == false) {
                    setState(() {
                      isPaymentLoding = true;
                    });
                    if (paymenttital == "Razorpay") {
                      debugPrint("Razorpay");
                      Get.back();
                      razorPayClass.openCheckout(
                        key: "rzp_live_SUiompzvYRhrsg", // Live Razorpay key ID
                        amount: "$deliveryfees",
                        number: "${getdata.read("UserLogin")["mobile"]}",
                        name: "${getdata.read("UserLogin")["name"]}",
                      );
                    } else if (paymenttital == "Paypal") {
                      debugPrint("paypal");
                      List ids = paymentGatwayApiModel!.data![paymentindex].attributes.toString().split(",");
                      Get.back();
                      paypalPayment(
                        context: context,
                        amt: "$deliveryfees",
                        clientId: ids[0],
                        secretKey: ids[1],
                        function: (e){
                          orderParcelApi("${e["paymentId"]}");
                        }
                      ).then((value) {
                        isPaymentLoding = false;
                        setState(() {});
                      });
                    } else if (paymenttital == "Stripe") {
                      debugPrint("Stripe");
                      //!------------- Stripe Payment ----------
                      Get.back();
                      stripePayment();
                    } else if (paymenttital == "FlutterWave") {
                      debugPrint("FlutterWave");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.flutterwave}amt=$deliveryfees&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "Paytm") {
                      debugPrint("Paytm");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.paytm}amt=$deliveryfees&uid=${getdata.read("Uid")}&mobile=${getdata.read("UserLogin")["mobile"]}&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "SenangPay") {
                      debugPrint("SenangPay");
                      final notificationId = UniqueKey().hashCode;
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.senangPay}detail=Movers&amount=$deliveryfees&order_id=$notificationId&name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}",
                        status1: "msg",
                        status2: "Payment_was_successful",
                        tId: "transaction_id"
                      );
                    } else if (paymenttital == "PayStack") {
                      debugPrint("PayStack");
                      payStackPaymentApi(
                        email: "${getdata.read("UserLogin")["email"]}",
                        amount: "$deliveryfees",
                      ).then((value) {
                        debugPrint("========= value ========= $value");
                        if (value["status"] == true) {
                          webViewPaymentMethod(
                            initialUrl: "${value["data"]["authorization_url"]}",
                            status1: "status",
                            status2: "success",
                            tId: "trxref",
                          );
                        }
                      });
                    } else if (paymenttital == "MercadoPago") {
                      debugPrint("MercadoPago");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.merpago}amt=$deliveryfees",
                        status1: "status",
                        status2: "successful",
                        tId: "",
                      );
                    } else if (paymenttital == "Payfast") {
                      debugPrint("Payfast");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.payFast}amt=$deliveryfees",
                        status1: "status",
                        status2: "success",
                        tId: "payment_id"
                      );
                    } else if (paymenttital == "Midtrans") {
                      debugPrint("Midtrans");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.midtans}name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}&amt=$deliveryfees",
                        status1: "status_code",
                        status2: "200",
                        tId: "order_id"
                      );
                    } else if (paymenttital == "2checkout") {
                      debugPrint("2checkout");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.checkout2}amt=$deliveryfees",
                        status1: "status",
                        status2: "successful",
                        tId: ""
                      );
                    } else if (paymenttital == "Khalti Payment") {
                      debugPrint("Khalti Payment");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.khalti}amt=$deliveryfees",
                        status1: "status",
                        status2: "Completed",
                        tId: "transaction_id"
                      );
                    }
                  }
                } else {
                  tostmsg("Select Your Payment Method".tr);
                }
              },
              child: Container(
                  height: Get.height / 16,
                  width: Get.width,
                  decoration: BoxDecoration(
                    color: linercolor,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Text(
                      "${"PAY NOW".tr} | $currency$deliveryfees",
                      style: TextStyle(
                        color: whitecolor,
                        fontSize: Get.height / 50,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ),
                ),
            ),
            body: StatefulBuilder(
              builder: (context, setState) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Select Payment Method".tr,
                      style: TextStyle(
                        fontSize: 20,
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    SizedBox(height: 10),
                    //! --------- List view paymente ----------
                    Flexible(
                      child: ListView.separated(
                        shrinkWrap: true,
                        padding: EdgeInsets.only(bottom: 50),
                        physics: BouncingScrollPhysics(),
                        itemCount: paymentGatwayApiModel!.data!.length,
                        itemBuilder: (context, index) {
                          return paymentGatwayApiModel!.data![index].pShow == "0"
                          ? SizedBox()
                          : InkWell(
                            onTap: () {
                              setState(() {
                                paymenttital = paymentGatwayApiModel!.data![index].title;
                                paymentindex = index;
                                _payValue = int.parse("${paymentGatwayApiModel!.data![index].id}");
                              });
                            },
                            child: Container(
                              padding: EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: _payValue == int.parse("${paymentGatwayApiModel!.data![index].id}")
                                    ? notifier.darklinercolor
                                    : Colors.transparent,
                                    width: 1,
                                  ),
                                color: notifier.getBgColor,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Row(
                                children: [
                                  Container(
                                    height: 80,
                                    width: 80,
                                    decoration: BoxDecoration(
                                      color: notifier.getimag,
                                      borderRadius: BorderRadius.circular(15),
                                    ),
                                    child: Center(
                                      child: Image.network(
                                        "${Config.imageURLPath}${paymentGatwayApiModel!.data![index].img}",
                                      ),
                                    ),
                                  ),
                                  SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Text(
                                          "${paymentGatwayApiModel!.data![index].title}",
                                          style: TextStyle(
                                            fontSize: 17,
                                            fontFamily: 'Gilroy_Bold',
                                            color: notifier.text,
                                          ),
                                        ),
                                        SizedBox(
                                          child: Text(
                                           "${paymentGatwayApiModel!.data![index].subtitle}",
                                            style: TextStyle(
                                              fontSize: 14,
                                              fontFamily: 'Gilroy_Medium',
                                              color: greaycolor,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Radio(
                                    activeColor: notifier.darklinercolor,
                                    fillColor: WidgetStateProperty.resolveWith<Color>((states) => notifier.darklinercolor),
                                    value: _payValue == int.parse("${paymentGatwayApiModel!.data![index].id}")
                                      ? true
                                      : false,
                                    groupValue: true,
                                    onChanged: (value) {
                                      setState(() {});
                                    },
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                        separatorBuilder: (BuildContext context, int index) {
                          return paymentGatwayApiModel!.data![index].pShow == "0"
                          ? SizedBox()
                          : SizedBox(height: 10);
                        },
                      ),
                    ),
                  ],
                );
              }
            ),
          ),
        );
      },
    );
  }

  Widget taskDetails({String? title, subtitle, selectitem, Function()? onTap}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        width: Get.width,
        decoration: BoxDecoration(
          border: Border.all(color: pbordercolor),
          color: Colors.white,
          borderRadius: BorderRadius.circular(13),
        ),
        child: Column(
          children: [
            SizedBox(height: Get.height / 55),
            Row(
              children: [
                SizedBox(width: Get.width / 30),
                Image.asset("assets/done.png", height: Get.height / 35),
                SizedBox(width: Get.width / 45),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title!,
                      style: TextStyle(
                        fontSize: Get.height / 55,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    Text(
                      subtitle!,
                      style: TextStyle(
                        color: greaycolor,
                        fontSize: Get.height / 55,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ],
                ),
              ],
            ),
            SizedBox(height: Get.height / 45),
            Row(
              children: [
                SizedBox(width: Get.width / 8),
                Icon(Icons.circle, size: Get.height / 75, color: greaycolor),
                SizedBox(width: Get.width / 50),
                Text(
                  selectitem!,
                  style: TextStyle(
                    fontSize: Get.height / 55,
                    fontFamily: 'Gilroy_Medium',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  //! Address Sheet selected
  Future bottomsheets(BuildContext context, String stype) {
    notifier = Provider.of(context, listen: false);
    return showModalBottomSheet(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      backgroundColor: notifier.lightBgColor,
      isScrollControlled: true,
      enableDrag: false,
      barrierColor: notifier.text.withOpacity(0.3),
      isDismissible: true,
      context: context,
      builder: (context) {
        return WillPopScope(
          onWillPop: () async {
            return true; // Allow back button to dismiss the dialog
          },
          child: Container(
            constraints: BoxConstraints(maxHeight: Get.height / 1.3),
            child: StatefulBuilder(
              builder: (BuildContext context, StateSetter setState) {
                return Padding(
                  padding: EdgeInsets.only(top: 15, left: 15, right: 15),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      InkWell(
                        onTap: () {
                          Get.back();

                          Get.to(() => Traking(type: stype, addressAdd: "0"))!.then((value) {
                            if (value != null && value != "back") {
                              if (stype == "Pickup") {
                                pick = true;
                                changepick = pick;
                                lat1 = getdata.read("PickupAddress")[0]["lat_map"];
                                changelat1 = lat1;
                                lon1 = getdata.read("PickupAddress")[0]["long_map"];
                                changelon1 = lon1;
                                phno = getdata.read("PickupAddress")[0]["hno"];
                                changephno = phno;
                                plandmark = getdata.read("PickupAddress")[0]["landmark"];
                                changeplandmark = plandmark;
                                paddress = getdata.read("PickupAddress")[0]["address"];
                                changepaddress = paddress;
                                paddresstype = getdata.read("PickupAddress")[0]["type"];
                                changepaddresstype = paddresstype;
                                pname = getdata.read("PickupAddress")[0]["c_name"]?.toString();
                                // Fallback to logged-in user name if address doesn't have name
                                if (pname == null || pname!.isEmpty || pname == "null") {
                                  try {
                                    var userLogin = getdata.read("UserLogin");
                                    if (userLogin != null && userLogin is Map && userLogin["name"] != null) {
                                      pname = userLogin["name"].toString();
                                    }
                                  } catch (e) {
                                    debugPrint("Error getting user name: $e");
                                  }
                                }
                                changepname = pname;
                                custNumber = getdata.read("PickupAddress")[0]["c_number"]?.toString() ?? "";
                                // Fallback to logged-in user mobile if address doesn't have number
                                if (custNumber.isEmpty || custNumber == "null") {
                                  try {
                                    var userLogin = getdata.read("UserLogin");
                                    if (userLogin != null && userLogin is Map && userLogin["mobile"] != null) {
                                      String ccode = userLogin["ccode"]?.toString() ?? "";
                                      custNumber = "$ccode${userLogin["mobile"].toString()}";
                                    }
                                  } catch (e) {
                                    debugPrint("Error getting user mobile: $e");
                                  }
                                }
                                changecustNumber = custNumber;

                                if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                  calculateDistance(lat1, lon1, lat2, lon2);
                                }
                                checkAddress();
                              } else if (stype == "AdditionalDrop") {
                                // Handle additional drop location new address
                                String? currentDropLocationId = getdata.read("CurrentDropLocationId");
                                if (currentDropLocationId != null) {
                                  int index = dropLocations.indexWhere((loc) => loc['id'] == currentDropLocationId);
                                  if (index != -1) {
                                    setState(() {
                                      dropLocations[index]['type'] = getdata.read("DropeAddress")[0]["type"];
                                      dropLocations[index]['address'] = getdata.read("DropeAddress")[0]["address"];
                                      dropLocations[index]['hno'] = getdata.read("DropeAddress")[0]["hno"];
                                      dropLocations[index]['landmark'] = getdata.read("DropeAddress")[0]["landmark"];
                                      dropLocations[index]['c_name'] = getdata.read("DropeAddress")[0]["c_name"];
                                      dropLocations[index]['c_number'] = getdata.read("DropeAddress")[0]["c_number"];
                                      dropLocations[index]['lat_map'] = getdata.read("DropeAddress")[0]["lat_map"];
                                      dropLocations[index]['long_map'] = getdata.read("DropeAddress")[0]["long_map"];
                                    });
                                  }
                                }
                              } else {
                                drop = true;
                                changedrop = drop;
                                lat2 = getdata.read("DropeAddress")[0]["lat_map"];
                                changelat2 = lat2;
                                lon2 = getdata.read("DropeAddress")[0]["long_map"];
                                changelon2 = lon2;
                                dhno = getdata.read("DropeAddress")[0]["hno"];
                                changedhno = dhno;
                                dlandmark = getdata.read("DropeAddress")[0]["landmark"];
                                changedlandmark = dlandmark;
                                daddress = getdata.read("DropeAddress")[0]["address"];
                                changedaddress = daddress;
                                dname = getdata.read("DropeAddress")[0]["c_name"]; // Fixed: was using PickupAddress
                                changedname = dname;
                                daddresstype = getdata.read("DropeAddress")[0]["type"];
                                changedaddresstype = daddresstype;
                                dropNumber = getdata.read("DropeAddress")[0]["c_number"];
                                changedropNumber = dropNumber;
                                if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                  calculateDistance(lat1, lon1, lat2, lon2);
                                }
                                checkAddress();
                              }
                            }
                          });
                        },
                        child: Container(
                          padding: EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                          decoration: BoxDecoration(
                            color: notifier.getBgColor,
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Row(
                            children: [
                              SvgPicture.asset(
                                "assets/plus-circle.svg",
                                height: 25,
                                color: notifier.darklinercolor,
                              ),
                              SizedBox(width: 15),
                              Text(
                                "Add New Address".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontSize: 18,
                                  fontFamily: 'Gilroy_Bold',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      SizedBox(height: 15),
                      Text(
                        "Select location".tr,
                        style: TextStyle(
                          fontSize: 20,
                          fontFamily: 'Gilroy_Bold',
                          color: notifier.text,
                        ),
                      ),
                      SizedBox(height: 10),
                      Flexible(
                        child: ListView.separated(
                          shrinkWrap: true,
                          itemCount: addressList.length,
                          physics: BouncingScrollPhysics(),
                          itemBuilder: (ctx, i) {
                            String? iconImage;
                            //! switch case Add
                            switch (addressList[i]["type"]) {
                              case "Home":
                                iconImage = "assets/selecthome.png";
                                break;
                              case "Office":
                                iconImage = "assets/selectoffice.png";
                                break;
                              case "Other":
                                iconImage = "assets/selectothers.png";
                                break;
                              default:
                            }

                            return (paddressID == addressList[i]["id"] || daddressID == addressList[i]["id"]) && stype != "AdditionalDrop"
                                ? SizedBox()
                                : InkWell(
                              onTap: () {
                                setState(() {});
                                selectid = addressList[i]["id"];
                                groupValue = i;

                                // FIX: Add Get.back() here for ALL location types
                                Get.back();

                                if ((paddressID != addressList[i]["id"] && daddressID != addressList[i]["id"]) || stype == "AdditionalDrop") {
                                  if (stype == "Pickup") {
                                    setState(() {});
                                    pick = true;
                                    changepick = pick;
                                    addressId = addressList[i]["id"];
                                    changeaddressId = addressId;
                                    paddressID = addressList[i]["id"];
                                    changepaddressID = paddressID;
                                    lat1 = double.parse("${addressList[i]["lat_map"]}");
                                    changelat1 = lat1;
                                    lon1 = double.parse("${addressList[i]["long_map"]}");
                                    changelon1 = lon1;
                                    phno = addressList[i]["hno"];
                                    changephno = phno;
                                    pname = addressList[i]["c_name"]?.toString();
                                    // Fallback to logged-in user name if address doesn't have name
                                    if (pname == null || pname!.isEmpty || pname == "null") {
                                      try {
                                        var userLogin = getdata.read("UserLogin");
                                        if (userLogin != null && userLogin is Map && userLogin["name"] != null) {
                                          pname = userLogin["name"].toString();
                                        }
                                      } catch (e) {
                                        debugPrint("Error getting user name: $e");
                                      }
                                    }
                                    changepname = pname;
                                    plandmark = addressList[i]["landmark"];
                                    changeplandmark = plandmark;
                                    paddress = addressList[i]["address"];
                                    changepaddress = paddress;
                                    custNumber = addressList[i]["c_number"]?.toString() ?? "";
                                    // Fallback to logged-in user mobile if address doesn't have number
                                    if (custNumber.isEmpty || custNumber == "null") {
                                      try {
                                        var userLogin = getdata.read("UserLogin");
                                        if (userLogin != null && userLogin is Map && userLogin["mobile"] != null) {
                                          String ccode = userLogin["ccode"]?.toString() ?? "";
                                          custNumber = "$ccode${userLogin["mobile"].toString()}";
                                        }
                                      } catch (e) {
                                        debugPrint("Error getting user mobile: $e");
                                      }
                                    }
                                    changecustNumber = custNumber;
                                    paddresstype = addressList[i]["type"];
                                    changepaddresstype = paddresstype;
                                    if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                      calculateDistance(lat1, lon1, lat2, lon2);
                                    }
                                  } else if (stype == "AdditionalDrop") {
                                    // Handle additional drop location selection
                                    String? currentDropLocationId = getdata.read("CurrentDropLocationId");
                                    if (currentDropLocationId != null) {
                                      int index = dropLocations.indexWhere((loc) => loc['id'] == currentDropLocationId);
                                      if (index != -1) {
                                        setState(() {
                                          dropLocations[index]['type'] = addressList[i]["type"];
                                          dropLocations[index]['address'] = addressList[i]["address"];
                                          dropLocations[index]['hno'] = addressList[i]["hno"];
                                          dropLocations[index]['landmark'] = addressList[i]["landmark"];
                                          dropLocations[index]['c_name'] = addressList[i]["c_name"];
                                          dropLocations[index]['c_number'] = addressList[i]["c_number"];
                                          dropLocations[index]['lat_map'] = addressList[i]["lat_map"];
                                          dropLocations[index]['long_map'] = addressList[i]["long_map"];
                                        });
                                      }
                                    }
                                  } else {
                                    setState(() {});
                                    drop = true;
                                    changedrop = drop;
                                    addressId = addressList[i]["id"];
                                    changeaddressId = addressId;
                                    daddressID = addressList[i]["id"];
                                    changedaddressID = daddressID;
                                    dname = addressList[i]["c_name"].toString();
                                    changedname = dname;
                                    lat2 = double.parse(addressList[i]["lat_map"].toString());
                                    changelat2 = lat2;
                                    lon2 = double.parse(addressList[i]["long_map"].toString());
                                    changelon2 = lon2;
                                    dhno = addressList[i]["hno"];
                                    changedhno = dhno;
                                    dlandmark = addressList[i]["landmark"];
                                    changedlandmark = dlandmark;
                                    daddress = addressList[i]["address"];
                                    changedaddress = daddress;
                                    dropNumber = addressList[i]["c_number"];
                                    changedropNumber = dropNumber;
                                    daddresstype = addressList[i]["type"];
                                    changedaddresstype = daddresstype;
                                  }
                                  if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                    calculateDistance(lat1, lon1, lat2, lon2);
                                  }
                                } else {
                                  // This case is already handled by Get.back() above
                                  if (stype == "Pickup") {
                                    drop = false;
                                    changedrop = drop;
                                    daddresstype = null;
                                    changedaddresstype = daddresstype;
                                    daddress = "Choose drop address".tr;
                                    changedaddress = daddress;
                                    addressId = addressList[i]["id"];
                                    changeaddressId = addressId;
                                    daddressID = addressList[i]["id"];
                                    changedaddressID = daddressID;
                                    lat1 = double.parse("${addressList[i]["lat_map"]}");
                                    changelat1 = lat1;
                                    lon1 = double.parse("${addressList[i]["long_map"]}");
                                    changelon1 = lon1;
                                    phno = addressList[i]["hno"];
                                    changephno = phno;
                                    pname = addressList[i]["c_name"]?.toString();
                                    // Fallback to logged-in user name if address doesn't have name
                                    if (pname == null || pname!.isEmpty || pname == "null") {
                                      try {
                                        var userLogin = getdata.read("UserLogin");
                                        if (userLogin != null && userLogin is Map && userLogin["name"] != null) {
                                          pname = userLogin["name"].toString();
                                        }
                                      } catch (e) {
                                        debugPrint("Error getting user name: $e");
                                      }
                                    }
                                    changepname = pname;
                                    plandmark = addressList[i]["landmark"];
                                    changeplandmark = plandmark;
                                    paddress = addressList[i]["address"];
                                    changepaddress = paddress;
                                    custNumber = addressList[i]["c_number"]?.toString() ?? "";
                                    // Fallback to logged-in user mobile if address doesn't have number
                                    if (custNumber.isEmpty || custNumber == "null") {
                                      try {
                                        var userLogin = getdata.read("UserLogin");
                                        if (userLogin != null && userLogin is Map && userLogin["mobile"] != null) {
                                          String ccode = userLogin["ccode"]?.toString() ?? "";
                                          custNumber = "$ccode${userLogin["mobile"].toString()}";
                                        }
                                      } catch (e) {
                                        debugPrint("Error getting user mobile: $e");
                                      }
                                    }
                                    changecustNumber = custNumber;
                                    paddresstype = addressList[i]["type"];
                                    changepaddresstype = paddresstype;
                                    if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                      calculateDistance(lat1, lon1, lat2, lon2);
                                    }
                                  } else {
                                    pick = false;
                                    changepick = pick;
                                    paddresstype = null;
                                    changepaddresstype = paddresstype;
                                    paddress = "Current Location";
                                    changepaddress = paddress;
                                    addressId = addressList[i]["id"];
                                    changeaddressId = addressId;
                                    daddressID = addressList[i]["id"];
                                    changedaddressID = daddressID;
                                    lat2 = double.parse(addressList[i]["lat_map"].toString());
                                    changelat2 = lat2;
                                    lon2 = double.parse(addressList[i]["long_map"].toString());
                                    changelon2 = lon2;
                                    dhno = addressList[i]["hno"];
                                    changedhno = dhno;
                                    dlandmark = addressList[i]["landmark"];
                                    changedlandmark = dlandmark;
                                    dname = addressList[i]["c_name"].toString();
                                    changedname = dname;
                                    daddress = addressList[i]["address"];
                                    changedaddress = daddress;
                                    dropNumber = addressList[i]["c_number"];
                                    changedropNumber = dropNumber;
                                    daddresstype = addressList[i]["type"];
                                    changedaddresstype = daddresstype;
                                    if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                                      calculateDistance(lat1, lon1, lat2, lon2);
                                    }
                                  }
                                }
                              },
                              child: Container(
                                padding: EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  border: Border.all(
                                    color: paddressID == addressList[i]["id"] ||  daddressID == addressList[i]["id"]
                                        ? notifier.darklinercolor
                                        : Colors.transparent,
                                    width: 1,
                                  ),
                                  color: notifier.getBgColor,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      height: 80,
                                      width: 80,
                                      decoration: BoxDecoration(
                                        color: notifier.getimag,
                                        borderRadius: BorderRadius.circular(15),
                                      ),
                                      child: Center(
                                        child: Image.asset(
                                          iconImage ?? "",
                                          height: Get.height / 26,
                                          color: notifier.darklinercolor,
                                        ),
                                      ),
                                    ),
                                    SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          Text(
                                            "${addressList[i]["type"]}",
                                            style: TextStyle(
                                              fontSize: 17,
                                              fontFamily: 'Gilroy_Bold',
                                              color: notifier.text,
                                            ),
                                          ),
                                          SizedBox(
                                            child: Text(
                                              addressList[i]["landmark"] != ""
                                                  ? "${addressList[i]["hno"]}, ${addressList[i]["landmark"]}, ${addressList[i]["address"]}"
                                                  : "${addressList[i]["hno"]}, ${addressList[i]["address"]}",
                                              style: TextStyle(
                                                fontSize: 14,
                                                fontFamily: 'Gilroy_Medium',
                                                color: greaycolor,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Radio(
                                      fillColor: WidgetStateProperty.resolveWith<Color>((states) => notifier.darklinercolor),
                                      activeColor: notifier.darklinercolor,
                                      value: paddressID == addressList[i]["id"] ||  daddressID == addressList[i]["id"]
                                          ? true
                                          : false,
                                      groupValue: true,
                                      onChanged: (value) {
                                        setState(() {});
                                        Get.back(); // FIX: Add Get.back() here too
                                      },
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }, separatorBuilder: (BuildContext context, int index) {
                          return addressId == addressList[index]["id"]
                              ? SizedBox()
                              : SizedBox(height: 10);
                        },
                        ),
                      ),
                      SizedBox(height: 10),
                    ],
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }
//!--------------------- payment Widget --------------------
  final _formKey = GlobalKey<FormState>();
  var numberController = TextEditingController();
  final _paymentCard = PaymentCard();
  var _autoValidateMode = AutovalidateMode.disabled;
  bool isloading = false;

  final _card = PaymentCard();
  stripePayment() {
    return showModalBottomSheet(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      backgroundColor: notifier.getBgColor,
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setState) {
            return SingleChildScrollView(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Padding(
                padding: const EdgeInsets.all(15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      "Add Your payment information".tr,
                      style: TextStyle(
                        fontFamily: "Gilroy_Bold",
                        fontSize: 20,
                        color: notifier.text
                      ),
                    ),
                    SizedBox(height: 20),
                    Form(
                        key: _formKey,
                        autovalidateMode: _autoValidateMode,
                        child: Column(
                          children: [
                            textfild(
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                                LengthLimitingTextInputFormatter(19),
                                CardNumberInputFormatter()
                              ],
                              controller: numberController,
                              onSaved: (String? value) {
                                _paymentCard.number = CardUtils.getCleanedNumber(value!);

                                CardType cardType = CardUtils.getCardTypeFrmNumber(_paymentCard.number.toString());
                                setState(() {
                                  _card.name = cardType.toString();
                                  _paymentCard.type = cardType;
                                });
                              },
                              onChanged: (val) {
                                CardType cardType = CardUtils.getCardTypeFrmNumber(val);
                                setState(() {
                                  _card.name = cardType.toString();
                                  _paymentCard.type = cardType;
                                });
                              },
                              validator: CardUtils.validateCardNum,
                              prefixIcon: SizedBox(
                                height: 10,
                                child: Padding(
                                  padding: EdgeInsets.symmetric(
                                    vertical: 14,
                                    horizontal: 6,
                                  ),
                                  child: CardUtils.getCardIcon(_paymentCard.type),
                                ),
                              ),
                              hintText: "What number is written on card?".tr,
                              labelText: "Number".tr,
                            ),
                            SizedBox(height: 10),
                            Row(
                              children: [
                                Expanded(
                                  child: textfild(
                                    inputFormatters: [
                                      FilteringTextInputFormatter.digitsOnly,
                                      LengthLimitingTextInputFormatter(3),
                                    ],
                                    hintText: "Number behind the card".tr,
                                    labelText: "CVV".tr,
                                    prefixIcon: SizedBox(
                                      height: 10,
                                      child: Padding(
                                        padding: EdgeInsets.symmetric(vertical: 14),
                                        child: Image.asset(
                                          'assets/card_cvv.png',
                                          width: 6,
                                          color: linercolor,
                                        ),
                                      ),
                                    ),
                                    validator: CardUtils.validateCVV,
                                    keyboardType: TextInputType.number,
                                    onSaved: (value) {
                                      _paymentCard.cvv = int.parse(value!);
                                    },
                                  ),
                                ),
                                SizedBox(width: 10),
                                Expanded(
                                  child: textfild(
                                    inputFormatters: [
                                      FilteringTextInputFormatter.digitsOnly,
                                      LengthLimitingTextInputFormatter(4),
                                      CardMonthInputFormatter()
                                    ],
                                    prefixIcon: SizedBox(
                                      height: 10,
                                      child: Padding(
                                        padding: EdgeInsets.symmetric(vertical: 14),
                                        child: Image.asset(
                                          'assets/calender.png',
                                          width: 10,
                                          color: linercolor,
                                        ),
                                      ),
                                    ),
                                    hintText: "MM/YY".tr,
                                    labelText: "Expiry Date".tr,
                                    validator: CardUtils.validateDate,
                                    keyboardType: TextInputType.number,
                                    onSaved: (value) {
                                      List<int> expiryDate = CardUtils.getExpiryDate(value!);
                                      _paymentCard.month = expiryDate[0];
                                      _paymentCard.year = expiryDate[1];
                                    },
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 20),
                            Container(
                              alignment: Alignment.center,
                              child: _getPayButton(),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
          );
        });
      },
    );
  }

  @override
  void dispose() {
    numberController.removeListener(_getCardTypeFrmNumber);
    numberController.dispose();
    super.dispose();
  }

  void _getCardTypeFrmNumber() {
    String input = CardUtils.getCleanedNumber(numberController.text);
    CardType cardType = CardUtils.getCardTypeFrmNumber(input);
    setState(() {
      _paymentCard.type = cardType;
    });
  }

  Widget _getPayButton() {
    return SizedBox(
      width: Get.width,
      child: CupertinoButton(
        onPressed: () {
          final FormState form = _formKey.currentState!;
          if (!form.validate()) {
            setState(() {
              _autoValidateMode = AutovalidateMode.always; // Start validating on every change.
            });
            _showInSnackBar("Please fix the errors in red before submitting.".tr);
          } else {
            var username = getdata.read("UserLogin")["name"];
            var email = getdata.read("UserLogin")["email"];
            _paymentCard.name = username;
            _paymentCard.email = email;
            _paymentCard.amount = deliveryfees.toStringAsFixed(2);
            form.save();
            webViewPaymentMethod(
              initialUrl: "${Config.imageURLPath + Config.stripe}name=${_paymentCard.name}&email=${_paymentCard.email}&cardno=${_paymentCard.number}&cvc=${_paymentCard.cvv}&amt=$deliveryfees&mm=${_paymentCard.month}&yyyy=${_paymentCard.year}",
              status1: "status",
              status2: "success",
              tId: "Transaction_id",
            );
            _showInSnackBar("Payment card is valid".tr);
          }
        },
        color: linercolor,
        child: Text(
          "${"PAY".tr} $currency$deliveryfees",
          style: TextStyle(fontSize: 17.0, color: whitecolor),
        ),
      ),
    );
  }

  void _showInSnackBar(String value) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(value),
        duration: Duration(seconds: 3),
      ),
    );
  }

  PaymentGatwayApiModel? paymentGatwayApiModel;

  paymenrgatway() {
    ApiWrapper.dataGet(Config.paymentgateway)!.then((val) {
      var data = jsonEncode(val);
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
          paymentGatwayApiModel = paymentGatwayApiModelFromJson(data);
        }
      }
    });
  }

  // Set default pickup location to current location
  // Set default pickup location to current location
  Future<void> _setDefaultPickupLocation() async {
    try {
      // Check if pickup address is already set
      var savedPickup = getdata.read("PickupAddress");
      if (savedPickup != null && savedPickup is List && savedPickup.isNotEmpty) {
        var saved = savedPickup[0];

        // If the cached address is literally just "Current Location" from older bugs, we should refetch
        if (saved["address"] == "Current Location") {
           getdata.remove("PickupAddress"); // Clear bad cache
        } else {
          setState(() {
            lat1 = double.tryParse(saved["lat_map"].toString());
            changelat1 = lat1;
            lon1 = double.tryParse(saved["long_map"].toString());
            changelon1 = lon1;
            phno = saved["hno"] ?? "";
            changephno = phno;
            plandmark = saved["landmark"] ?? "";
            changeplandmark = plandmark;
            paddress = saved["address"] ?? "Current Location";
            changepaddress = paddress;
            paddresstype = saved["type"] ?? "Current Location";
            changepaddresstype = paddresstype;
            pname = saved["c_name"]?.toString();
            changepname = pname;
            custNumber = saved["c_number"]?.toString() ?? "";
            changecustNumber = custNumber;
            pick = true;
            changepick = true;

            if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
              calculateDistance(lat1, lon1, lat2, lon2);
            }
          });
          return; // Already set with valid data, don't override
        }
      }

      double? lat;
      double? lon;

      // Check if current location is available
      if (currentLat != null && currentLong != null) {
        lat = currentLat;
        lon = currentLong;
      } else {
        // Try to get current location
        try {
          Position position = await customGetLatLong();
          currentLat = position.latitude;
          currentLong = position.longitude;
          lat = currentLat;
          lon = currentLong;
        } catch (e) {
          debugPrint("Error getting current location: $e");
          return;
        }
      }

      if (lat != null && lon != null) {
        // Get address string from coordinates
        String addressStr = await _getAddressStringFromCoordinates(lat, lon);

        if (addressStr.isNotEmpty) {
          setState(() {
            lat1 = lat;
            changelat1 = lat1;
            lon1 = lon;
            changelon1 = lon1;
            paddress = addressStr;
            changepaddress = paddress;
            paddresstype = "Current Location";
            changepaddresstype = paddresstype;
            pick = true;
            changepick = true;

            // Save this current location as the PickupAddress so routing/calculating works
            var addressdata = {
              "hno": "",
              "c_ddress": "",
              "address": addressStr,
              "c_name": pname ?? "",
              "c_number": custNumber,
              "lat_map": lat,
              "long_map": lon,
              "landmark": "",
              "type": paddresstype,
            };
            addressList.clear();
            addressList.add(addressdata);
            save("PickupAddress", addressList);

            // ✅ FIX: Recalculate distance if drop is already selected
            debugPrint("🟡 [FIX] Fresh pickup location set: lat1=$lat1, lon1=$lon1, lat2=$lat2, lon2=$lon2");
            if (lat2 != null && lon2 != null) {
              debugPrint("🟢 [FIX] Drop already selected — triggering calculateDistance()");
              calculateDistance(lat1, lon1, lat2, lon2);
            } else {
              debugPrint("⚠️ [FIX] Drop not selected yet — distance calc deferred");
            }

            // Set default user name and mobile number if not already set
            try {
              var userLogin = getdata.read("UserLogin");
              if (userLogin != null && userLogin is Map) {
                if ((pname == null || pname!.isEmpty) && userLogin["name"] != null) {
                  pname = userLogin["name"].toString();
                  changepname = pname;
                  addressdata["c_name"] = pname!;
                }
                if (custNumber.isEmpty && userLogin["mobile"] != null) {
                  String ccode = userLogin["ccode"]?.toString() ?? "";
                  custNumber = "$ccode${userLogin["mobile"].toString()}";
                  changecustNumber = custNumber;
                  addressdata["c_number"] = custNumber;
                }

                // update saved pickup address with new names/numbers
                addressList.clear();
                addressList.add(addressdata);
                save("PickupAddress", addressList);
              }
            } catch (e) {
              debugPrint("Error setting default user data in _setDefaultPickupLocation: $e");
            }
          });
        }
      }
    } catch (e) {
      debugPrint("Error setting default pickup location: $e");
    }
  }

  Future<String> _getCurrentAddressString() async {
    if (currentLat == null || currentLong == null) return "";
    return await _getAddressStringFromCoordinates(currentLat!, currentLong!);
  }

  Future<String> _getAddressStringFromCoordinates(double lat, double lon) async {
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(lat, lon);
      if (placemarks.isNotEmpty) {
        Placemark place = placemarks[0];
        String name = place.name.toString();
        String thoroughfare = place.thoroughfare.toString();
        String area = place.subLocality.toString();
        String city = place.locality.toString();
        String state = place.administrativeArea.toString();
        String country = place.country.toString();
        return "$name${(name.isNotEmpty) ? ", " : ""}$thoroughfare${(thoroughfare.isNotEmpty) ? ", " : ""}$area${(area.isNotEmpty) ? ", " : ""}$city${(city.isNotEmpty) ? ", " : ""}$state${(state.isNotEmpty) ? ", " : ""}$country.";
      }
    } catch (e) {
      debugPrint("Error getting address: $e");
    }
    return "";
  }

  checkAddress() {
    var uid = getdata.read("Uid") ?? "";
    var data = {"uid": uid};
    ApiWrapper.dataPost(Config.address, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          addressList = val["AddressList"];
          isLoading = false;
          setState(() {});
        } else if ((val['ResponseCode'] == "401") && (val['Result'] == "false")) {
          setState(() {});
          isLoading = false;
          setState(() {});
        } else {
          tostmsg("Something went wrong,");
        }
      }
    });
  }

  PackageListApiModel? packageListApiModel;



  // Delivery types will be created from package API data
  List<Map<String, dynamic>> deliveryTypes = [];
  bool hasDeliveryData = false;
  // Multi-select: set of selected delivery type indexes
  Set<int> selectedDeliveryTypeIndexes = {};
  // Keep for backward compat with bill breakdown (highest-cost selected)
  int get selectedDeliveryTypeIndex => _highestCostSelectedIndex;
  int get _highestCostSelectedIndex {
    if (selectedDeliveryTypeIndexes.isEmpty) return -1;
    int best = selectedDeliveryTypeIndexes.first;
    double bestCost = double.tryParse(deliveryTypes[best]['calculatedCost']?.toString() ?? '0') ?? 0.0;
    for (int idx in selectedDeliveryTypeIndexes) {
      double c = double.tryParse(deliveryTypes[idx]['calculatedCost']?.toString() ?? '0') ?? 0.0;
      if (c > bestCost) { bestCost = c; best = idx; }
    }
    return best;
  }

// Add these variables at the top of your class with other variables
  double start_range = 1.0; // Default value
  double end_range = 10.0; // Default value

// In your packageListApi() function, update these values from the API response
  Future packageListApi() async {
    var uid = getdata.read("Uid") ?? "0";
   // var data = {"uid": uid};
    Map<String, dynamic> data = {
      "uid": uid,
      "cat_id": getdata.read("SelectedCatId")?.toString() ?? "8",
      "type": "USER"
    };
    debugPrint("PackageListApi request data (Node ${Config.nodePackageList}): $data");

    setState(() {
      isLoading = true;
      hasDeliveryData = false;
    });

    ApiWrapper.dataPostNode(Config.nodePackageList, data).then((val) {
      debugPrint("🟢 PACKAGE API RESPONSE (Node): ${val.toString()}");

      if (val != null && val.isNotEmpty) {
        // ✅ PROPER RESPONSE CHECK
        bool isSuccess = (val['ResponseCode'] == "200" || val['ResponseCode'] == 200) &&
            (val['Result'] == "true" || val['Result'] == true);

        // ✅ FIX: Extract start_range and end_range from API response
        if (val['start_range'] != null) {
          start_range = double.tryParse(val['start_range'].toString()) ?? 1.0;
        }
        if (val['end_range'] != null) {
          end_range = double.tryParse(val['end_range'].toString()) ?? 10.0;
        }
        maxExtraStops = int.tryParse(val['max_extra_stops']?.toString() ?? '') ?? 2;

        debugPrint("📏 KM Range from API - Start: $start_range, End: $end_range");

        if (isSuccess && val['PackageData'] != null) {
          deliveryTypes.clear();

          for (var package in val['PackageData']) {
            debugPrint("📦 Processing Package: $package");

            // ✅ NEW API STRUCTURE PARSING
            String? id = package['id']?.toString();
            String? title = package['title']?.toString();
            String? status = package['status']?.toString();
            String? minChargeStr = package['min_charge']?.toString();
            String? perKmChargeStr = package['per_km_charge']?.toString();
            String? pickupPerKmChargeStr = package['pickup_per_km_charge']?.toString() ?? package['pickup_per_km']?.toString();
            String? freeWaitingTimeStr = package['free_waiting_time']?.toString();
            String? waitingChargeStr = package['waiting_charge']?.toString();
            String? serviceChargePercentStr = package['service_charge_percent']?.toString();
            String? nightChargePercentStr = package['night_charge_percent']?.toString();
            String? appliedNightChargePercentStr = package['applied_night_charge_percent']?.toString();
            String? startTimeStr = package['start_time']?.toString();
            String? endTimeStr = package['end_time']?.toString();
            int isNight = int.tryParse(package['is_night']?.toString() ?? '0') ?? 0;

            String? loadingCharge = package['loading_charge']?.toString();
            String? unloadingCharge = package['unloading_charge']?.toString();
            String? serviceCharge = package['service_charge']?.toString();
            String? userDetailImage = package['user_detail_image']?.toString();
            if (userDetailImage == null || userDetailImage.isEmpty || userDetailImage == "null") {
              userDetailImage = package['img']?.toString() ??
                                package['image']?.toString() ??
                                package['photo']?.toString() ??
                                package['icon']?.toString() ??
                                package['user_image']?.toString();
            }

            if (title != null && perKmChargeStr != null) {
              deliveryTypes.add({
                'id': id,
                'title': title,
                'switch': status == "1",

                'loading_charge': double.tryParse(loadingCharge ?? '0') ?? 0.0,
                'unloading_charge': double.tryParse(unloadingCharge ?? '0') ?? 0.0,
                'service_charge': double.tryParse(serviceCharge ?? '0') ?? 0.0,
               // 'free_waiting_time': double.tryParse(freeWaitingTime ?? '0') ?? 0.0,
                //'waiting_charge': double.tryParse(waitingCharge ?? '0') ?? 0.0,

                'min_charge': double.tryParse(minChargeStr ?? '0') ?? 0.0,
                'per_km_charge': double.tryParse(perKmChargeStr) ?? 0.0,
                'pickup_per_km_charge': double.tryParse(pickupPerKmChargeStr ?? '') ?? (double.tryParse(perKmChargeStr) ?? 0.0),
                'free_waiting_time': freeWaitingTimeStr ?? '0',
                'waiting_charge': double.tryParse(waitingChargeStr ?? '0') ?? 0.0,
                'service_charge_percent': double.tryParse(serviceChargePercentStr ?? '0') ?? 0.0,
                'night_charge_percent': double.tryParse(nightChargePercentStr ?? '0') ?? 0.0,
                'applied_night_charge_percent': double.tryParse(appliedNightChargePercentStr ?? '0') ?? 0.0,
                'start_time': startTimeStr ?? '00:00:00',
                'end_time': endTimeStr ?? '00:00:00',
                'is_night': isNight,
                'user_detail_image': userDetailImage,
                'cost': '0', // Will be calculated dynamically
              });

              debugPrint("✅ Added Delivery Type: $title, Per KM: $perKmChargeStr");
            }
          }

          hasDeliveryData = deliveryTypes.isNotEmpty;
          debugPrint("🎯 Total Delivery Types: ${deliveryTypes.length}");

          // ✅ UPDATE ALL DELIVERY TYPE COSTS BASED ON CURRENT DISTANCE
          if (totaldistance > 0) {
            _updateAllDeliveryTypeCosts();
          }

          // ✅ AUTO-SELECT FIRST DELIVERY TYPE
          if (deliveryTypes.isNotEmpty && selectedDeliveryTypeIndexes.isEmpty) {
            selectedDeliveryTypeIndexes.add(0);
            _updateDeliveryFeesForMultiSelect();
            debugPrint("🎯 Auto-selected delivery type: ${deliveryTypes[0]['title']}");
          }
        } else {
          debugPrint("🔴 API Success but no PackageData");
          deliveryTypes = [];
          hasDeliveryData = false;
        }
      } else {
        debugPrint("🔴 Empty API Response");
        deliveryTypes = [];
        hasDeliveryData = false;
      }

      setState(() {
        isLoading = false;
      });
    }).catchError((error) {
      debugPrint("🔴 API Error: $error");
      setState(() {
        isLoading = false;
        hasDeliveryData = false;
        deliveryTypes = [];
      });
    });
  }

// Add this method to debug the API response structure
  void debugApiResponse(dynamic val) {
    debugPrint("=== DEBUG API RESPONSE STRUCTURE ===");
    debugPrint("ResponseCode type: ${val['ResponseCode'].runtimeType}");
    debugPrint("ResponseCode value: ${val['ResponseCode']}");
    debugPrint("Result type: ${val['Result'].runtimeType}");
    debugPrint("Result value: ${val['Result']}");
    debugPrint("ResponseMsg: ${val['ResponseMsg']}");

    if (val['PackageData'] != null) {
      debugPrint("PackageData type: ${val['PackageData'].runtimeType}");
      debugPrint("PackageData length: ${val['PackageData'].length}");
      if (val['PackageData'].isNotEmpty) {
        debugPrint("First package item: ${val['PackageData'][0]}");
      }
    }
    debugPrint("=== END DEBUG ===");
  }

  void _updateDeliveryFeesBasedOnSelection(int index) {
    // Legacy single-select call — delegate to multi-select updater
    _updateDeliveryFeesForMultiSelect();
  }

  /// Recalculates deliveryfees using the highest-cost item among selected indexes.
  void _updateDeliveryFeesForMultiSelect() {
    if (deliveryTypes.isEmpty || selectedDeliveryTypeIndexes.isEmpty) return;

    // First update all costs
    _updateAllDeliveryTypeCosts();

    // Find highest cost item
    int bestIdx = _highestCostSelectedIndex;
    var item = deliveryTypes[bestIdx];

    double perKmCharge = double.tryParse(item['per_km_charge']?.toString() ?? '0') ?? 0.0;
    double minChargeValue = double.tryParse(item['min_charge']?.toString() ?? '0') ?? 0.0;
    double serviceChargePercent = double.tryParse(item['service_charge_percent']?.toString() ?? '0') ?? 0.0;
    // double waitingCharge = double.tryParse(item['waiting_charge']?.toString() ?? '0') ?? 0.0;
    double waitingCharge = 0.0; // Waiting charge disabled
    double nightChargeFixed = double.tryParse(item['applied_night_charge_percent']?.toString() ?? '0') ?? 0.0;
    int isNight = int.tryParse(item['is_night']?.toString() ?? '0') ?? 0;

    debugPrint("🔄 Multi-select fees update - Highest cost index: $bestIdx, Per KM: $perKmCharge");

    setState(() {
      double deliveryChargeAmount = perKmCharge * totaldistance;
      double serviceChargeAmount = (serviceChargePercent / 100) * deliveryChargeAmount;
      double nightChargeAmount = (isNight == 1) ? nightChargeFixed : 0.0;
      double pickupChargesAmount = _currentExtraKmCharges;
      _extraKmCharges = pickupChargesAmount;
      double minimumChargeAmount = minChargeValue;
      deliveryfees = (pickupChargesAmount + minimumChargeAmount + serviceChargeAmount + deliveryChargeAmount + waitingCharge + nightChargeAmount).roundToDouble();
      packageSize = deliveryChargeAmount.toStringAsFixed(2);
      packageWeight = waitingCharge.toString();
    });
  }

  // Get selected per_km_charge from deliveryTypes for bill calculation
  double _getSelectedKmForBill() {
    if (selectedDeliveryTypeIndex != -1 &&
        deliveryTypes.isNotEmpty &&
        selectedDeliveryTypeIndex < deliveryTypes.length) {
      double perKmCharge = double.tryParse(deliveryTypes[selectedDeliveryTypeIndex]['per_km_charge']?.toString() ?? '0') ?? 0.0;
      return perKmCharge;
    }
    return 0.0;
  }

  Widget _buildCalculateButton() {
    return Container(
      padding: EdgeInsets.only(
        left: 10, 
        right: 10, 
        top: 5, 
        bottom: MediaQuery.of(context).viewInsets.bottom + 
                MediaQuery.of(context).padding.bottom + 10
      ),
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: notifier.darklinercolor,
          minimumSize: Size(double.infinity, 50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
          ),
        ),
        onPressed: () {
          // ✅ FINAL CALCULATION EK HI BAAR
          _calculateFinalFees();

          if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
            // Get delivery type IDs (comma-separated) before navigating
            String deliveryTypeId = "0";
            if (selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty) {
              deliveryTypeId = selectedDeliveryTypeIndexes
                  .map((i) => deliveryTypes[i]['id']?.toString() ?? "0")
                  .join(',');
            }

            _fetchWalletBalance().then((walletBalance) {
              Get.to(() => ConfirmOrderMap(
                startLat: lat1!,
                startLng: lon1!,
                endLat: lat2!,
                endLng: lon2!,
                deliveryFees: deliveryfees,
                walletBalance: walletBalance,
                currency: currency ?? '',
                deliveryType: deliveryTypeId,
                onConfirmPayment: (int payValue, String paymentTitle) {
                  setState(() {
                    paymenttital = paymentTitle;
                    _payValue = payValue;
                    isPaymentLoding = true;
                  });
                  if (payValue == -2) {
                    processWalletPayment(fromDialog: false);
                  } else if (payValue == 1) {
                    processCashPayment();
                  }
                },
                onViewBreakup: () {
                  showPriceBreakupDialog();
                },
              ));
            });
          } else {
            ApiWrapper.showToastMessage("Please select both Pickup and Drop locations");
          }
        },
        child: Text(
          "Continue to Book".tr,
          style: TextStyle(
            fontSize: 16,
            fontFamily: 'Gilroy_Bold',
            color: Colors.white,
          ),
        ),
      ),
    );
  }

  /*void _calculateFinalFees() {
    _updateDeliveryFeesForMultiSelect();
    debugPrint("💳 FINAL AMOUNT (multi-select): $currency$deliveryfees");
  }*/

  void _calculateFinalFees() {
    // ✅ FIX: Ensure distance is fresh before final calculation
    if (totaldistance <= 0 && lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
      debugPrint("🔴 [_calculateFinalFees] totaldistance was 0 — recalculating");
      calculateDistance(lat1, lon1, lat2, lon2);
    }
    _updateDeliveryFeesForMultiSelect();
    deliveryfees = deliveryfees.roundToDouble();
    debugPrint("💳 FINAL AMOUNT (multi-select): $currency$deliveryfees, distance: $totaldistance");
  }

  // Update delivery type selection (multi-select toggle)
  void updateDeliveryTypeSelection(int index) {
    setState(() {
      if (selectedDeliveryTypeIndexes.contains(index)) {
        if (selectedDeliveryTypeIndexes.length > 1) {
          selectedDeliveryTypeIndexes.remove(index);
        }
      } else {
        selectedDeliveryTypeIndexes.add(index);
      }
    });
    _updateDeliveryFeesForMultiSelect();
  }

  // Update delivery type switch (for ON/OFF toggle)
  void updateDeliveryTypeSwitch(int index, bool value) {
    setState(() {
      deliveryTypes[index]['switch'] = value;
    });
  }



  // -------------------------------------------------------
  //! Booking Type — helper methods
  // -------------------------------------------------------

  /// Returns formatted schedule date-time string: "dd-MM-yyyy HH:mm"
  String _formatScheduleDateTime(DateTime dt) {
    final dd = dt.day.toString().padLeft(2, '0');
    final mm = dt.month.toString().padLeft(2, '0');
    final yyyy = dt.year.toString();
    final hh = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    return "$dd-$mm-$yyyy $hh:$min";
  }

  /// Returns a charge value (as String) from the highest-cost selected delivery type.
  String _getSelectedDeliveryCharge(String key) {
    if (selectedDeliveryTypeIndex != -1 && deliveryTypes.isNotEmpty) {
      var item = deliveryTypes[selectedDeliveryTypeIndex];
      var val = item[key];
      if (val != null) {
        return double.tryParse(val.toString())?.toStringAsFixed(2) ?? "0.00";
      }
    }
    return "0.00";
  }

  /// Opens date + time pickers and sets [scheduledDateTime].
  Future<void> _pickScheduleDateTime() async {
    final now = DateTime.now();
    // Date picker — minimum tomorrow
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: scheduledDateTime ?? now.add(const Duration(hours: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: ColorScheme.light(
            primary: linercolor,
            onPrimary: Colors.white,
            surface: notifier.lightBgColor,
            onSurface: notifier.text,
          ),
        ),
        child: child!,
      ),
    );
    if (pickedDate == null) return;

    // Time picker
    final pickedTime = await showTimePicker(
      context: context,
      initialTime: scheduledDateTime != null
          ? TimeOfDay.fromDateTime(scheduledDateTime!)
          : TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: ColorScheme.light(
            primary: linercolor,
            onPrimary: Colors.white,
            surface: notifier.lightBgColor,
            onSurface: notifier.text,
          ),
        ),
        child: child!,
      ),
    );
    if (pickedTime == null) return;

    setState(() {
      scheduledDateTime = DateTime(
        pickedDate.year, pickedDate.month, pickedDate.day,
        pickedTime.hour, pickedTime.minute,
      );
    });
  }

  /// Booking type selector widget.
  Widget _buildBookingTypeSelector() {
    final List<Map<String, dynamic>> bookingOptions = [
      {'type': 1, 'label': 'Current\nBooking',  'icon': Icons.flash_on_rounded},
      {'type': 2, 'label': 'Schedule\nBooking', 'icon': Icons.calendar_month_rounded},
      {'type': 3, 'label': 'Next Day\nBooking', 'icon': Icons.wb_sunny_rounded},
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          "Booking Type".tr,
          style: TextStyle(
            color: notifier.text,
            fontFamily: 'Gilroy_Bold',
            fontSize: 15,
          ),
        ),
        SizedBox(height: 10),
        Row(
          children: bookingOptions.map((opt) {
            final isSelected = selectedBookingType == opt['type'];
            return Expanded(
              child: GestureDetector(
                onTap: () {
                  setState(() {
                    selectedBookingType = opt['type'];
                    if (selectedBookingType != 2) {
                      scheduledDateTime = null;
                    }
                  });
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: EdgeInsets.only(right: opt['type'] != 3 ? 8 : 0),
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? linercolor
                        : notifier.getBgColor,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isSelected ? linercolor : notifier.bordecolor,
                      width: isSelected ? 2 : 1,
                    ),
                    boxShadow: isSelected
                        ? [BoxShadow(color: linercolor.withOpacity(0.25), blurRadius: 8, offset: Offset(0, 3))]
                        : [],
                  ),
                  child: Column(
                    children: [
                      Icon(
                        opt['icon'] as IconData,
                        color: isSelected ? Colors.white : notifier.darklinercolor,
                        size: 22,
                      ),
                      SizedBox(height: 6),
                      Text(
                        (opt['label'] as String).tr,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: isSelected ? Colors.white : notifier.text,
                          fontFamily: isSelected ? 'Gilroy_Bold' : 'Gilroy_Medium',
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }).toList(),
        ),

        // ── Info note — only shown for type 3 (no fixed pickup time)
        if (selectedBookingType == 3) ...[
          SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: notifier.getBgColor,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: notifier.bordecolor, width: 1),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline_rounded, color: greaycolor, size: 16),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    "Pickup will happen sometime between 10 AM and 8 PM tomorrow — exact time isn't fixed.".tr,
                    style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11.5),
                  ),
                ),
              ],
            ),
          ),
        ],

        // ── Schedule date/time picker — only shown for type 2
        if (selectedBookingType == 2) ...[
          SizedBox(height: 12),
          GestureDetector(
            onTap: _pickScheduleDateTime,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: notifier.getBgColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: scheduledDateTime != null ? linercolor : notifier.bordecolor,
                  width: scheduledDateTime != null ? 1.5 : 1,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.access_time_rounded,
                    color: linercolor,
                    size: 22,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Schedule Date & Time".tr,
                          style: TextStyle(
                            color: greaycolor,
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 11,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          scheduledDateTime != null
                              ? _formatScheduleDateTime(scheduledDateTime!)
                              : "Tap to select date & time".tr,
                          style: TextStyle(
                            color: scheduledDateTime != null ? notifier.text : greaycolor,
                            fontFamily: scheduledDateTime != null ? 'Gilroy_Bold' : 'Gilroy_Medium',
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chevron_right_rounded,
                    color: greaycolor,
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }

  //! -------- order Api call ------
  orderParcelApi(otid) async {
    var uid = getdata.read("Uid") ?? "";

    // ✅ COMPREHENSIVE NULL CHECKS
    if (_payValue == null) {
      _payValue = 0;
      debugPrint("⚠️ _payValue was null, set to 0");
    }

    if (custNumber.isEmpty || custNumber == "null") {
      custNumber = "0000000000";
      debugPrint("⚠️ custNumber was empty, set to default");
    }

    if (dropNumber.isEmpty || dropNumber == "null") {
      dropNumber = custNumber; // Use pickup number
      debugPrint("⚠️ dropNumber was empty, using pickup number");
    }

    // ✅ ENSURE TOTALDISTANCE IS VALID BEFORE VALIDATION
    if (totaldistance <= 0) {
      if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
        calculateDistance(lat1, lon1, lat2, lon2);
      }
      if (totaldistance <= 0) {
        totaldistance = 1.0;
      }
    }

    // ✅ VALIDATE CRITICAL FIELDS
    List<String> missingFields = [];
    if (lat1 == null) missingFields.add("Pickup Latitude");
    if (lon1 == null) missingFields.add("Pickup Longitude");
    if (lat2 == null) missingFields.add("Drop Latitude");
    if (lon2 == null) missingFields.add("Drop Longitude");
    if (paddresstype == null) missingFields.add("Pickup Address Type");
    if (daddresstype == null) missingFields.add("Drop Address Type");
    if (totaldistance <= 0) missingFields.add("Distance");
    if (deliveryfees <= 0) missingFields.add("Delivery Fees");

    if (missingFields.isNotEmpty) {
      // ✅ FIX: Detailed debug log to catch this in future
      debugPrint("❌❌❌ ORDER VALIDATION FAILED ❌❌❌");
      debugPrint("   lat1=$lat1, lon1=$lon1, lat2=$lat2, lon2=$lon2");
      debugPrint("   paddresstype=$paddresstype, daddresstype=$daddresstype");
      debugPrint("   totaldistance=$totaldistance, deliveryfees=$deliveryfees");
      debugPrint("   Missing Fields: ${missingFields.join(", ")}");
      tostmsg("Please complete all required fields: ${missingFields.join(", ")}");
      isPaymentLoding = false;
      setState(() {});
      return;
    }

    var picupAddress = plandmark == "" || plandmark == null
        ? "$phno, $paddress"
        : "$phno, $plandmark, $paddress";

    var dropeAddress = dlandmark == "" || dlandmark == null
        ? "$dhno, $daddress"
        : "$dhno, $dlandmark, $daddress";

    // ✅ CLEAN ADDRESS STRINGS
    picupAddress = picupAddress.replaceAll("null, ", "").replaceAll("null", "").trim();
    dropeAddress = dropeAddress.replaceAll("null, ", "").replaceAll("null", "").trim();

    // ✅ EXTRACT DELIVERY TYPE IDs AS ARRAY
    /*List<String> deliveryTypeIds = ["0"];
    if (selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty) {
      deliveryTypeIds = selectedDeliveryTypeIndexes
          .map((i) => deliveryTypes[i]['id']?.toString() ?? "0")
          .toList();
    }*/

    // ✅ NAYA (integers)
    List<int> deliveryTypeIds = [0];
    if (selectedDeliveryTypeIndexes.isNotEmpty && deliveryTypes.isNotEmpty) {
      deliveryTypeIds = selectedDeliveryTypeIndexes
          .map((i) => int.tryParse(deliveryTypes[i]['id']?.toString() ?? "0") ?? 0)
          .toList();
    }

    // ✅ Order creation goes to the Node backend directly (not the legacy PHP
    // pks_order.php) — see backend/API_INTEGRATION_GUIDE.md §3.3. Node
    // computes distance/fare itself server-side, so client-computed
    // d_charge/total_dcharge/distance are NOT sent; only what Node actually
    // reads (orderController.createOrder) goes in this map. delivery_type
    // must be a real JSON array (not a pre-stringified one — dataPostNode
    // JSON-encodes the whole map once), and radius_km is the customer's
    // actual selected search radius (_selectedKm), not a package rate.
    try {
      String? photosPath;
      if (imageList.isNotEmpty) {
        List<String> uploadedPaths = [];
        for (final img in imageList) {
          final path = await ApiWrapper.uploadPhotoNode(img.toString());
          if (path != null) uploadedPaths.add(path);
        }
        if (uploadedPaths.isNotEmpty) photosPath = uploadedPaths.join(",");
      }

      Map<String, dynamic> nodeData = {
        'uid': int.tryParse(uid.toString()) ?? 0,
        'category': dropdownvalue.isNotEmpty ? dropdownvalue : selectedWheelerName,
        'delivery_type': deliveryTypeIds,
        'booking_type': selectedBookingType,
        'plat': lat1,
        'plong': lon1,
        'paddress': picupAddress,
        'pick_name': pname?.isNotEmpty == true ? pname! : "Customer",
        'pmobile': custNumber,
        'pick_type': paddresstype?.toString() ?? "Other",
        'dlat': lat2,
        'dlong': lon2,
        'daddress': dropeAddress,
        'drop_name': dname?.isNotEmpty == true ? dname! : "Recipient",
        'dmobile': dropNumber,
        'drop_type': daddresstype?.toString() ?? "Other",
        'package_weight': packageSize?.isNotEmpty == true ? packageSize! : "0",
        'package_cost': packageSize?.isNotEmpty == true ? packageSize! : "0",
        'description': dropnote.text.isNotEmpty ? dropnote.text : "No description provided",
        'p_method_id': _payValue ?? 0,
        'transaction_id': otid?.toString() ?? "NA_${DateTime.now().millisecondsSinceEpoch}",
        'extra_mile_charge': exmilecharge,
        'cou_id': cid?.isNotEmpty == true ? cid! : "0",
        'cou_amt': camount?.isNotEmpty == true ? camount! : "0",
        'radius_km': _selectedKm,
        'stops': dropLocations
            .where((stop) => stop['is_main'] != true && stop['lat_map'] != null && stop['long_map'] != null)
            .take(maxExtraStops)
            .map((stop) => {
              'lat': stop['lat_map'],
              'lng': stop['long_map'],
              'address': stop['address'],
              'hno': stop['hno'],
              'landmark': stop['landmark'],
              'contact_name': stop['c_name'],
              'contact_number': stop['c_number'],
            }).toList(),
        if (photosPath != null) 'photos': photosPath,
        if (selectedBookingType == 2 && scheduledDateTime != null)
          'schedule_date_time': _formatScheduleDateTime(scheduledDateTime!),
      };

      debugPrint("🎯 NODE ORDER CREATE DATA:");
      nodeData.forEach((key, value) => debugPrint("   🔵 $key: $value"));

      var val = await ApiWrapper.dataPostNode(Config.nodeOrderCreate, nodeData);
      debugPrint("🔄 Node API Response: $val");

      if (val != null && val is Map && val['ResponseCode'] == "200" && val['Result'] == "true") {
        debugPrint("✅ Order created successfully!");
        save("OrderID", val["order_id"]);
        if (mounted) setState(() => isPaymentLoding = false);

        String bookingType = val["booking_type"]?.toString() ?? "";
        String responseMsg = val["ResponseMsg"] ?? "Package Order Placed Successfully!!!";

        if (bookingType == "1") {
          debugPrint("⏳ booking_type is 1: Navigating to WaitingScreen...");
          Get.to(() => WaitingScreen(orderId: val["order_id"].toString()));
          ApiWrapper.showToastMessage(responseMsg);
        } else {
          debugPrint("🏠 booking_type is not 1 ($bookingType): Showing message and navigating to Home...");
          ApiWrapper.showToastMessage(responseMsg);
          Get.offAll(() => const Bottombar());
        }
      } else {
        debugPrint("❌ Order creation failed: $val");
        if (mounted) setState(() => isPaymentLoding = false);
        String errorMsg = (val is Map ? val["ResponseMsg"] : null) ?? "Unknown error occurred";
        ApiWrapper.showToastMessage("Order failed: $errorMsg");
      }
    } catch (error) {
      debugPrint("💥 Node order create exception: $error");
      if (mounted) setState(() => isPaymentLoding = false);
      ApiWrapper.showToastMessage("Network error: ${error.toString()}");
    }
  }

  webViewPaymentMethod({
    required String initialUrl,
    required String status1,
    required String status2,
    required String tId,
  }) {
    debugPrint("************* coman webview *************");
    Get.back();
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => PaymentWebVIew(
          initialUrl: initialUrl,
          navigationDelegate: (request) async {
            final uri = Uri.parse(request.url);

            debugPrint("************ URL *****:--- $initialUrl");
            debugPrint("************ Navigating to URL: ${request.url}");
            debugPrint("************ Parsed URI: $uri");
            debugPrint("************ 2435243254: ${uri.queryParameters[status1]}");
            debugPrint("************ queryParamiter: ${uri.queryParametersAll}");
            debugPrint("************ queryParamiter transaction_id: ${uri.queryParameters[tId]}");

            final status = uri.queryParameters[status1];
            debugPrint(" /*/*/*/*/*/*/*/*/*/*/*/*/*/ Status ---- $status");
            if (status == null) {
              debugPrint("No status parameter found.");
            } else {
              debugPrint("Status parameter: $status");
              if (status == status2) {
                debugPrint("Purchase successful.");
                orderParcelApi("${uri.queryParameters[tId]}");
                return NavigationDecision.prevent;
              } else {
                debugPrint("Purchase failed with status: $status.");
                Navigator.pop(context);
                tostmsg(status);
                isPaymentLoding = false;
                setState(() {});
                return NavigationDecision.prevent;
              }
            }
            isPaymentLoding = false;
            setState(() {});
            return NavigationDecision.navigate;
          },
        ),
      ),
    );
  }

  void _toggleTooltip() {
    if (_tooltipVisible) {
      _hideTooltip();
    } else {
      _showTooltip();
    }
  }

  void _showTooltip() {
    final RenderBox renderBox = _buttonKey.currentContext!.findRenderObject() as RenderBox;
    final Offset position = renderBox.localToGlobal(Offset.zero);

    _overlayEntry = OverlayEntry(
      builder: (context) => Stack(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: _hideTooltip, // Tap outside to close
            child: Container(
              color: Colors.transparent,
            ),
          ),
          Positioned(
            left: position.dx,
            top: exmilecharge == 0 && additionalKmCharge == 0
              ? position.dy - 125
              : exmilecharge == 0 ? position.dy - 145 : position.dy - 165,
            child: Material(
              color: Colors.transparent,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 300,
                    padding: EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Color(0xFF1E1E1E),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              "Delivery Partner Fee",
                              style: TextStyle(
                                color: whitecolor,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 15,
                              ),
                            ),
                            Text(
                              " $currency${totalDeliveryfees.toStringAsFixed(2)}",
                              style: TextStyle(
                                color: Colors.white,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 10),
                        Text(
                          "Standard fee (${totaldistance.toStringAsFixed(2)} Km.)",
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            color: whitecolor,
                            fontSize: 14,
                          ),
                        ),
                        SizedBox(height: 8),
                        tooltipComanText(text1: "First ${ukms}Km. rate : ", text2: "$currency${utprice.toStringAsFixed(2)}"),
                        if (additionalKmCharge > 0) ...[
                          SizedBox(height: 5),
                          tooltipComanText(text1: "Additional ${aukms.toStringAsFixed(2)}Km. rate : ", text2: "$currency${additionalKmCharge.toStringAsFixed(2)}"),
                        ],
                        if (exmilecharge > 0) ...[
                          SizedBox(height: 5),
                          tooltipComanText(text1: "Extra charges weather/distance (${priceData["mile_charge"]}%) : ", text2: "$currency${exmilecharge.toStringAsFixed(2)}"),
                        ],

                        SizedBox(height: 5),
                        tooltipComanText(text1: "Package Rate : ", text2: "$currency$packageSize")
                      ],
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.only(left: 20),
                    child: CustomPaint(
                      painter: DownwardTrianglePainter(),
                      child: SizedBox(width: 15, height: 10),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );

    Overlay.of(context).insert(_overlayEntry!);
    _tooltipVisible = true;
  }

  void _hideTooltip() {
    _overlayEntry?.remove();
    _overlayEntry = null;
    _tooltipVisible = false;
  }

  void addNewDropLocation() {
    if (dropLocations.where((location) => location['is_main'] != true).length >= maxExtraStops) {
      tostmsg("Maximum $maxExtraStops extra stops allowed".tr);
      return;
    }
    dropLocationCount++;
    Map<String, dynamic> newDropLocation = {
      'id': 'drop_$dropLocationCount',
      'type': null,
      'address': "Choose drop address".tr,
      'hno': "",
      'landmark': "",
      'c_name': "",
      'c_number': "",
      'lat_map': null,
      'long_map': null,
      'is_main': false,
    };
    dropLocations.add(newDropLocation);
    setState(() {});

    // Show success message
    tostmsg("New stop location added. Tap to select address.".tr);
  }

  void selectDropLocation(String locationId) {
    // Store the current location ID for reference
    save("CurrentDropLocationId", locationId);

    // Show address selection options
    if (addressList.isNotEmpty) {
      bottomsheets(context, "AdditionalDrop").then((value) {
        setState(() {});
      });
    } else {
      getdata.remove("DropeAddress");
      Get.to(() => Traking(type: "Drop", addressAdd: "0"))!.then((value) {
        if (value != null && value != "back") {
          // Update the specific drop location
          int index = dropLocations.indexWhere((loc) => loc['id'] == locationId);
          if (index != -1) {
            setState(() {
              dropLocations[index]['type'] = getdata.read("DropeAddress")[0]["type"];
              dropLocations[index]['address'] = getdata.read("DropeAddress")[0]["address"];
              dropLocations[index]['hno'] = getdata.read("DropeAddress")[0]["hno"];
              dropLocations[index]['landmark'] = getdata.read("DropeAddress")[0]["landmark"];
              dropLocations[index]['c_name'] = getdata.read("DropeAddress")[0]["c_name"];
              dropLocations[index]['c_number'] = getdata.read("DropeAddress")[0]["c_number"];
              dropLocations[index]['lat_map'] = getdata.read("DropeAddress")[0]["lat_map"];
              dropLocations[index]['long_map'] = getdata.read("DropeAddress")[0]["long_map"];
            });

            // Show success message
            tostmsg("Stop location ${index + 1} updated successfully".tr);
          }
        }
      });
    }
  }

  // Remove drop location function
  void removeDropLocation(String locationId) {
    // Don't allow removing Drop Location 1
    if (locationId == 'drop_1') {
      return;
    }

    // Show confirmation dialog
    Get.dialog(
      AlertDialog(
        title: Text("Remove Stop Location".tr),
        content: Text("Are you sure you want to remove this stop location?".tr),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: Text("Cancel".tr),
          ),
          TextButton(
            onPressed: () {
              Get.back();
              setState(() {
                dropLocations.removeWhere((loc) => loc['id'] == locationId);
              });
            },
            child: Text("Remove".tr, style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

}

class DownwardTrianglePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Color(0xFF1E1E1E);

    final path = Path();
    path.moveTo(size.width / 2, size.height);   // Bottom center
    path.lineTo(0, 0);                          // Top left
    path.lineTo(size.width, 0);                 // Top right
    path.close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
