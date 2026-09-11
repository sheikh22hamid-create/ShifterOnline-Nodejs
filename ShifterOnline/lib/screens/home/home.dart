// ignore_for_file: prefer_typing_uninitialized_variables, deprecated_member_use, avoid_print, unused_field

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/authscreen/signin.dart';
import 'package:goParcel/screens/home/buyanythingselect.dart';
import 'package:goParcel/screens/home/chatscreen.dart';
import 'package:goParcel/screens/home/custom_order_screen.dart';
import 'package:goParcel/screens/home/makewishlist.dart';
import 'package:goParcel/screens/home/my_custom_orders.dart';
import 'package:goParcel/screens/home/route_review.dart';
import 'package:goParcel/screens/home/select_vehicle.dart';
import 'package:goParcel/screens/home/trackingpoliyline.dart';
import 'package:goParcel/screens/home/traking.dart';
import 'package:goParcel/screens/home/trakingStore.dart';
import 'package:goParcel/screens/myorder/myorder.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/screens/notification/notification.dart';
import 'package:goParcel/screens/profile/AddressList.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:intl/intl.dart';
import 'package:lottie/lottie.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../AppDataBase/BuyAnything.dart';
import '../../main.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart' as sql;
import 'package:url_launcher/url_launcher.dart';
import 'package:http/http.dart' as http;

class ItemListDelet {
  static Future<Database> database() async {
    final dbPath = await sql.getDatabasesPath();
    return sql.openDatabase(path.join(dbPath, 'byanything.db'), version: 1);
  }
}

String homeAddress = "";

final getdata = GetStorage();
List pickupiteam = [];
var priceData;
var resultData;
String? currency;

bool isLoding = true;

class Home extends StatefulWidget {
  const Home({super.key});

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  final sql = Additemlist();
  TextEditingController searchController = TextEditingController();
  Timer? _searchDebounce;
  bool isHowUse = true;
  bool _pickupConfirmed = false;
  String? _confirmedPickupAddress;
  String? _confirmedDropAddress;
  Map<String, dynamic>? _confirmedPickupData;
  Map<String, dynamic>? _confirmedDropData;
  final List<Map<String, dynamic>> _extraStops = [];
  int _selectedBookingType = 1; // 1 = now, 3 = next day
  int _maxExtraStops = 2;
  bool _isLoadingVehicleAvailability = false;
  // Kept as a guarded compatibility block while older task-entry behavior is retired.
  final bool _showLegacyVehicleSection = false;
  String? _vehicleAvailabilityError;
  final Map<String, Map<String, dynamic>> _vehicleAvailabilityById = {};
  List<Map<String, dynamic>> _savedLocations = [];
  bool _isLoadingSavedLocations = true;
  bool _homeOrderStatusChecked = false;
  final Map<String, String?> _verifiedHomeOrderStatuses = {};

  @override
  void dispose() {
    _searchDebounce?.cancel();
    searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    if (_searchDebounce?.isActive ?? false) _searchDebounce!.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 400), () {
      pickDropList(search: query);
    });
    setState(() {});
  }

  Future<void> _choosePickupBeforeVehicle() async {
    // Pickup is current-location-first. Users can still change it explicitly.
    await _ensureCurrentPickup();
    await _startDropSelection();
  }

  Future<void> _ensureCurrentPickup() async {
    if (_confirmedPickupData != null) return;

    // Reuse the user's explicitly selected pickup before falling back to GPS.
    // Without this check Home could overwrite an edited pickup with the current
    // device location when the screen was rebuilt.
    final savedPickup = getdata.read("PickupAddress");
    if (savedPickup is List &&
        savedPickup.isNotEmpty &&
        savedPickup.first is Map) {
      final saved = Map<String, dynamic>.from(savedPickup.first as Map);
      final savedLat = double.tryParse(saved["lat_map"]?.toString() ?? "");
      final savedLng = double.tryParse(saved["long_map"]?.toString() ?? "");
      final savedAddress = saved["address"]?.toString().trim() ?? "";
      if (savedLat != null && savedLng != null && savedAddress.isNotEmpty) {
        _confirmedPickupData = saved;
        _confirmedPickupAddress = savedAddress;
        return;
      }
    }

    if (currentLat == null || currentLong == null) {
      await customGetCurrentData();
    }
    if (currentLat == null || currentLong == null) return;

    if (homeAddress.isEmpty) {
      homeAddress = await getAddressFromLatLng(currentLat!, currentLong!);
    }
    final user = getdata.read("UserLogin");
    final name = user is Map ? user["name"]?.toString() ?? "" : "";
    final number = user is Map ? user["mobile"]?.toString() ?? "" : "";
    _confirmedPickupData = {
      "address": homeAddress.isEmpty ? "Current location" : homeAddress,
      "lat_map": currentLat,
      "long_map": currentLong,
      "c_name": name,
      "c_number": number,
      "hno": "",
      "landmark": "",
      "type": "Current location",
    };
    await getdata.write("PickupAddress", [_confirmedPickupData]);
    _confirmedPickupAddress = _confirmedPickupData!["address"]?.toString();
  }

  Future<void> _startDropSelection() async {
    await Get.to(() => const Traking(type: "Drop", addressAdd: "0"));
    final dropAddress = getdata.read("DropeAddress");
    if (!mounted || dropAddress is! List || dropAddress.isEmpty) return;
    final drop = dropAddress.first;
    if (drop is! Map || _confirmedPickupData == null) return;

    final pickup = _confirmedPickupData!;
    setState(() {
      _pickupConfirmed = true;
      _confirmedDropAddress = drop["address"]?.toString();
      _confirmedDropData = Map<String, dynamic>.from(drop);
      _isLoadingVehicleAvailability = true;
      _vehicleAvailabilityError = null;
      _vehicleAvailabilityById.clear();
    });

    await _loadVehicleAvailability(pickup);
  }

  Future<void> _loadSavedLocations() async {
    final uid = getdata.read("Uid");
    if (uid == null || uid.toString().isEmpty) {
      if (mounted) setState(() => _isLoadingSavedLocations = false);
      return;
    }

    try {
      final response = await ApiWrapper.dataPost(Config.address, {"uid": uid});
      final rawLocations = response is Map ? response["AddressList"] : null;
      final locations = rawLocations is List
          ? rawLocations
              .whereType<Map>()
              .map((location) => Map<String, dynamic>.from(location))
              .toList()
          : <Map<String, dynamic>>[];

      if (!mounted) return;
      setState(() {
        _savedLocations = locations;
        _isLoadingSavedLocations = false;
      });
    } catch (error) {
      debugPrint("Saved locations failed: $error");
      if (mounted) setState(() => _isLoadingSavedLocations = false);
    }
  }

  Future<void> _selectSavedDropLocation(Map<String, dynamic> location) async {
    await _ensureCurrentPickup();
    if (_confirmedPickupData == null) return;

    final drop = Map<String, dynamic>.from(location);
    await getdata.write("DropeAddress", [drop]);
    if (!mounted) return;

    setState(() {
      _pickupConfirmed = true;
      _confirmedDropData = drop;
      _confirmedDropAddress = drop["address"]?.toString();
      _isLoadingVehicleAvailability = true;
      _vehicleAvailabilityError = null;
      _vehicleAvailabilityById.clear();
    });

    await _loadVehicleAvailability(_confirmedPickupData!);
  }

  Future<void> _addQuickLocation() async {
    await Get.to(() => const Traking(type: "Drop", addressAdd: "0"));
    await _loadSavedLocations();
  }

  String _quickLocationTitle(Map<String, dynamic> location) {
    final type = location["type"]?.toString() ?? "Other";
    return type.toLowerCase() == "office" ? "Work" : type;
  }

  String _quickLocationIcon(Map<String, dynamic> location) {
    switch (location["type"]?.toString().toLowerCase()) {
      case "home":
        return "assets/selecthome.png";
      case "office":
        return "assets/selectoffice.png";
      default:
        return "assets/selectothers.png";
    }
  }

  Widget _buildQuickLocations() {
    if (_isLoadingSavedLocations) {
      return Container(
        height: 82,
        margin: const EdgeInsets.only(bottom: 17),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(16),
        ),
      );
    }

    final locations = _savedLocations.take(3).toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 17),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Quick Locations",
                style: TextStyle(
                  color: notifier.text,
                  fontSize: 18,
                  fontFamily: "Gilroy_Bold",
                ),
              ),
              InkWell(
                onTap: () async {
                  await Get.to(() => const AddressListPage());
                  _loadSavedLocations();
                },
                child: Row(
                  children: [
                    Text(
                      "View all",
                      style: TextStyle(
                        color: greaycolor,
                        fontSize: 14,
                        fontFamily: "Gilroy_Medium",
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded,
                        color: greaycolor, size: 20),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          SizedBox(
            height: 82,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: locations.length + 1,
              separatorBuilder: (_, __) => const SizedBox(width: 9),
              itemBuilder: (context, index) {
                if (index == locations.length) {
                  return _quickLocationCard(
                    title: "Add New",
                    subtitle: "Save for later",
                    icon: const Icon(Icons.add_rounded,
                        color: Color(0xFF2563EB), size: 28),
                    background: const Color(0xFFEAF0FF),
                    onTap: _addQuickLocation,
                  );
                }

                final location = locations[index];
                return _quickLocationCard(
                  title: _quickLocationTitle(location),
                  subtitle: location["address"]?.toString() ?? "",
                  icon: Image.asset(_quickLocationIcon(location), height: 26),
                  background: const Color(0xFFFFEEEE),
                  onTap: () => _selectSavedDropLocation(location),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _quickLocationCard({
    required String title,
    required String subtitle,
    required Widget icon,
    required Color background,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Container(
        width: 154,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: notifier.bordecolor.withOpacity(.65)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(.035),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              height: 43,
              width: 43,
              decoration: BoxDecoration(
                color: background,
                shape: BoxShape.circle,
              ),
              child: Center(child: icon),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: notifier.text,
                      fontSize: 13,
                      fontFamily: "Gilroy_Bold",
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: greaycolor,
                      fontSize: 11,
                      fontFamily: "Gilroy_Medium",
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _changePickupLocation() async {
    getdata.remove("PickupAddress");
    getdata.remove("DropeAddress");
    _confirmedPickupData = null;
    _confirmedPickupAddress = null;
    await Get.to(() => const Traking(type: "Pickup", addressAdd: "0"));

    final pickupAddress = getdata.read("PickupAddress");
    if (!mounted || pickupAddress is! List || pickupAddress.isEmpty) return;

    final address = pickupAddress.first;
    if (address is! Map) return;

    setState(() {
      _confirmedPickupData = Map<String, dynamic>.from(address);
      _confirmedPickupAddress = address["address"]?.toString();
    });
    await _startDropSelection();
  }

  Future<void> _openVehicleSelection() async {
    final pickup = _confirmedPickupData;
    final drop = _confirmedDropData;
    if (pickup == null || drop == null) return;
    // Every category goes through, available or not — select_vehicle.dart
    // renders unavailable ones as disabled, greyed-out cards with their
    // reason_unavailable text instead of just hiding them, so the customer
    // can see a bike/car exists at all even when nobody's currently free to
    // take it.
    final options = <Map<String, dynamic>>[];
    for (final category in pickupiteam.whereType<Map>()) {
      final availability = _availabilityForCategory(category);
      options.add({
        "category": Map<String, dynamic>.from(category),
        "availability": availability,
      });
    }
    await Get.to(() => SelectVehicleScreen(
          pickup: pickup,
          drop: drop,
          stops: List<Map<String, dynamic>>.from(_extraStops),
          bookingType: _selectedBookingType,
          vehicles: options,
          availabilityError: _vehicleAvailabilityError,
    ));
  }

  Future<void> _addExtraStop() async {
    if (_extraStops.length >= _maxExtraStops) {
      ApiWrapper.showToastMessage('Maximum $_maxExtraStops extra stops allowed.');
      return;
    }
    final currentDrop = _confirmedDropData;
    await Get.to(() => const Traking(type: "Drop", addressAdd: "0"));
    final selected = getdata.read("DropeAddress");
    if (currentDrop != null) {
      await getdata.write("DropeAddress", [currentDrop]);
    }
    if (!mounted || selected is! List || selected.isEmpty || selected.first is! Map) return;
    final stop = Map<String, dynamic>.from(selected.first as Map);

    if (_isBeyondFinalDrop(stop)) {
      await _showStopBeyondDropDialog();
      return;
    }

    setState(() => _extraStops.add(stop));
  }

  Future<void> _editExtraStop(int index) async {
    if (index < 0 || index >= _extraStops.length) return;
    final currentDrop = _confirmedDropData;
    await getdata.remove('DropeAddress');
    await Get.to(() => const Traking(type: 'Drop', addressAdd: '0'));
    final selected = getdata.read('DropeAddress');
    if (currentDrop != null) {
      await getdata.write('DropeAddress', [currentDrop]);
    }
    if (!mounted || selected is! List || selected.isEmpty || selected.first is! Map) {
      return;
    }
    final stop = Map<String, dynamic>.from(selected.first as Map);
    if (_isBeyondFinalDrop(stop)) {
      await _showStopBeyondDropDialog();
      return;
    }
    setState(() => _extraStops[index] = stop);
  }

  bool _isBeyondFinalDrop(Map<String, dynamic> stop) {
    final pickup = _confirmedPickupData;
    final drop = _confirmedDropData;
    if (pickup == null || drop == null) return false;

    final pickupLat = double.tryParse(pickup['lat_map']?.toString() ?? '');
    final pickupLng = double.tryParse(pickup['long_map']?.toString() ?? '');
    final dropLat = double.tryParse(drop['lat_map']?.toString() ?? '');
    final dropLng = double.tryParse(drop['long_map']?.toString() ?? '');
    final stopLat = double.tryParse(stop['lat_map']?.toString() ?? '');
    final stopLng = double.tryParse(stop['long_map']?.toString() ?? '');

    if ([pickupLat, pickupLng, dropLat, dropLng, stopLat, stopLng]
        .any((value) => value == null)) {
      return false;
    }

    final pickupToDrop = _distanceInKm(
      pickupLat!,
      pickupLng!,
      dropLat!,
      dropLng!,
    );
    final pickupToStop = _distanceInKm(
      pickupLat,
      pickupLng,
      stopLat!,
      stopLng!,
    );

    // A small GPS/map tolerance prevents a stop very close to the drop from
    // being rejected because of coordinate rounding.
    return pickupToStop > pickupToDrop + 0.1;
  }

  double _distanceInKm(
    double latitude1,
    double longitude1,
    double latitude2,
    double longitude2,
  ) {
    const earthRadiusKm = 6371.0;
    final dLat = (latitude2 - latitude1) * math.pi / 180;
    final dLng = (longitude2 - longitude1) * math.pi / 180;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(latitude1 * math.pi / 180) *
            math.cos(latitude2 * math.pi / 180) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    return earthRadiusKm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  Future<void> _showStopBeyondDropDialog() async {
    await Get.dialog<void>(
      AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('Stop location not allowed'),
        content: const Text(
          'You cannot add a stop beyond the final drop location. Please choose a location before the final drop.',
        ),
        actions: [
          TextButton(
            onPressed: Get.back,
            child: const Text('Okay'),
          ),
        ],
      ),
      barrierDismissible: false,
    );
  }

  Future<void> _loadVehicleAvailability(Map<dynamic, dynamic> pickup) async {
    final latitude = double.tryParse(pickup["lat_map"]?.toString() ?? "");
    final longitude = double.tryParse(pickup["long_map"]?.toString() ?? "");
    if (latitude == null || longitude == null) {
      if (mounted) {
        setState(() {
          _isLoadingVehicleAvailability = false;
          _vehicleAvailabilityError =
              "Could not read this pickup location. Please choose it again.";
        });
      }
      return;
    }

    try {
      final response = await http
          .post(
            Uri.parse(Config.availableVehiclesUrl),
            headers: const {"Content-Type": "application/json"},
            body: jsonEncode({"pickup_lat": latitude, "pickup_lng": longitude}),
          )
          .timeout(const Duration(seconds: 15));
      final body = jsonDecode(response.body);
      final vehicles = body is Map ? body["vehicles"] : null;

      if (response.statusCode != 200 ||
          body is! Map ||
          body["success"] != true ||
          vehicles is! List) {
        throw const FormatException(
            "Availability service returned an invalid response");
      }

      final availability = <String, Map<String, dynamic>>{};
      for (final vehicle in vehicles.whereType<Map>()) {
        final id = vehicle["id"]?.toString();
        if (id != null && id.isNotEmpty) {
          availability[id] = Map<String, dynamic>.from(vehicle);
        }
      }

      debugPrint("Available vehicles response: ${jsonEncode(vehicles)}");

      if (!mounted) return;
      setState(() {
        _vehicleAvailabilityById
          ..clear()
          ..addAll(availability);
        _isLoadingVehicleAvailability = false;
        _vehicleAvailabilityError = body["serviceable"] == true
            ? null
            : "This pickup area is currently outside our service area.";
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isLoadingVehicleAvailability = false;
        _vehicleAvailabilityError =
            "Could not check nearby drivers. Please try again.";
      });
    }
  }

  Future<void> _editRouteLocation(String mode) async {
    final key = mode == "Pickup" ? "PickupAddress" : "DropeAddress";
    final saved = getdata.read(key);
    if (saved is! List || saved.isEmpty || saved.first is! Map) return;
    final address = Map<String, dynamic>.from(saved.first as Map);
    await Get.to(() => Traking(
          type: mode,
          type2: "Edit",
          addressAdd: "0",
          elat: address["lat_map"]?.toString(),
          elang: address["long_map"]?.toString(),
          housenumber: address["hno"]?.toString(),
          landmark: address["landmark"]?.toString(),
          cname: address["c_name"]?.toString(),
          cnumbere: address["c_number"]?.toString(),
          addresstype: address["type"]?.toString(),
        ));
    if (!mounted) return;
    final updated = getdata.read(key);
    if (updated is List && updated.isNotEmpty && updated.first is Map) {
      final updatedData = Map<String, dynamic>.from(updated.first as Map);
      // Keep the edited route and the task form on the same persisted address.
      await getdata.write(key, [updatedData]);
      setState(() {
        if (mode == "Pickup") {
          _confirmedPickupAddress = updatedData["address"]?.toString();
          _confirmedPickupData = updatedData;
        } else {
          _confirmedDropAddress = updatedData["address"]?.toString();
          _confirmedDropData = updatedData;
        }
      });
      if (mode == "Pickup") {
        await _loadVehicleAvailability(updatedData);
      }
    }
  }

  Future<void> _openReviewAndTask() async {
    final pickup = _confirmedPickupData;
    final drop = _confirmedDropData;
    if (pickup == null || drop == null) return;
    await Get.to(() => RouteReviewScreen(
          pickup: pickup,
          drop: drop,
          onConfirm: _openVehicleSelection,
        ));
  }

  void _replaceImageWithReview() {
    final pickup = _confirmedPickupData;
    final drop = _confirmedDropData;
    if (pickup == null || drop == null) return;
    Get.off(() => RouteReviewScreen(
          pickup: pickup,
          drop: drop,
          onConfirm: _openVehicleSelection,
        ));
  }

  Map<String, dynamic>? _availabilityForCategory(
      Map<dynamic, dynamic> category) {
    // The live API returns a model `id` plus the service category in
    // `cat_id`/`category_id`. Match the category IDs first; matching only the
    // model id can associate a category with the wrong vehicle response.
    final categoryId = category["id"]?.toString().trim() ?? "";
    if (categoryId.isNotEmpty) {
      for (final vehicle in _vehicleAvailabilityById.values) {
        final vehicleCategoryIds = [
          vehicle["category_id"],
          vehicle["cat_id"],
        ].map((value) => value?.toString().trim()).toSet();
        if (vehicleCategoryIds.contains(categoryId)) return vehicle;
      }

      // Some older responses expose only the model/package id.
      final exact = _vehicleAvailabilityById[categoryId];
      if (exact != null) return exact;
    }

    final categoryName = (category["cat_name"] ?? category["name"] ?? "")
        .toString()
        .trim()
        .toLowerCase();
    if (categoryName.isEmpty) return null;

    for (final vehicle in _vehicleAvailabilityById.values) {
      final type =
          (vehicle["vehicle_type"] ?? "").toString().trim().toLowerCase();
      final name = (vehicle["name"] ?? "").toString().trim().toLowerCase();
      if ((type.isNotEmpty &&
              (type == categoryName ||
          type.contains(categoryName) ||
          categoryName.contains(type))) ||
          (name.isNotEmpty &&
              (name == categoryName || name.contains(categoryName)))) {
        return vehicle;
      }
    }
    return null;
  }

  bool _isVehicleAvailable(Map<String, dynamic>? availability) {
    if (availability == null) return false;

    bool isTruthy(dynamic value) {
      if (value == true || value == 1) return true;
      final normalized = value?.toString().trim().toLowerCase();
      return normalized == 'true' || normalized == '1' || normalized == 'yes';
    }

    // Some API deployments wrap these flags under `availability`; accept both
    // shapes but never treat an explicit unavailable value as available.
    final nested = availability['availability'];
    final flags = nested is Map
        ? <String, dynamic>{...availability, ...Map<String, dynamic>.from(nested)}
        : availability;
    final available = isTruthy(flags['available']);
    final isAvailable = flags.containsKey('is_available')
        ? isTruthy(flags['is_available'])
        : true;
    final status = flags.containsKey('status') ? isTruthy(flags['status']) : true;
    final liveSupply = flags['live_supply']?.toString().trim().toLowerCase();
    final unavailableSupply =
        liveSupply == 'none' || liveSupply == 'offline' || liveSupply == 'unavailable';
    final reason = flags['reason_unavailable']?.toString().trim().toLowerCase();
    final hasUnavailableReason = reason != null &&
        reason.isNotEmpty &&
        reason != 'null' &&
        reason != 'none';

    return available && isAvailable && status && !unavailableSupply && !hasUnavailableReason;
  }

  bool get _hasAvailableVehicleCategory {
    for (var i = 0; i < pickupiteam.length; i++) {
      final availability = _availabilityForCategory(pickupiteam[i]);
      if (_isVehicleAvailable(availability)) return true;
    }
    return false;
  }

  Widget _buildNoVehicleState() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 22, 18, 18),
      decoration: BoxDecoration(
        color: notifier.lightBgColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: notifier.bordecolor.withOpacity(.7)),
      ),
      child: Column(
        children: [
          Container(
            height: 76,
            width: 76,
            decoration: BoxDecoration(
              color: notifier.darklinercolor.withOpacity(.10),
              shape: BoxShape.circle,
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(Icons.location_on_outlined,
                    size: 42, color: notifier.darklinercolor),
                Positioned(
                  right: 13,
                  bottom: 13,
                  child: Container(
                    height: 22,
                    width: 22,
                    decoration: BoxDecoration(
                      color: notifier.lightBgColor,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.close_rounded,
                        size: 18, color: Colors.red.shade400),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            "We are not there yet!",
            textAlign: TextAlign.center,
            style: TextStyle(
              color: notifier.text,
              fontSize: 21,
              fontFamily: 'Gilroy_Bold',
            ),
          ),
          const SizedBox(height: 7),
          Text(
            "We currently do not have a vehicle available at this pickup location. Try choosing a nearby location to continue.",
            textAlign: TextAlign.center,
            style: TextStyle(
              color: greaycolor,
              height: 1.35,
              fontSize: 13,
              fontFamily: 'Gilroy_Medium',
            ),
          ),
          const SizedBox(height: 17),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _choosePickupBeforeVehicle,
              icon: const Icon(Icons.edit_location_alt_rounded, size: 19),
              label: const Text("Change location"),
              style: ElevatedButton.styleFrom(
                backgroundColor: notifier.darklinercolor,
                foregroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPickupFirstPrompt() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: notifier.lightBgColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: notifier.bordecolor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "Set pickup and drop locations",
            style: TextStyle(
              color: notifier.text,
              fontSize: 16,
              fontFamily: 'Gilroy_Bold',
            ),
          ),
          const SizedBox(height: 6),
          Text(
            "Choose your route first to see vehicles available nearby.",
            style: TextStyle(
              color: greaycolor,
              fontSize: 13,
              fontFamily: 'Gilroy_Medium',
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _choosePickupBeforeVehicle,
              icon: const Icon(Icons.my_location),
              label: const Text("Choose pickup & drop"),
              style: ElevatedButton.styleFrom(
                backgroundColor: notifier.darklinercolor,
                foregroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteSelectionCard() {
    final pickupAddress =
        _confirmedPickupAddress ?? 'Detecting current location...';
    final dropAddress = _confirmedDropAddress ?? 'Select drop location';
    final drop = _confirmedDropAddress;
    final pickupType =
        _confirmedPickupData?["type"]?.toString().toLowerCase().trim() ?? '';
    final routeSubtitle = [
      'Pickup',
      for (var index = 0; index < _extraStops.length; index++)
        'Stop ${index + 1}',
      'Drop',
    ].join(' → ');
    final pickupIsCurrent = pickupType == 'current location' ||
        pickupType == 'current' ||
        (currentLat != null &&
            currentLong != null &&
            double.tryParse(
                    _confirmedPickupData?['lat_map']?.toString() ?? '') ==
                currentLat &&
            double.tryParse(
                    _confirmedPickupData?['long_map']?.toString() ?? '') ==
                currentLong);

    Widget connector() => Padding(
          padding: const EdgeInsets.only(left: 16),
          child: Container(
            width: 1.5,
            height: 15,
            color: const Color(0xffd9dee5),
          ),
        );

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 15),
      padding: const EdgeInsets.fromLTRB(18, 19, 14, 17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: const Color(0xff263238).withOpacity(.06),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Delivery Route',
                      style: TextStyle(
                        color: notifier.text,
                        fontSize: 20,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      routeSubtitle,
                      style: TextStyle(
                        color: greaycolor,
                        fontSize: 13,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xfffff0e9),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  _maxExtraStops - _extraStops.length == 0
                      ? 'No stops left'
                      : '${_maxExtraStops - _extraStops.length} ${_maxExtraStops - _extraStops.length == 1 ? 'stop' : 'stops'} left',
                  style: TextStyle(
                    color: Color(0xfff26522),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 19),
          _routeTimelineRow(
            icon: Icons.inventory_2_rounded,
            iconColor: const Color(0xff46a45a),
            title: 'Pickup',
            subtitle: pickupIsCurrent ? 'Current location' : 'Pickup location',
            address: pickupAddress,
            addressFontSize: 13,
            onTap: _changePickupLocation,
          ),
          connector(),
          for (var index = 0; index < _extraStops.length; index++) ...[
            _routeTimelineRow(
              icon: Icons.location_on_rounded,
              iconColor: index == 0
                  ? const Color(0xfff27b38)
                  : const Color(0xff3976d3),
              title: 'Stop ${index + 1}',
              subtitle: 'Additional stop',
              address: _extraStops[index]['address']?.toString() ??
                  'Selected location',
              onTap: () => _editExtraStop(index),
              onDelete: () => setState(() => _extraStops.removeAt(index)),
            ),
            connector(),
          ],
          _routeTimelineRow(
            icon: Icons.location_on_rounded,
            iconColor: const Color(0xffe55353),
            title: 'Drop',
            subtitle: drop == null ? 'Choose final destination' : 'Final drop-off',
            address: dropAddress,
            addressFontSize: 13,
            onTap: drop == null
                ? _startDropSelection
                : () => _editRouteLocation('Drop'),
          ),
          const SizedBox(height: 16),
          InkWell(
            onTap: _extraStops.length < _maxExtraStops ? _addExtraStop : null,
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: const Color(0xfffff0e9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.add_location_alt_outlined,
                      color: Color(0xfff26522),
                      size: 18,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          '+ Add another stop',
                          style: TextStyle(
                            color: Color(0xfff26522),
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'You can add up to 2 stops',
                          style: TextStyle(
                            color: greaycolor,
                            fontSize: 12,
                            fontFamily: 'Gilroy_Medium',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded,
                      color: Color(0xff8b949e), size: 22),
                ],
              ),
            ),
          ),
          if (drop != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    value: _selectedBookingType,
                    decoration: const InputDecoration(
                      labelText: 'Booking',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: const [
                      DropdownMenuItem(value: 1, child: Text('Now')),
                      DropdownMenuItem(value: 3, child: Text('Next Day')),
                    ],
                    onChanged: (value) => setState(
                        () => _selectedBookingType = value ?? 1),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _openVehicleSelection,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xffff6a2a),
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('View vehicles'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _routeTimelineRow({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required String address,
    double addressFontSize = 11,
    VoidCallback? onTap,
    VoidCallback? onDelete,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 33,
              height: 33,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: iconColor.withOpacity(.12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: iconColor, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: notifier.text,
                      fontSize: 14,
                      fontFamily: 'Gilroy_Bold',
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: greaycolor,
                      fontSize: 11,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    address,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: greaycolor.withOpacity(.78),
                      fontSize: addressFontSize,
                      fontFamily: 'Gilroy_Regular',
                    ),
                  ),
                ],
              ),
            ),
            if (onDelete != null)
              IconButton(
                onPressed: onDelete,
                tooltip: 'Remove stop',
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints.tightFor(width: 28, height: 28),
                splashRadius: 16,
                icon: const Icon(
                  Icons.delete_outline_rounded,
                  color: Color(0xffe55353),
                  size: 19,
                ),
              )
            else
              const Icon(Icons.chevron_right_rounded,
                  color: Color(0xff8b949e), size: 22),
          ],
        ),
      ),
    );
  }

  Map<String, dynamic>? _activeHomeOrder() {
    if (resultData is! Map || !_homeOrderStatusChecked) return null;

    for (final key in const ['OrderHistory', 'BuyOrderHistory']) {
      final value = resultData[key];
      if (value is! Map) continue;
      final id = value['id']?.toString().trim() ?? '';
      final status = _verifiedHomeOrderStatuses[key]?.toLowerCase().trim() ?? '';
      if (id.isEmpty || id == 'null') continue;
      final normalizedStatus = status.replaceAll(RegExp(r'[\s_-]'), '');
      if (status.isEmpty ||
          const {
            'delivered',
            'completed',
            'cancelled',
            'canceled',
            'cancel',
            'rejected',
            'failed',
          }.contains(normalizedStatus)) {
        continue;
      }
      return {
        ...Map<String, dynamic>.from(value),
        '_isBuyOrder': key == 'BuyOrderHistory',
      };
    }
    return null;
  }

  Future<void> _refreshVerifiedHomeOrderStatus() async {
    if (resultData is! Map) return;

    _verifiedHomeOrderStatuses.clear();
    for (final key in const ['OrderHistory', 'BuyOrderHistory']) {
      final summary = resultData[key];
      if (summary is! Map) continue;
      final orderId = summary['id']?.toString().trim() ?? '';
      if (orderId.isEmpty || orderId == 'null') continue;

      try {
        final response = key == 'BuyOrderHistory'
            ? await ApiWrapper.dataPost(Config.buyorderlist, {
                'uid': getdata.read('Uid') ?? '0',
                'order_id': orderId,
              })
            : await ApiWrapper.dataPostNode(Config.nodeOrderDetails, {
                'uid': int.tryParse(getdata.read('Uid')?.toString() ?? '') ?? 0,
                'order_id': int.tryParse(orderId) ?? 0,
              });
        if (response is! Map ||
            (response['ResponseCode'] != '200' &&
                response['ResponseCode'] != 200) ||
            (response['Result'] != 'true' && response['Result'] != true)) {
          continue;
        }

        final list = key == 'BuyOrderHistory'
            ? response['BuyOrderProductList']
            : response['OrderProductList'];
        if (list is! List || list.isEmpty || list.last is! Map) continue;

        final detail = Map<String, dynamic>.from(list.last as Map);
        final status = detail['Order_Status'] ??
            detail['order_status'] ??
            detail['status'];
        if (status == null || status.toString().trim().isEmpty) continue;

        _verifiedHomeOrderStatuses[key] = status.toString();
        resultData[key] = {
          ...Map<String, dynamic>.from(summary),
          'status': status.toString(),
          if (detail['flow_msg'] != null) 'flow_msg': detail['flow_msg'],
        };
      } catch (error) {
        debugPrint('Home order status verification failed for $orderId: $error');
      }
    }

    if (!mounted) return;
    setState(() => _homeOrderStatusChecked = true);
  }

  Widget _buildActiveOrderCard() {
    final order = _activeHomeOrder();
    if (order == null) return const SizedBox.shrink();

    final isBuyOrder = order['_isBuyOrder'] == true;
    final status = order['status']?.toString() ?? 'In progress';
    final message = order['flow_msg']?.toString().trim() ?? '';
    final orderId = order['id']?.toString() ?? '';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xffff6a2a).withOpacity(.22)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            height: 40,
            width: 40,
            decoration: BoxDecoration(
              color: const Color(0xffff6a2a).withOpacity(.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.local_shipping_rounded,
                color: Color(0xffff6a2a), size: 22),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Order #$orderId',
                  style: TextStyle(
                      color: notifier.text,
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 15)),
              const SizedBox(height: 3),
              Text(status,
                  style: const TextStyle(
                      color: Color(0xffe65c20),
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 12)),
            ]),
          ),
          TextButton(
            onPressed: () {
              save('OrderID', orderId);
              Get.to(() => TrackingWay(
                    type: isBuyOrder ? 'Store' : 'Pickup',
                    isback: true,
                  ));
            },
            child: const Text('Track'),
          ),
        ]),
        if (message.isNotEmpty) ...[
          const SizedBox(height: 11),
          Text(message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: greaycolor,
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 13)),
        ],
      ]),
    );
  }

  Widget _locationRow(
      {required bool pickup,
      required String title,
      required String address,
      required String action,
      required VoidCallback onTap}) {
    final color = pickup ? Colors.green.shade600 : Colors.red.shade500;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 11, 8, 11),
        decoration: BoxDecoration(
            color: notifier.lightBgColor,
            borderRadius: BorderRadius.circular(15)),
        child: Row(children: [
          Container(
            height: 40,
            width: 40,
            decoration: BoxDecoration(
                color: color.withOpacity(.11), shape: BoxShape.circle),
            child: Icon(
                pickup ? Icons.my_location_rounded : Icons.location_on_rounded,
                color: color,
                size: 23),
          ),
          const SizedBox(width: 10),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: pickup ? Colors.green.shade700 : notifier.text,
                        fontSize: 13,
                        fontFamily: 'Gilroy_Bold')),
                const SizedBox(height: 3),
                Text(address,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: greaycolor,
                        fontSize: 12,
                        fontFamily: 'Gilroy_Medium')),
              ])),
          const SizedBox(width: 5),
          TextButton(
              onPressed: onTap,
              child: Text(action,
                  style: TextStyle(
                      color: pickup
                          ? Colors.green.shade700
                          : notifier.darklinercolor,
                      fontFamily: 'Gilroy_Bold'))),
        ]),
      ),
    );
  }

  Widget _buildConfirmedPickup() {
    Widget addressRow({required bool pickup, required String? address}) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        margin: EdgeInsets.only(bottom: pickup ? 8 : 0),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(pickup ? Icons.my_location : Icons.location_on,
                color: pickup ? Colors.green : Colors.red, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                  address ?? (pickup ? "Pickup location" : "Drop location"),
                  softWrap: true,
                  style: TextStyle(
                      color: notifier.text, fontFamily: 'Gilroy_Medium')),
            ),
            TextButton(
              onPressed: () => _editRouteLocation(pickup ? "Pickup" : "Drop"),
              style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 6)),
              child: const Text("Edit"),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: notifier.lightBgColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          addressRow(pickup: true, address: _confirmedPickupAddress),
          addressRow(pickup: false, address: _confirmedDropAddress),
        ],
      ),
    );
  }

  String _getFormattedOrderDate(dynamic orderDate) {
    try {
      if (orderDate == null) return "Date not available";
      return DateFormat("EEE, d MMM, yyyy")
          .format(DateTime.parse(orderDate.toString()));
    } catch (e) {
      return "Invalid date";
    }
  }

  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  void fetchAddress() async {
    homeAddress = await getAddressFromLatLng(currentLat ?? 0, currentLong ?? 0);
    debugPrint("======= Address ======== $homeAddress");
    if (mounted) {
      setState(() {
        // Your state change code goes here
      });
    }
  }

  @override
  void initState() {
    super.initState();
    setState(() {});
    pickDropList();
    sql.saveitemlist(
      id: DateTime.now().toString(),
      title: "",
      count: "1",
    );

    FirebaseAccesstoken accesstoken = FirebaseAccesstoken();
    accesstoken.getAccessToken();

    customGetCurrentData().then((value) {
      fetchAddress();
      _ensureCurrentPickup().then((_) {
        if (mounted) setState(() {});
      });
    });
    _loadSavedLocations();
    debugPrint("======= currentLat ======== $currentLat");
    debugPrint("======= currentLong ======= $currentLong");
  }

  sqlDBDelete() async {
    final db = await ItemListDelet.database();
    await db.rawQuery('DELETE FROM itemlist');
    sql.saveitemlist(id: DateTime.now().toString(), title: "", count: "1");
    sql.fetchitemlist();
    debugPrint("========== db ========= ${db.runtimeType}");
    setState(() {});
  }

  List homeIcon = [
    "assets/pickup&drop.json",
    "assets/buyanything.json",
    "assets/wishlist.json",
  ];

  List homeIconText = [
    "Pickup Or Drop".tr,
    "Buy Anything".tr,
    "Wishlist".tr,
  ];

  // Wheeler selection variables
  String selectedWheeler = "";
  List wheelerItems = [];
  List wheelerImages = [];

  String _getWelcomeText() {
    try {
      final userData = getdata.read("UserLogin");
      if (userData == null || userData is! Map || userData["name"] == null) {
        return "${"Welcome".tr}, 👋";
      }
      return "${"Welcome".tr}, ${userData["name"].toString()} 👋";
    } catch (e) {
      return "${"Welcome".tr}, 👋";
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);

    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        elevation: 0,
        toolbarHeight: 70,
        backgroundColor: linercolor,
        title: ListTile(
          contentPadding: EdgeInsets.only(bottom: 5),
          title: Text(
            _getWelcomeText(),
            style: TextStyle(
              color: whitecolor,
              fontSize: 20,
              fontFamily: 'Gilroy_Bold',
            ),
          ),
          // Space kam karne ke liye yeh changes
          subtitle: Padding(
            padding: EdgeInsets.zero, // ← top: 0 ki jagah zero use karo
            child: Row(
              children: [
                Image.asset(
                  "assets/location_drop.png",
                  color: whitecolor.withOpacity(0.8),
                  height: 18,
                ),
                SizedBox(width: 5),
                Expanded(
                  child: Text(
                    (homeAddress == null || homeAddress.isEmpty)
                        ? "Location".tr
                        : homeAddress,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: whitecolor.withOpacity(0.8),
                      fontSize: 13,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                ),
              ],
            ),
          ),
          trailing: InkWell(
            onTap: () {
              Get.to(Notifications());
            },
            child: Container(
              height: 50,
              width: 50,
              padding: EdgeInsets.all(10),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: whitecolor.withOpacity(0.2),
              ),
              child: Image.asset(
                "assets/Notification.png",
                color: whitecolor,
              ),
            ),
          ),
        ),
      ),
      body: Container(
        height: Get.height,
        width: Get.width,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(22),
            topRight: Radius.circular(22),
          ),
        ),
        child: isLoding
            ? Center(
                child:
                    CircularProgressIndicator(color: notifier.darklinercolor))
            : SingleChildScrollView(
                physics: BouncingScrollPhysics(),
                padding: EdgeInsets.all(15.0),
                child: Padding(
                  padding: EdgeInsets.only(
                      bottom: Get.height / 10 +
                          MediaQuery.of(context).padding.bottom +
                          20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (!isHowUse)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 15.0),
                          child: InkWell(
                            onTap: () async {
                              final Uri url = Uri.parse(
                                  "https://www.youtube.com/shorts/h7KMfS0IrI8");
                              if (!await launchUrl(url,
                                  mode: LaunchMode.externalApplication)) {
                                debugPrint('Could not launch $url');
                              }
                            },
                            child: Container(
                              width: Get.width,
                              padding: EdgeInsets.symmetric(
                                  vertical: 12, horizontal: 15),
                              decoration: BoxDecoration(
                                color: Color(0xFFFF0000), // YouTube red
                                borderRadius: BorderRadius.circular(15),
                                boxShadow: [
                                  BoxShadow(
                                    color: Color(0xFFFF0000).withOpacity(0.3),
                                    blurRadius: 10,
                                    offset: Offset(0, 5),
                                  ),
                                ],
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.play_circle_fill,
                                      color: Colors.white, size: 28),
                                  SizedBox(width: 10),
                                  Text(
                                    "How To Use".tr,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontFamily: 'Gilroy_Bold',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),

                      const SizedBox(height: 4),
                      _buildActiveOrderCard(),
                      _buildRouteSelectionCard(),
                      _buildQuickLocations(),
                      const SizedBox(height: 4),
                      // Wheeler Selection Section (shown after route selection)
                      if (_showLegacyVehicleSection && _pickupConfirmed)
                        Container(
                          width: Get.width,
                          decoration: BoxDecoration(
                            color: notifier.getBgColor,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          padding: EdgeInsets.all(15),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "What Are You Shipping?".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 18,
                                ),
                              ),
                              SizedBox(height: 12),
                              // Search Bar
                              /* Container(
                              decoration: BoxDecoration(
                                color: notifier.lightBgColor,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: notifier.bordecolor,
                                ),
                              ),
                              child: TextField(
                                controller: searchController,
                                cursorColor: notifier.darklinercolor,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Medium',
                                ),
                                decoration: InputDecoration(
                                  hintText: "Search".tr,
                                  hintStyle: TextStyle(
                                    color: greaycolor,
                                    fontSize: 14,
                                    fontFamily: "Gilroy_Regular",
                                  ),
                                  prefixIcon: Icon(
                                    Icons.search,
                                    color: greaycolor,
                                    size: 20,
                                  ),
                                  suffixIcon: searchController.text.isNotEmpty
                                      ? IconButton(
                                          icon: Icon(Icons.clear, color: greaycolor, size: 18),
                                          onPressed: () {
                                            searchController.clear();
                                            _onSearchChanged("");
                                          },
                                        )
                                      : null,
                                  border: InputBorder.none,
                                  contentPadding: EdgeInsets.symmetric(horizontal: 15, vertical: 12),
                                ),
                                onChanged: _onSearchChanged,
                              ),
                            ),
                            SizedBox(height: 15),*/
                              !_pickupConfirmed
                                  ? const SizedBox.shrink()
                                  : _isLoadingVehicleAvailability
                                      ? Column(
                                          children: [
                                            const Padding(
                                              padding: EdgeInsets.symmetric(
                                                  vertical: 28),
                                              child:
                                                  CircularProgressIndicator(),
                                            ),
                                            Text(
                                              "Checking nearby vehicles…",
                                              style: TextStyle(
                                                color: greaycolor,
                                                fontFamily: 'Gilroy_Medium',
                                              ),
                                            ),
                                          ],
                                        )
                                      : (_vehicleAvailabilityError != null &&
                                              !_vehicleAvailabilityError!
                                                  .toLowerCase()
                                                  .contains(
                                                      'outside our service area'))
                                          ? Column(
                                              children: [
                                                Text(
                                                  _vehicleAvailabilityError!,
                                                  textAlign: TextAlign.center,
                                                  style: TextStyle(
                                                    color: greaycolor,
                                                    fontFamily: 'Gilroy_Medium',
                                                  ),
                                                ),
                                                const SizedBox(height: 10),
                                                TextButton.icon(
                                                  onPressed:
                                                      _choosePickupBeforeVehicle,
                                                  icon:
                                                      const Icon(Icons.refresh),
                                                  label:
                                                      const Text("Try again"),
                                                ),
                                              ],
                                            )
                                          : (!_hasAvailableVehicleCategory &&
                                                  wheelerItems.isNotEmpty)
                                              ? _buildNoVehicleState()
                                              : wheelerItems.isEmpty
                                                  ? Padding(
                                                      padding: const EdgeInsets
                                                          .symmetric(
                                                          vertical: 20),
                                                      child: Center(
                                                        child: Text(
                                                          "No item found".tr,
                                                          style: TextStyle(
                                                            color: greaycolor,
                                                            fontFamily:
                                                                'Gilroy_Medium',
                                                            fontSize: 14,
                                                          ),
                                                        ),
                                                      ),
                                                    )
                                                  : Column(
                                                      children: [
                                                        GridView.builder(
                                                          shrinkWrap: true,
                                                          physics:
                                                              NeverScrollableScrollPhysics(),
                                                          padding:
                                                              EdgeInsets.all(2),
                                                          gridDelegate:
                                                              SliverGridDelegateWithFixedCrossAxisCount(
                                                            crossAxisCount:
                                                                2, // 2 items per row
                                                            crossAxisSpacing:
                                                                6, // Slightly reduced horizontal space
                                                            mainAxisSpacing:
                                                                6, // Slightly reduced vertical space
                                                            childAspectRatio:
                                                                1.0, // Changed to 1.0 for more square boxes (better for images)
                                                          ),
                                                          itemCount:
                                                              wheelerItems
                                                                  .length,
                                                          itemBuilder:
                                                              (context, i) {
                                                            final availability =
                                                                _availabilityForCategory(
                                                                    pickupiteam[
                                                                        i]);
                                                            final isAvailable =
                                                                _isVehicleAvailable(
                                                                    availability);
                                                            final liveSupply =
                                                                availability?[
                                                                            "live_supply"]
                                                                        ?.toString() ??
                                                                    "none";
                                                            final eta =
                                                                availability?[
                                                                    "estimated_pickup_minutes"];
                                                            final availabilityLabel =
                                                                isAvailable
                                                                    ? liveSupply ==
                                                                            "limited"
                                                                        ? "Limited drivers${eta == null ? "" : " (~$eta min)"}"
                                                                        : "Pickup in ~${eta ?? "--"} min"
                                                                    : "No drivers nearby";
                                                            return InkWell(
                                                              onTap: isAvailable
                                                                  ? () {
                                                                      setState(
                                                                          () {
                                                                        selectedWheeler =
                                                                            wheelerItems[i];
                                                                      });
                                                                      // Save selected wheeler to storage
                                                                      save(
                                                                          "SelectedWheeler",
                                                                          selectedWheeler);
                                                                      // Save selected category ID
                                                                      save(
                                                                          "SelectedCatId",
                                                                          pickupiteam[i]
                                                                              [
                                                                              "id"]);

                                                                      // Extract min_charge and pickup_charges from SelectedWheeler
                                                                      if (pickupiteam
                                                                              .isNotEmpty &&
                                                                          i < pickupiteam.length) {
                                                                        var selectedWheelerData =
                                                                            pickupiteam[i];
                                                                        var minCharge =
                                                                            selectedWheelerData["min_charge"] ??
                                                                                "0";
                                                                        var pickupCharges =
                                                                            selectedWheelerData["pickup_charges"] ??
                                                                                "0";
                                                                        /*var loadingCharge = selectedWheelerData["loading_charge"] ?? "0";
                                      var unloadingCharge = selectedWheelerData["unloading_charge"] ?? "0";
                                      var serviceCharge = selectedWheelerData["service_charge"] ?? "0";*/

                                                                        // Save min_charge and pickup_charges to storage
                                                                        save(
                                                                            "min_charge",
                                                                            minCharge);
                                                                        save(
                                                                            "pickup_charges",
                                                                            pickupCharges);
                                                                        /* save("loading_charge", loadingCharge);
                                      save("unloading_charge", unloadingCharge);
                                      save("service_charge", serviceCharge);*/

                                                                        debugPrint(
                                                                            "========= SelectedWheeler: $selectedWheeler =========");
                                                                        debugPrint(
                                                                            "========= min_charge: $minCharge =========");
                                                                        debugPrint(
                                                                            "========= pickup_charges: $pickupCharges =========");
                                                                      }

                                                                      // Legacy vehicle section is disabled; the active booking
                                                                      // entry point is the latest route/vehicle flow above.
                                                                      getdata.remove(
                                                                          "TaskDetails");

                                                                      String?
                                                                          otherImage =
                                                                          pickupiteam[i]
                                                                              [
                                                                              "other_image"];
                                                                      if (otherImage !=
                                                                              null &&
                                                                          otherImage
                                                                              .isNotEmpty) {
                                                                        Get.to(() =>
                                                                            Scaffold(
                                                                              backgroundColor: Colors.black,
                                                                              appBar: AppBar(
                                                                                backgroundColor: Colors.transparent,
                                                                                elevation: 0,
                                                                                iconTheme: IconThemeData(color: Colors.white),
                                                                                leading: IconButton(
                                                                                  icon: Icon(Icons.close),
                                                                                  onPressed: () => Get.back(),
                                                                                ),
                                                                              ),
                                                                              extendBodyBehindAppBar: true,
                                                                              body: Column(
                                                                                children: [
                                                                                  Expanded(
                                                                                    child: Center(
                                                                                      child: FadeInImage.assetNetwork(
                                                                                        fit: BoxFit.contain,
                                                                                        width: double.infinity,
                                                                                        imageErrorBuilder: (context, error, stackTrace) {
                                                                                          return Center(child: Icon(Icons.image_not_supported, color: Colors.white, size: 50));
                                                                                        },
                                                                                        image: "${Config.imageURLPath}$otherImage",
                                                                                        placeholder: "assets/ezgif.com-crop.gif",
                                                                                      ),
                                                                                    ),
                                                                                  ),
                                                                                  Padding(
                                                                                    padding: EdgeInsets.only(left: 20.0, right: 20.0, bottom: MediaQuery.of(context).padding.bottom + 20.0, top: 10.0),
                                                                                    child: SizedBox(
                                                                                      width: double.infinity,
                                                                                      height: 55,
                                                                                      child: ElevatedButton(
                                                                                        style: ElevatedButton.styleFrom(
                                                                                          backgroundColor: notifier.darklinercolor,
                                                                                          shape: RoundedRectangleBorder(
                                                                                            borderRadius: BorderRadius.circular(15),
                                                                                          ),
                                                                                        ),
                                                                                        onPressed: () {
                                                                                          _replaceImageWithReview();
                                                                                        },
                                                                                        child: Text(
                                                                                          "Done".tr,
                                                                                          style: TextStyle(
                                                                                            color: Colors.white,
                                                                                            fontSize: 18,
                                                                                            fontFamily: 'Gilroy_Bold',
                                                                                          ),
                                                                                        ),
                                                                                      ),
                                                                                    ),
                                                                                  ),
                                                                                ],
                                                                              ),
                                                                            ));
                                                                      } else {
                                                                        _openReviewAndTask();
                                                                      }
                                                                    }
                                                                  : null,
                                                              child: Container(
                                                                decoration:
                                                                    BoxDecoration(
                                                                  color: notifier
                                                                      .lightBgColor,
                                                                  borderRadius:
                                                                      BorderRadius
                                                                          .circular(
                                                                              12),
                                                                  border: Border
                                                                      .all(
                                                                    color: selectedWheeler ==
                                                                            wheelerItems[
                                                                                i]
                                                                        ? notifier
                                                                            .darklinercolor
                                                                        : Colors
                                                                            .transparent,
                                                                    width: 2,
                                                                  ),
                                                                ),
                                                                child: Column(
                                                                  mainAxisAlignment:
                                                                      MainAxisAlignment
                                                                          .spaceBetween, // Changed to space between
                                                                  children: [
                                                                    // Image taking most of the space (80% of container)
                                                                    Expanded(
                                                                      flex:
                                                                          3, // Increased flex to give more space to image (was 2)
                                                                      child:
                                                                          Container(
                                                                        padding:
                                                                            EdgeInsets.all(5), // Minimal padding
                                                                        child: FadeInImage
                                                                            .assetNetwork(
                                                                          width:
                                                                              double.infinity,
                                                                          height:
                                                                              double.infinity,
                                                                          fit: BoxFit
                                                                              .cover, // Shows full image
                                                                          imageErrorBuilder: (context,
                                                                              error,
                                                                              stackTrace) {
                                                                            return Center(
                                                                              child: Image.asset(
                                                                                "assets/ezgif.com-crop.gif",
                                                                                fit: BoxFit.contain,
                                                                                height: double.infinity,
                                                                                width: double.infinity,
                                                                              ),
                                                                            );
                                                                          },
                                                                          image:
                                                                              "${Config.imageURLPath}${wheelerImages[i]}",
                                                                          placeholder:
                                                                              "assets/ezgif.com-crop.gif",
                                                                        ),
                                                                      ),
                                                                    ),
                                                                    // Name below image - smaller section
                                                                    Container(
                                                                      height:
                                                                          62,
                                                                      padding: EdgeInsets.symmetric(
                                                                          horizontal:
                                                                              4.0,
                                                                          vertical:
                                                                              2),
                                                                      child:
                                                                          Column(
                                                                        mainAxisAlignment:
                                                                            MainAxisAlignment.center,
                                                                        children: [
                                                                          Text(
                                                                            "${wheelerItems[i]}",
                                                                            style:
                                                                                TextStyle(
                                                                              color: selectedWheeler == wheelerItems[i] ? notifier.darklinercolor : notifier.text,
                                                                              fontFamily: 'Gilroy_Bold',
                                                                              fontSize: 14,
                                                                              fontWeight: FontWeight.bold,
                                                                            ),
                                                                            textAlign:
                                                                                TextAlign.center,
                                                                            maxLines:
                                                                                1,
                                                                            overflow:
                                                                                TextOverflow.ellipsis,
                                                                          ),
                                                                          const SizedBox(
                                                                              height: 2),
                                                                          Text(
                                                                            availabilityLabel,
                                                                            style:
                                                                                TextStyle(
                                                                              color: isAvailable
                                                                                  ? liveSupply == "limited"
                                                                                      ? Colors.orange.shade800
                                                                                      : Colors.green.shade700
                                                                                  : greaycolor,
                                                                              fontFamily: 'Gilroy_Medium',
                                                                              fontSize: 10,
                                                                            ),
                                                                            textAlign:
                                                                                TextAlign.center,
                                                                            maxLines:
                                                                                1,
                                                                            overflow:
                                                                                TextOverflow.ellipsis,
                                                                          ),
                                                                        ],
                                                                      ),
                                                                    ),
                                                                  ],
                                                                ),
                                                              ),
                                                            );
                                                          },
                                                        )
                                                      ],
                                                    )
                            ],
                          ),
                        ),

                      SizedBox(height: 15),
                      // =================== CUSTOM ORDER BUTTON ===================
                      if (false)
                        GestureDetector(
                          onTap: () {
                            Get.to(() => const CustomOrderScreen());
                          },
                          child: Container(
                            width: double.infinity,
                            padding: EdgeInsets.symmetric(
                                horizontal: 18, vertical: 16),
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  Color(0xff7B2FF7),
                                  Color(0xffb34eff),
                                ],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(18),
                              boxShadow: [
                                BoxShadow(
                                  color: Color(0xff7B2FF7).withOpacity(0.35),
                                  blurRadius: 12,
                                  offset: Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Row(
                              children: [
                                Container(
                                  padding: EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Icon(
                                    Icons.tune_rounded,
                                    color: Colors.white,
                                    size: 24,
                                  ),
                                ),
                                SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        "Custom Order",
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 16,
                                        ),
                                      ),
                                      SizedBox(height: 2),
                                      Text(
                                        "Set your price · Drivers will bid",
                                        style: TextStyle(
                                          color: Colors.white.withOpacity(0.8),
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Icon(
                                  Icons.arrow_forward_ios_rounded,
                                  color: Colors.white.withOpacity(0.8),
                                  size: 16,
                                ),
                              ],
                            ),
                          ),
                        ),
                      // ============================================================

                      // -------- MY CUSTOM ORDERS ROW (shown if any exist) --------
                      Builder(builder: (context) {
                        List savedOrders = getdata.read("CustomOrders") ?? [];
                        if (savedOrders.isEmpty) return SizedBox.shrink();
                        return Column(
                          children: [
                            SizedBox(height: 10),
                            InkWell(
                              borderRadius: BorderRadius.circular(14),
                              onTap: () {
                                Get.to(() => const MyCustomOrders());
                              },
                              child: Container(
                                padding: EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 12),
                                decoration: BoxDecoration(
                                  color: notifier.getBgColor,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: Color(0xff7B2FF7).withOpacity(0.25),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Icon(Icons.gavel_rounded,
                                        color: Color(0xff7B2FF7), size: 20),
                                    SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        "My Custom Orders",
                                        style: TextStyle(
                                          color: notifier.text,
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                    Container(
                                      padding: EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color:
                                            Color(0xff7B2FF7).withOpacity(0.12),
                                        borderRadius: BorderRadius.circular(20),
                                      ),
                                      child: Text(
                                        "${savedOrders.length} order${savedOrders.length > 1 ? 's' : ''}",
                                        style: TextStyle(
                                          color: Color(0xff7B2FF7),
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 11,
                                        ),
                                      ),
                                    ),
                                    SizedBox(width: 6),
                                    Icon(Icons.arrow_forward_ios_rounded,
                                        color: Color(0xff7B2FF7), size: 14),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        );
                      }),
                      // -----------------------------------------------------------

                      /*resultData["OrderHistory"]["id"] == null
                          ? SizedBox()
                          : orderlistBox(
                              context,
                              image: "assets/package_box_file.svg",
                              title: "#${resultData["OrderHistory"]["id"]}",
                              discription: resultData["OrderHistory"]["flow_msg"],
                              pickupAddress: resultData["OrderHistory"]["pick_address"],
                              dropAddress: resultData["OrderHistory"]["drop_address"],
                              ordertype: resultData["OrderHistory"]["status"],
                              orderDate: DateFormat("EEE, d MMM, yyyy").format(DateTime.parse("${resultData["OrderHistory"]["order_date"]}")),
                              onTap: () {
                                save("OrderID", "${resultData["OrderHistory"]["id"]}");
                                Get.to(() => Tracklast());
                              },
                            ),*/

                      /*resultData["BuyOrderHistory"]["id"] == null
                          ? SizedBox()
                          : SizedBox(height: 15),
                      resultData["BuyOrderHistory"]["id"] == null
                          ? SizedBox()
                          : Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    "Buy anything Last Order".tr,
                                    style: TextStyle(
                                      overflow: TextOverflow.ellipsis,
                                      color: notifier.text,
                                      fontSize: 18,
                                      fontFamily: "Gilroy_Bold",
                                    ),
                                  ),
                                ),
                                SizedBox(width: 20),
                                InkWell(
                                  onTap: () {
                                    Get.offAll(Bottombar(tabIndex: 2));
                                  },
                                  child: Text(
                                    "View all".tr,
                                    style: TextStyle(
                                      color: greaycolor,
                                      fontSize: 15,
                                      fontFamily: "Gilroy_Medium",
                                    ),
                                  ),
                                ),
                              ],
                            ),*/

                      // YE PURA SECTION REPLACE KARO
                      if (resultData["BuyOrderHistory"] != null &&
                          resultData["BuyOrderHistory"]["id"] != null)
                        Column(
                          children: [
                            SizedBox(height: 15),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    "Buy anything Last Order".tr,
                                    style: TextStyle(
                                      overflow: TextOverflow.ellipsis,
                                      color: notifier.text,
                                      fontSize: 18,
                                      fontFamily: "Gilroy_Bold",
                                    ),
                                  ),
                                ),
                                SizedBox(width: 20),
                                InkWell(
                                  onTap: () {
                                    Get.offAll(Bottombar(tabIndex: 2));
                                  },
                                  child: Text(
                                    "View all".tr,
                                    style: TextStyle(
                                      color: greaycolor,
                                      fontSize: 15,
                                      fontFamily: "Gilroy_Medium",
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 15),
                            orderlistBox(
                              context,
                              image: "assets/fast_delivery_file.svg",
                              title: "#${resultData["BuyOrderHistory"]["id"]}",
                              discription: resultData["BuyOrderHistory"]
                                          ["flow_msg"]
                                      ?.toString() ??
                                  "No description available",
                              pickupAddress: resultData["BuyOrderHistory"]
                                          ["pick_address"]
                                      ?.toString() ??
                                  "No pickup address",
                              dropAddress: resultData["BuyOrderHistory"]
                                          ["drop_address"]
                                      ?.toString() ??
                                  "No drop address",
                              ordertype: resultData["BuyOrderHistory"]["status"]
                                      ?.toString() ??
                                  "Unknown",
                              orderDate: _getFormattedOrderDate(
                                  resultData["BuyOrderHistory"]["order_date"]),
                              onTap: () {
                                save("OrderID",
                                    "${resultData["BuyOrderHistory"]["id"]}");
                                Get.to(() => TrakingStore());
                              },
                            ),
                          ],
                        )
                      else
                        SizedBox(),

                      resultData["BuyOrderHistory"]["id"] == null
                          ? SizedBox()
                          : SizedBox(height: 15),
                      resultData["BuyOrderHistory"]["id"] == null
                          ? SizedBox()
                          : orderlistBox(
                              context,
                              image: "assets/fast_delivery_file.svg",
                              title: "#${resultData["BuyOrderHistory"]["id"]}",
                              discription: resultData["BuyOrderHistory"]
                                  ["flow_msg"],
                              pickupAddress: resultData["BuyOrderHistory"]
                                  ["pick_address"],
                              dropAddress: resultData["BuyOrderHistory"]
                                  ["drop_address"],
                              ordertype: resultData["BuyOrderHistory"]
                                  ["status"],
                              orderDate: DateFormat("EEE, d MMM, yyyy").format(
                                  DateTime.parse(
                                      "${resultData["BuyOrderHistory"]["order_date"]}")),
                              onTap: () {
                                save("OrderID",
                                    "${resultData["BuyOrderHistory"]["id"]}");
                                Get.to(() => TrakingStore());
                              },
                            ),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  pickDropList({String search = ""}) async {
    String deviceId = await getDeviceId();
    var data = {
      "uid": getdata.read("Uid") ?? "0",
      "search": search,
      "device_id": deviceId,
    };

    debugPrint("========= data -------- ${data}");

    ApiWrapper.dataPost(Config.homeData, data).then((val) async {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          // Check for DeviceMatch
          if (val["ResultData"] != null &&
              val["ResultData"]["DeviceMatch"] == false) {
            tostmsg("Session expired! Logged in from another device.".tr);
            SharedPreferences prefs = await SharedPreferences.getInstance();
            prefs.setBool("isDark", false);
            getdata.remove("Uid");
            save("firstLogin", false);
            getdata.remove("UserLogin");
            Get.offAll(() => SignIn(paymenttype: "onboarding"));
            return;
          }

          if (val["ResultData"] != null) {
            var howUseVal =
                val["ResultData"]["isHowUse"] ?? val["ResultData"]["isHowUse "];
            if (howUseVal != null) {
              isHowUse = howUseVal == true || howUseVal.toString() == "true";
            }
            // Save Referral Info
            save("referral_code",
                val["ResultData"]["referral_code"]?.toString() ?? "");
            save("referral_msg",
                val["ResultData"]["referral_msg"]?.toString() ?? "");
          }

          pickupiteam = (val["ResultData"] != null &&
                  val["ResultData"]["Package_Category"] != null)
              ? val["ResultData"]["Package_Category"]
              : [];

          // Populate wheeler selection data
          wheelerItems.clear();
          wheelerImages.clear();
          for (var i = 0; i < pickupiteam.length; i++) {
            wheelerItems.add(pickupiteam[i]["cat_name"]);
            wheelerImages.add(pickupiteam[i]["cat_img"]);
          }
          // No pre-selection - user needs to click to select

          debugPrint("========= val -------- ${val["ResultData"]}");
          priceData = val["ResultData"]?["PriceData"];
          currency = val["ResultData"]?["PriceData"]?["currency"];
          resultData = val["ResultData"];
          isLoding = false;
          setState(() {});
          _refreshVerifiedHomeOrderStatus();
        }
      }
    });
  }
}
