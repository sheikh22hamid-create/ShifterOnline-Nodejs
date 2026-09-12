import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import 'confirm_order_map.dart';
import 'waiting_screen.dart';

class SelectVehicleScreen extends StatefulWidget {
  final Map<String, dynamic> pickup;
  final Map<String, dynamic> drop;
  final List<Map<String, dynamic>> vehicles;
  final List<Map<String, dynamic>> stops;
  final int bookingType;
  final String? availabilityError;

  const SelectVehicleScreen({
    super.key,
    required this.pickup,
    required this.drop,
    required this.vehicles,
    this.stops = const [],
    this.bookingType = 1,
    this.availabilityError,
  });

  @override
  State<SelectVehicleScreen> createState() => _SelectVehicleScreenState();
}

class _SelectVehicleScreenState extends State<SelectVehicleScreen> {
  final GetStorage _storage = GetStorage();
  final PolylinePoints _polylinePoints = PolylinePoints();
  GoogleMapController? _mapController;
  List<LatLng> _route = [];
  double? _distanceKm;
  int? _durationMinutes;
  // Nothing is selected until the customer taps an available vehicle.
  // This keeps the vehicle-first flow explicit and prevents delivery models
  // from appearing before a vehicle has been chosen.
  int _selectedIndex = -1;
  int _selectedRadiusKm = 4;
  bool _loadingRoute = true;
  bool _loadingAvailability = false;
  bool _loadingModels = false;
  bool _booking = false;
  String? _availabilityError;
  String? _modelsError;
  List<Map<String, dynamic>> _vehicles = [];
  List<Map<String, dynamic>> _models = [];
  int? _selectedModelIndex;
  // Fare-estimate response fields that aren't per-package (used by the fare
  // breakdown sheet): the road distance the backend actually priced against,
  // and any active premium-plan discount applied to the quoted rates.
  double? _fareDistanceKm;
  bool _hasPlanDiscount = false;
  double _planDiscountPercent = 0;

  double _number(dynamic value) => double.tryParse(value?.toString() ?? '') ?? 0;
  LatLng get _pickup => LatLng(_number(widget.pickup['lat_map']), _number(widget.pickup['long_map']));
  LatLng get _drop => LatLng(_number(widget.drop['lat_map']), _number(widget.drop['long_map']));
  Map<String, dynamic>? get _selected =>
      _vehicles.isEmpty || _selectedIndex < 0 || _selectedIndex >= _vehicles.length
          ? null
          : _vehicles[_selectedIndex];
  Map<String, dynamic>? get _selectedModel => _selectedModelIndex == null || _selectedModelIndex! >= _models.length ? null : _models[_selectedModelIndex!];

  // available-vehicles API rows are actually per-package/model records (e.g.
  // "Model 1", "Model 2" under the "4 wheeler" category), each carrying that
  // package's own thumbnail in image/cat_img/img. The real vehicle-type icon
  // only ever arrives once, via widget.vehicles' category data (sourced from
  // the vehicle-category catalog on the home screen). Cache it per category
  // id here so later availability refreshes can't clobber it with a package
  // thumbnail.
  final Map<String, String> _catalogImageByCategoryId = {};

  @override
  void initState() {
    super.initState();
    _vehicles = widget.vehicles.map(Map<String, dynamic>.from).toList();
    _sortVehiclesByAvailability(_vehicles);
    _availabilityError = widget.availabilityError;
    for (final option in _vehicles) {
      final category = _categoryOf(option);
      final id = _text(category['id']);
      final image = _text(category['cat_img'] ?? category['image']);
      if (id.isNotEmpty && image.isNotEmpty) _catalogImageByCategoryId[id] = image;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadRoute();
      _refreshAvailability();
    });
  }

  String _text(dynamic value, [String fallback = '']) {
    final result = value?.toString().trim() ?? '';
    return result.isEmpty || result == 'null' ? fallback : result;
  }

  Map<String, dynamic> _categoryOf(Map<String, dynamic> option) {
    final category = option['category'];
    return category is Map ? Map<String, dynamic>.from(category) : {};
  }

  String _vehicleName(Map<String, dynamic> option) {
    final category = _categoryOf(option);
    final availability = option['availability'];
    // Category name (e.g. "Bike", "4 wheeler") is the real vehicle type.
    // Availability rows are per-package records ("Model 1"...), so their
    // name/title must only be used when no category name exists at all.
    return _text(category['cat_name'] ?? category['name'],
        _text(availability is Map ? (availability['name'] ?? availability['title'] ?? availability['vehicle_type']) : null, 'Delivery vehicle'));
  }

  String _image(Map<String, dynamic> option) {
    final category = _categoryOf(option);
    final availability = option['availability'];
    final categoryId = _text(category['id'] ?? (availability is Map ? (availability['category_id'] ?? availability['cat_id']) : null));
    final catalogImage = _catalogImageByCategoryId[categoryId] ?? '';
    if (catalogImage.isNotEmpty) return catalogImage;
    return _text(category['cat_img'] ?? category['image'],
        _text(availability is Map ? (availability['image'] ?? availability['cat_img'] ?? availability['img']) : null));
  }

  String _availabilityValue(Map<String, dynamic> option, List<String> keys, [String fallback = '']) {
    final availability = option['availability'];
    if (availability is Map) {
      for (final key in keys) {
        final value = _text(availability[key]);
        if (value.isNotEmpty) return value;
      }
    }
    return fallback;
  }

  String _unavailableReason(Map<String, dynamic> option) =>
      _availabilityValue(option, ['reason_unavailable'], 'No drivers nearby');

  String _startingFare(Map<String, dynamic> option) {
    final value = _availabilityValue(option, ['starting_fare', 'price', 'fare_min']);
    return value.isEmpty ? 'Fare at checkout' : 'From ₹${_number(value).round()}';
  }

  String _modelTitle(Map<String, dynamic> model) {
    final userTitle = _text(model['user_title']);
    if (userTitle.isNotEmpty) return userTitle;
    return _text(model['title'] ?? model['name'], 'Delivery option');
  }

  double? _modelFare(Map<String, dynamic> model) {
    for (final key in ['estimated_fare', 'fare', 'price', 'cost']) {
      final value = _number(model[key]);
      if (value > 0) return value;
    }
    return null;
  }

  Future<void> _loadRoute() async {
    final points = <LatLng>[];
    try {
      final waypoints = widget.stops
          .map((stop) => '${stop['lat_map']},${stop['long_map']}')
          .join('|');
      final response = await http.get(Uri.parse(
        'https://maps.googleapis.com/maps/api/directions/json?'
        'origin=${_pickup.latitude},${_pickup.longitude}&'
        'destination=${_drop.latitude},${_drop.longitude}&'
        '${waypoints.isEmpty ? '' : 'waypoints=${Uri.encodeComponent(waypoints)}&'}'
        'mode=driving&key=${Config.googleApikey}',
      )).timeout(const Duration(seconds: 12));
      final data = jsonDecode(response.body);
      final routes = data is Map ? data['routes'] : null;
      if (data is Map && data['status'] == 'OK' && routes is List && routes.isNotEmpty) {
        final legs = routes.first['legs'];
        if (legs is List) {
          var totalMeters = 0.0;
          var totalSeconds = 0.0;
          for (final leg in legs) {
            if (leg is! Map) continue;
            totalMeters += _number(leg['distance']?['value']);
            totalSeconds += _number(leg['duration']?['value']);
          }
          if (totalMeters > 0) _distanceKm = totalMeters / 1000;
          if (totalSeconds > 0) {
            _durationMinutes = (totalSeconds / 60).ceil();
          }
        }
        final encoded = routes.first['overview_polyline']?['points'];
        if (encoded is String && encoded.isNotEmpty) {
          points.addAll(_polylinePoints.decodePolyline(encoded).map((p) => LatLng(p.latitude, p.longitude)));
        }
      }
    } catch (_) {}
    _distanceKm ??= _fallbackDistanceKm();
    _durationMinutes ??= math.max(1, (_distanceKm! * 2).ceil());
    if (!mounted) return;
    setState(() { _route = points; _loadingRoute = false; });
    if (points.length > 1) _fitRoute(points);
  }

  double _fallbackDistanceKm() {
    const p = math.pi / 180;
    final locations = <LatLng>[
      _pickup,
      ...widget.stops.map((stop) => LatLng(
            _number(stop['lat_map']),
            _number(stop['long_map']),
          )),
      _drop,
    ];
    var total = 0.0;
    for (var index = 0; index < locations.length - 1; index++) {
      final from = locations[index];
      final to = locations[index + 1];
      final a = 0.5 - math.cos((to.latitude - from.latitude) * p) / 2 +
          math.cos(from.latitude * p) * math.cos(to.latitude * p) *
              (1 - math.cos((to.longitude - from.longitude) * p)) / 2;
      total += 12742 * math.asin(math.sqrt(a));
    }
    return math.max(1, total * 1.25);
  }

  void _fitRoute(List<LatLng> points) {
    if (_mapController == null) return;
    var minLat = points.first.latitude, maxLat = points.first.latitude;
    var minLng = points.first.longitude, maxLng = points.first.longitude;
    for (final point in points) {
      minLat = math.min(minLat, point.latitude); maxLat = math.max(maxLat, point.latitude);
      minLng = math.min(minLng, point.longitude); maxLng = math.max(maxLng, point.longitude);
    }
    _mapController!.animateCamera(CameraUpdate.newLatLngBounds(LatLngBounds(
      southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)), 55));
  }

  List<Map<String, dynamic>> _mapList(dynamic value) {
    if (value is! List) return <Map<String, dynamic>>[];
    return value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
  }

  String _responseCategoryId(Map<String, dynamic> item) => _text(
        item['category_id'] ?? item['cat_id'] ?? item['categoryId'] ?? item['id'],
      );

  String _responseCategoryName(Map<String, dynamic> item) => _text(
        item['cat_name'] ?? item['category_name'] ?? item['vehicle_type'] ?? item['name'] ?? item['title'],
      );

  List<Map<String, dynamic>> _buildVehicleOptions(
    List<Map<String, dynamic>> availabilityRows,
    Map<String, dynamic> payload,
  ) {
    final categories = <Map<String, dynamic>>[
      ..._mapList(payload['categories']),
      ..._mapList(payload['vehicle_categories']),
    ];
    final options = <Map<String, dynamic>>[];
    final seen = <String>{};

    if (categories.isNotEmpty) {
      for (final category in categories) {
        final categoryId = _responseCategoryId(category);
        final categoryName = _responseCategoryName(category).toLowerCase();
        // Prefer an available row if this category matches more than one
        // (e.g. one model in stock, another not) — but keep the first
        // matching row regardless, so a category with nobody currently free
        // still shows up (disabled, with its own reason_unavailable) instead
        // of disappearing entirely.
        Map<String, dynamic>? availableMatch;
        Map<String, dynamic>? anyMatch;
        for (final row in availabilityRows) {
          final rowId = _responseCategoryId(row);
          final rowName = _responseCategoryName(row).toLowerCase();
          if ((categoryId.isNotEmpty && rowId == categoryId) ||
              (categoryName.isNotEmpty && rowName.isNotEmpty &&
                  (rowName == categoryName || rowName.contains(categoryName) || categoryName.contains(rowName)))) {
            anyMatch ??= row;
            if (_isAvailable(row)) {
              availableMatch = row;
              break;
            }
          }
        }
        final match = availableMatch ?? anyMatch;
        if (match == null) continue;
        final key = categoryId.isNotEmpty ? categoryId : categoryName;
        if (key.isEmpty || !seen.add(key)) continue;
        options.add({'category': category, 'availability': match});
      }
      _sortVehiclesByAvailability(options);
      return options;
    }

    // Fallback for deployments that omit category records. Prefer vehicle_type
    // and category_name because name/title can be a package label like Model 1.
    // Unavailable rows are kept too — rendered as disabled cards.
    for (final vehicle in availabilityRows) {
      final categoryId = _responseCategoryId(vehicle);
      final categoryName = _text(
        vehicle['vehicle_type'] ?? vehicle['category_name'] ?? vehicle['category'] ?? vehicle['cat_name'],
        'Delivery vehicle',
      );
      final key = categoryId.isNotEmpty ? categoryId : categoryName.toLowerCase();
      if (!seen.add(key)) continue;
      options.add({
        'category': {
          'id': categoryId,
          'cat_name': categoryName,
          'cat_img': vehicle['cat_img'] ?? vehicle['category_image'],
        },
        'availability': vehicle,
      });
    }
    _sortVehiclesByAvailability(options);
    return options;
  }

  void _sortVehiclesByAvailability(List<Map<String, dynamic>> options) {
    options.sort((a, b) {
      final aAvailable = _isAvailable(a['availability']);
      final bAvailable = _isAvailable(b['availability']);
      if (aAvailable == bAvailable) return 0;
      return aAvailable ? -1 : 1;
    });
  }

  Future<void> _refreshAvailability() async {
    if (!mounted) return;
    final previousVehicleKey = _selected == null ? null : _vehicleKey(_selected!);
    final previousModelKey = _selectedModel == null ? null : _modelKey(_selectedModel!);
    setState(() { _loadingAvailability = true; _availabilityError = null; });
    try {
      final body = <String, dynamic>{
        'pickup_lat': _pickup.latitude,
        'pickup_lng': _pickup.longitude,
        'radius_km': _selectedRadiusKm,
        'booking_type': widget.bookingType == 3 ? 'next_day' : 'now',
      };
      final uid = _storage.read('Uid');
      if (uid != null) body['uid'] = int.tryParse(uid.toString()) ?? uid;
      final response = await http.post(Uri.parse(Config.availableVehiclesUrl),
          headers: const {'Content-Type': 'application/json'}, body: jsonEncode(body))
          .timeout(const Duration(seconds: 15));
      final decoded = jsonDecode(response.body);
      final payload = decoded is Map && decoded['data'] is Map
          ? Map<String, dynamic>.from(decoded['data'] as Map)
          : decoded is Map
              ? Map<String, dynamic>.from(decoded)
              : <String, dynamic>{};
      if (decoded is Map) {
        payload.putIfAbsent('categories', () => decoded['categories']);
        payload.putIfAbsent('vehicle_categories', () => decoded['vehicle_categories']);
      }
      final vehicles = payload['vehicles'] ??
          (decoded is Map ? decoded['vehicles'] : null);
      if (response.statusCode != 200 || decoded is! Map || decoded['success'] != true || vehicles is! List) {
        final message = decoded is Map ? _text(decoded['message'] ?? decoded['ResponseMsg']) : '';
        throw Exception(message.isEmpty ? 'Could not update vehicle availability.' : message);
      }
      final refreshed = _buildVehicleOptions(_mapList(vehicles), payload);
      if (!mounted) return;
      // Never retain a selection that's gone unavailable on refresh — unlike
      // before, unavailable options stay in the list (disabled, with their
      // own reason) instead of just disappearing, so indexWhere alone would
      // otherwise still "find" and keep the now-unavailable one selected.
      final retainedIndex = previousVehicleKey == null
          ? -1
          : refreshed.indexWhere((option) => _vehicleKey(option) == previousVehicleKey && _isAvailable(option['availability']));
      setState(() {
        _vehicles = refreshed;
        _availabilityError = decoded['serviceable'] == true || refreshed.isNotEmpty ? null : "We couldn't find an available vehicle near your pickup location right now.";
        _selectedIndex = retainedIndex >= 0 ? retainedIndex : -1;
        _selectedModelIndex = null;
      });
      if (_vehicles.isNotEmpty && retainedIndex >= 0) {
        await _loadModelsForSelectedVehicle(preserveModelKey: retainedIndex >= 0 ? previousModelKey : null);
      } else if (mounted) {
        setState(() { _models = []; _selectedModelIndex = null; _loadingAvailability = false; });
      }
      if (mounted && _selected == null) {
        setState(() => _models = []);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() { _loadingAvailability = false; _availabilityError = error.toString().replaceFirst('Exception: ', ''); });
      return;
    }
    if (mounted) setState(() => _loadingAvailability = false);
  }

  bool _isAvailable(dynamic value) {
    if (value is! Map) return false;
    final available = value['available'] ?? value['is_available'] ?? value['status'];
    if (available == null) return true;
    return available == true || available == 1 || ['true', '1', 'yes'].contains(available.toString().toLowerCase());
  }

  String _vehicleKey(Map<String, dynamic> option) {
    final category = _categoryOf(option);
    final availability = option['availability'];
    return _text(category['id'] ?? (availability is Map ? (availability['category_id'] ?? availability['cat_id']) : null),
        _vehicleName(option).toLowerCase());
  }

  String _modelKey(Map<String, dynamic> model) =>
      _text(model['package_id'] ?? model['id'], _modelTitle(model).toLowerCase());

  /// The UI intentionally keeps a single model selected, but dispatch accepts
  /// a cumulative tier list. Selecting Model 3 therefore sends Models 1, 2,
  /// and 3 while the screen continues to show only Model 3.
  int _modelOrder(Map<String, dynamic> model, int fallbackIndex) {
    final explicitOrder = int.tryParse(_text(model['sort_order'] ?? model['sortOrder']));
    if (explicitOrder != null) return explicitOrder;
    final match = RegExp(r'model\s*(\d+)', caseSensitive: false).firstMatch(_text(model['title'], _modelTitle(model)));
    return int.tryParse(match?.group(1) ?? '') ?? (fallbackIndex + 1);
  }

  List<int> _bookingDeliveryTypeIds(Map<String, dynamic> selectedModel) {
    final selectedIndex = _models.indexOf(selectedModel);
    final selectedOrder = _modelOrder(selectedModel, selectedIndex < 0 ? 0 : selectedIndex);
    final ids = <int>[];
    for (var index = 0; index < _models.length; index++) {
      final model = _models[index];
      if (_modelOrder(model, index) > selectedOrder) continue;
      final id = int.tryParse(_text(model['package_id'] ?? model['id'], '0')) ?? 0;
      if (id > 0 && !ids.contains(id)) ids.add(id);
    }
    // Keep the tapped model in the payload even if an unusual API response
    // omitted its sort metadata or returned models in a non-standard order.
    final selectedId = int.tryParse(_text(selectedModel['package_id'] ?? selectedModel['id'], '0')) ?? 0;
    if (selectedId > 0 && !ids.contains(selectedId)) ids.add(selectedId);
    return ids;
  }

  Future<void> _loadModelsForSelectedVehicle({String? preserveModelKey}) async {
    final selected = _selected;
    if (selected == null) return;
    final category = _categoryOf(selected);
    final availability = selected['availability'];
    final categoryId = category['id'] ?? (availability is Map ? (availability['category_id'] ?? availability['cat_id']) : null);
    if (categoryId == null) {
      setState(() { _models = []; _modelsError = 'Delivery options are unavailable for this vehicle.'; });
      return;
    }
    setState(() { _loadingModels = true; _modelsError = null; _models = []; _selectedModelIndex = null; });
    final uid = _storage.read('Uid');
    final response = await ApiWrapper.dataPostNode(Config.nodeFareEstimate, {
      'cat_id': int.tryParse(categoryId.toString()) ?? categoryId,
      'plat': _pickup.latitude, 'plong': _pickup.longitude,
      'dlat': _drop.latitude, 'dlong': _drop.longitude,
      'stops': widget.stops.map((stop) => {
        'lat': stop['lat_map'], 'lng': stop['long_map'], 'address': stop['address'],
        'hno': stop['hno'], 'landmark': stop['landmark'],
        'contact_name': stop['c_name'], 'contact_number': stop['c_number'],
      }).toList(),
      // Customer's chosen search radius — the estimate is a disclosed
      // "cost to search this far" preview and intentionally scales with it.
      // Actual billing at order-creation/dispatch/accept never uses this;
      // it reprices off whichever driver actually gets assigned.
      'radius_km': _selectedRadiusKm,
      if (uid != null) 'uid': int.tryParse(uid.toString()) ?? uid,
    });
    final rawModels = response is Map ? response['packages'] : null;
    if (!mounted) return;
    if (response is Map && (response['Result'] == true || response['Result'] == 'true') && rawModels is List) {
      final models = rawModels.whereType<Map>().map(Map<String, dynamic>.from).where((model) => _modelFare(model) != null).toList();
      final retainedModelIndex = preserveModelKey == null
          ? -1
          : models.indexWhere((model) => _modelKey(model) == preserveModelKey);
      setState(() {
        _models = models;
        _selectedModelIndex = retainedModelIndex >= 0 ? retainedModelIndex : (models.isEmpty ? null : 0);
        _loadingModels = false;
        _modelsError = models.isEmpty ? 'No delivery options are available for this vehicle.' : null;
        final distance = _number(response['distance_km']);
        _fareDistanceKm = distance > 0 ? distance : null;
        _hasPlanDiscount = response['has_plan_discount'] == true;
        _planDiscountPercent = _number(response['plan_discount_percent']);
      });
    } else {
      setState(() { _loadingModels = false; _modelsError = _text(response is Map ? response['ResponseMsg'] : null, 'Could not load delivery options.'); });
    }
  }

  Future<void> _openSearchAreaSheet() async {
    var pendingRadius = _selectedRadiusKm;
    await showModalBottomSheet<void>(
      context: context, isScrollControlled: true, backgroundColor: Colors.transparent,
      builder: (sheetContext) => StatefulBuilder(builder: (context, setSheetState) => Container(
        padding: EdgeInsets.fromLTRB(20, 12, 20, 20 + MediaQuery.of(context).padding.bottom),
        decoration: BoxDecoration(color: notifier.lightBgColor, borderRadius: const BorderRadius.vertical(top: Radius.circular(26))),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 42, height: 4, decoration: BoxDecoration(color: greaycolor.withOpacity(.35), borderRadius: BorderRadius.circular(8))),
          const SizedBox(height: 20),
          Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Driver search area', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 20)),
            const SizedBox(height: 6),
            Text('Find available drivers within the selected distance from your pickup location.', style: TextStyle(color: greaycolor, height: 1.35, fontFamily: 'Gilroy_Medium', fontSize: 13)),
          ])), IconButton(onPressed: () => Navigator.pop(sheetContext), icon: Icon(Icons.close_rounded, color: notifier.text))]),
          const SizedBox(height: 14),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('1 km', style: TextStyle(color: greaycolor, fontSize: 12)), Text('10 km', style: TextStyle(color: greaycolor, fontSize: 12))]),
          Slider(value: pendingRadius.toDouble(), min: 1, max: 10, divisions: 9, activeColor: linercolor, label: '$pendingRadius km', onChanged: (value) => setSheetState(() => pendingRadius = value.round())),
          Container(width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14), decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(14), border: Border.all(color: notifier.bordecolor)), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Current search area', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium')), Text('$pendingRadius km', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 16))])),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, height: 50, child: ElevatedButton(onPressed: () { Navigator.pop(sheetContext); if (pendingRadius != _selectedRadiusKm) { setState(() => _selectedRadiusKm = pendingRadius); _refreshAvailability(); } }, style: ElevatedButton.styleFrom(backgroundColor: linercolor, foregroundColor: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))), child: const Text('Apply', style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16)))),
        ]),
      )),
    );
  }

  Future<void> _bookSelected() async {
    final selected = _selected; final model = _selectedModel; final fee = model == null ? null : _modelFare(model);
    if (selected == null || model == null || fee == null || _booking) return;
    final walletBalance = await _fetchWalletBalance();
    if (!mounted) return;
    final category = _categoryOf(selected);
    await Get.to(() => ConfirmOrderMap(
      startLat: _pickup.latitude, startLng: _pickup.longitude, endLat: _drop.latitude, endLng: _drop.longitude,
      stops: widget.stops,
      deliveryFees: fee, walletBalance: walletBalance, currency: _text(model['currency'], '₹'),
      deliveryType: _text(model['package_id'] ?? model['id']),
      onConfirmPayment: (payValue, _) => _submitOrder(payValue, category, model, fee),
      onViewBreakup: () => _showFareBreakdown(model, fee),
    ));
  }

  Future<double> _fetchWalletBalance() async {
    final login = _storage.read('UserLogin');
    if (login is! Map) return 0;
    final response = await ApiWrapper.dataPost(Config.walletHistory, {'mobile': login['mobile'], 'wallet_type': 'user'});
    return _number(response is Map ? response['wallet_balance'] : 0);
  }

  Future<void> _submitOrder(int payValue, Map<String, dynamic> category, Map<String, dynamic> model, double fee) async {
    if (_booking) return;
    setState(() => _booking = true);
    final deliveryTypeIds = _bookingDeliveryTypeIds(model);
    if (deliveryTypeIds.isEmpty) {
      setState(() => _booking = false);
      ApiWrapper.showToastMessage('Selected delivery model is unavailable.');
      return;
    }
    final login = _storage.read('UserLogin');
    if (payValue == -2 && login is Map) {
      final balance = await _fetchWalletBalance();
      if (balance < fee) { setState(() => _booking = false); ApiWrapper.showToastMessage('Insufficient wallet balance.'); return; }
      final deducted = await ApiWrapper.dataPost(Config.withdrawWallet, {'mobile': login['mobile'], 'wallet_type': 'user', 'amount': fee.toStringAsFixed(2), 'remark': 'Delivery payment'});
      if (deducted is! Map || !(deducted['Result'] == true || deducted['Result'] == 'true')) { setState(() => _booking = false); ApiWrapper.showToastMessage('Wallet payment failed.'); return; }
    }
    final uid = _storage.read('Uid');
    final response = await ApiWrapper.dataPostNode(Config.nodeOrderCreate, {
      'uid': int.tryParse(uid?.toString() ?? '') ?? 0,
      'category': _text(category['cat_name'] ?? category['name'], _vehicleName(_selected!)),
      // The customer sees one selected model, while dispatch receives that
      // model plus every lower tier as fallback options.
      'delivery_type': deliveryTypeIds,
      'booking_type': widget.bookingType,
      'plat': _pickup.latitude, 'plong': _pickup.longitude, 'paddress': _text(widget.pickup['address'], 'Pickup location'),
      'pick_name': _text(widget.pickup['c_name'], 'Customer'), 'pmobile': _text(widget.pickup['c_number']), 'pick_type': _text(widget.pickup['type'], 'Other'),
      'dlat': _drop.latitude, 'dlong': _drop.longitude, 'daddress': _text(widget.drop['address'], 'Drop location'),
      'drop_name': _text(widget.drop['c_name'], 'Recipient'), 'dmobile': _text(widget.drop['c_number']), 'drop_type': _text(widget.drop['type'], 'Other'),
      'package_weight': '0', 'package_cost': '0', 'description': 'No description provided', 'p_method_id': payValue,
      'transaction_id': '${payValue == -2 ? 'wallet' : 'cash'}_${DateTime.now().millisecondsSinceEpoch}',
      'extra_mile_charge': 0, 'cou_id': 0, 'cou_amt': 0, 'radius_km': _selectedRadiusKm,
      'stops': widget.stops.map((stop) => {
        'lat': stop['lat_map'], 'lng': stop['long_map'], 'address': stop['address'],
        'hno': stop['hno'], 'landmark': stop['landmark'],
        'contact_name': stop['c_name'], 'contact_number': stop['c_number'],
      }).toList(),
    });
    if (!mounted) return;
    setState(() => _booking = false);
    if (response is Map && response['ResponseCode'].toString() == '200' && (response['Result'] == true || response['Result'] == 'true')) {
      await _storage.write('OrderID', response['order_id']);
      ApiWrapper.showToastMessage(_text(response['ResponseMsg'], 'Order placed successfully.'));
      if (widget.bookingType == 3) {
        Get.back();
      } else {
        Get.off(() => WaitingScreen(orderId: response['order_id'].toString()));
      }
    } else {
      ApiWrapper.showToastMessage(_text(response is Map ? response['ResponseMsg'] : null, 'Order could not be placed.'));
    }
  }

  // Base fare, distance charge, and radius charge come straight from
  // fare-estimate response fields (min_charge/per_km_charge/radius_charge).
  // Night charge isn't a separate field — it's whatever remains between
  // those three and the total, only surfaced when is_night is set, so
  // sub-rupee rounding noise on a non-night fare never shows as a charge.
  void _showFareBreakdown(Map<String, dynamic> model, double fee) {
    final baseFare = _number(model['min_charge']);
    final perKmCharge = _number(model['per_km_charge']);
    final distance = _fareDistanceKm ?? _distanceKm ?? 0;
    final distanceCharge = perKmCharge * distance;
    final radiusCharge = _number(model['radius_charge']);
    final isNight = model['is_night'] == 1 || model['is_night'] == true || model['is_night']?.toString() == '1';
    final nightCharge = isNight ? (fee - baseFare - distanceCharge - radiusCharge).clamp(0, fee) : 0.0;
    final originalMin = _number(model['original_min_charge']);
    final originalPerKm = _number(model['original_per_km_charge']);
    final discountSaved = _hasPlanDiscount ? (originalMin - baseFare) + (originalPerKm - perKmCharge) * distance : 0.0;

    Widget row(String label, String value, {bool bold = false, Color? color}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Expanded(child: Text(label, style: TextStyle(color: color ?? greaycolor, fontFamily: bold ? 'Gilroy_Bold' : 'Gilroy_Medium', fontSize: bold ? 14 : 13))),
            Text(value, style: TextStyle(color: color ?? notifier.text, fontFamily: 'Gilroy_Bold', fontSize: bold ? 15 : 13)),
          ]),
        );

    showModalBottomSheet<void>(context: context, backgroundColor: notifier.lightBgColor, isScrollControlled: true, useSafeArea: true, shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))), builder: (_) => SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(20, 18, 20, 28), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Fare breakdown', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 19)),
      const SizedBox(height: 2),
      Text(_modelTitle(model), style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
      const SizedBox(height: 14),
      row('Base fare', '₹${baseFare.toStringAsFixed(2)}'),
      row('Distance charge (${distance.toStringAsFixed(1)} km × ₹${perKmCharge.toStringAsFixed(2)}/km)', '₹${distanceCharge.toStringAsFixed(2)}'),
      if (radiusCharge > 0) row('Search radius charge ($_selectedRadiusKm km)', '₹${radiusCharge.toStringAsFixed(2)}'),
      if (nightCharge > 0) row('Night charge', '₹${nightCharge.toStringAsFixed(2)}'),
      if (_hasPlanDiscount && discountSaved > 0) row('Plan discount (${_planDiscountPercent.toStringAsFixed(0)}% off)', '-₹${discountSaved.toStringAsFixed(2)}', color: Colors.green),
      const Divider(height: 24),
      row('Estimated total', '₹${fee.toStringAsFixed(2)}', bold: true, color: linercolor),
    ]))));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppBar(
        backgroundColor: notifier.lightBgColor,
        foregroundColor: notifier.text,
        elevation: 0,
        leading: IconButton(
          onPressed: Get.back,
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Select vehicle', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 20)),
            Text('Choose the best option for your delivery', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
          ],
        ),
        actions: [IconButton(onPressed: () {}, icon: const Icon(Icons.help_outline_rounded))],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(15, 8, 15, 120),
                children: [
                  _routeSummary(),
                  const SizedBox(height: 18),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Available vehicles near pickup', style: TextStyle(color: notifier.text, fontSize: 17, fontFamily: 'Gilroy_Bold')),
                            const SizedBox(height: 4),
                            Text('Based on drivers within $_selectedRadiusKm km', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
                          ],
                        ),
                      ),
                      InkWell(
                        onTap: _openSearchAreaSheet,
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                          decoration: BoxDecoration(color: notifier.getBgColor, border: Border.all(color: linercolor), borderRadius: BorderRadius.circular(12)),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.my_location_rounded, color: linercolor, size: 15),
                              const SizedBox(width: 5),
                              Text('Search area: $_selectedRadiusKm km', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 11)),
                              const SizedBox(width: 2),
                              Icon(Icons.chevron_right_rounded, color: linercolor, size: 17),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (_loadingAvailability)
                    _loadingVehicles()
                  else if (_vehicles.isEmpty)
                    _emptyState()
                  else
                    SizedBox(
                      height: 142,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _vehicles.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 10),
                        itemBuilder: (_, index) => _vehicleCard(index, _vehicles[index]),
                      ),
                    ),
                  const SizedBox(height: 14),
                  if (_selected != null) _selectedVehicleSection(),
                ],
              ),
            ),
            if (_selected != null && _selectedModel != null) _bottomCta(),
          ],
        ),
      ),
    );
  }

  Widget _loadingVehicles() => Container(height: 142, alignment: Alignment.center, decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(16)), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: linercolor)), const SizedBox(width: 10), Text('Finding vehicles near pickup...', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 13))]));

  Widget _routeCard(List<LatLng> points) => Container(height: 300, clipBehavior: Clip.antiAlias, decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(22), boxShadow: [BoxShadow(color: Colors.black.withOpacity(.06), blurRadius: 18, offset: const Offset(0, 6))]), child: Column(children: [SizedBox(height: 210, child: Stack(children: [GoogleMap(initialCameraPosition: CameraPosition(target: LatLng((_pickup.latitude + _drop.latitude) / 2, (_pickup.longitude + _drop.longitude) / 2), zoom: 11), markers: {Marker(markerId: const MarkerId('pickup'), position: _pickup), Marker(markerId: const MarkerId('drop'), position: _drop)}, polylines: {Polyline(polylineId: const PolylineId('route'), points: points, color: linercolor, width: 5)}, zoomControlsEnabled: false, myLocationButtonEnabled: false, onMapCreated: (controller) { _mapController = controller; if (_route.length > 1) _fitRoute(_route); }), if (_loadingRoute) const Positioned(top: 12, right: 12, child: Card(child: Padding(padding: EdgeInsets.all(8), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))))), Positioned(left: 14, top: 14, child: _mapLabel(Icons.my_location_rounded, Colors.green, 'Pickup', widget.pickup['address'])), Positioned(right: 14, bottom: 14, child: _mapLabel(Icons.location_on_rounded, Colors.red, 'Drop', widget.drop['address']))])), Expanded(child: Row(children: [_metric(Icons.route_rounded, _distanceKm == null ? '...' : '${_distanceKm!.toStringAsFixed(1)} km', 'Distance'), _metric(Icons.schedule_rounded, _durationMinutes == null ? '...' : '~$_durationMinutes min', 'Est. time'), _metric(Icons.currency_rupee_rounded, _selectedModel == null ? '—' : '₹${_modelFare(_selectedModel!)!.round()}', 'Fare estimate')]))]));

  Widget _mapLabel(IconData icon, Color color, String title, dynamic value) => Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), decoration: BoxDecoration(color: Colors.white.withOpacity(.95), borderRadius: BorderRadius.circular(12)), child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, color: color, size: 18), const SizedBox(width: 6), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: TextStyle(color: color, fontSize: 10, fontFamily: 'Gilroy_Bold')), SizedBox(width: 105, child: Text(_text(value, 'Selected location'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.black87, fontSize: 11, fontFamily: 'Gilroy_Medium')))])]));
  Widget _metric(IconData icon, String value, String label) => Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, color: greaycolor, size: 20), const SizedBox(height: 2), Text(value, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 13)), Text(label, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 10))]));

  Widget _routeSummary() => Container(
        padding: const EdgeInsets.fromLTRB(15, 14, 15, 10),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(22),
          boxShadow: [BoxShadow(color: Colors.black.withOpacity(.06), blurRadius: 18, offset: const Offset(0, 6))],
        ),
        child: Column(
          children: [
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  _metric(Icons.route_rounded, _distanceKm == null ? '...' : '${_distanceKm!.toStringAsFixed(1)} km', 'Distance'),
                  _metric(Icons.schedule_rounded, _durationMinutes == null ? '...' : '~$_durationMinutes min', 'Est. time'),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _vehicleCard(int index, Map<String, dynamic> option) {
    final available = _isAvailable(option['availability']);
    final selected = available && index == _selectedIndex;
    final image = _image(option);
    return Opacity(
      opacity: available ? 1 : 0.45,
      child: InkWell(
        onTap: available
            ? () {
                setState(() { _selectedIndex = index; _selectedModelIndex = null; });
                _loadModelsForSelectedVehicle();
              }
            : null,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: 112,
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 7),
          decoration: BoxDecoration(
            color: selected ? linercolor.withOpacity(.06) : notifier.getBgColor,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: selected ? linercolor : notifier.bordecolor, width: selected ? 1.6 : 1),
          ),
          child: Column(children: [
            Expanded(
              child: image.isEmpty
                  ? Icon(Icons.local_shipping_outlined, color: greaycolor, size: 38)
                  : FadeInImage.assetNetwork(placeholder: 'assets/loading.gif', image: '${Config.imageURLPath}$image', fit: BoxFit.contain, imageErrorBuilder: (_, __, ___) => Icon(Icons.local_shipping_outlined, color: greaycolor, size: 38)),
            ),
            Row(children: [
              Expanded(child: Text(_vehicleName(option), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: notifier.text, fontSize: 12, fontFamily: 'Gilroy_Bold'))),
              if (selected) Icon(Icons.check_circle_rounded, color: linercolor, size: 17),
            ]),
            const SizedBox(height: 3),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                available ? _startingFare(option) : _unavailableReason(option),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: greaycolor, fontSize: 10, fontFamily: 'Gilroy_Medium'),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _selectedVehicleSection() {
    final selected = _selected!;
    final capacity = _availabilityValue(selected, ['max_weight_kg', 'capacity', 'max_weight']);
    final eta = _availabilityValue(selected, ['estimated_pickup_minutes', 'eta_minutes', 'eta']);
    final driverCount = _availabilityValue(selected, ['driver_count', 'nearby_driver_count']);
    return Container(padding: const EdgeInsets.fromLTRB(14, 15, 14, 12), decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(18), border: Border.all(color: notifier.bordecolor)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Expanded(child: Text(_vehicleName(selected), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 19))), if (_loadingModels) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))]),
      if (capacity.isNotEmpty) ...[const SizedBox(height: 4), Text('Up to $capacity kg', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12))],
      if (driverCount.isNotEmpty || eta.isNotEmpty) ...[const SizedBox(height: 8), Row(children: [if (driverCount.isNotEmpty) const Icon(Icons.people_alt_outlined, color: Colors.green, size: 16), if (driverCount.isNotEmpty) Text(' $driverCount nearby', style: TextStyle(color: greaycolor, fontSize: 11)), if (driverCount.isNotEmpty && eta.isNotEmpty) const SizedBox(width: 12), if (eta.isNotEmpty) Icon(Icons.schedule_rounded, color: greaycolor, size: 15), if (eta.isNotEmpty) Text(' ~$eta min', style: TextStyle(color: greaycolor, fontSize: 11))])],
      const SizedBox(height: 16), Text('Choose delivery option', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 16)), const SizedBox(height: 8),
      if (_loadingModels) const Padding(padding: EdgeInsets.symmetric(vertical: 18), child: Center(child: CircularProgressIndicator())),
      if (!_loadingModels && _modelsError != null) Text(_modelsError!, style: TextStyle(color: Colors.red.shade600, fontFamily: 'Gilroy_Medium', fontSize: 12)),
      if (!_loadingModels) ..._models.asMap().entries.map((entry) { final index = entry.key; final model = entry.value; final selectedModel = index == _selectedModelIndex; final fare = _modelFare(model)!; return InkWell(onTap: () => setState(() => _selectedModelIndex = index), child: Container(margin: const EdgeInsets.only(top: 7), padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11), decoration: BoxDecoration(color: selectedModel ? linercolor.withOpacity(.10) : Colors.transparent, borderRadius: BorderRadius.circular(12), border: Border.all(color: selectedModel ? linercolor : notifier.bordecolor)), child: Row(children: [Icon(selectedModel ? Icons.radio_button_checked : Icons.radio_button_off, color: selectedModel ? linercolor : greaycolor, size: 20), const SizedBox(width: 10), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(_modelTitle(model), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 14)), if (_text(model['description']).isNotEmpty) Text(_text(model['description']), style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11))])), Text('₹${fare.toStringAsFixed(0)}', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 14))]))); }),
      if (_selectedModel != null) ...[const SizedBox(height: 14), Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Estimated fare', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold')), Text('₹${_modelFare(_selectedModel!)!.toStringAsFixed(2)}', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 18))]), Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _showFareBreakdown(_selectedModel!, _modelFare(_selectedModel!)!), child: Text('View fare details', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 12))))],
    ]));
  }

  Widget _emptyState() => Container(padding: const EdgeInsets.fromLTRB(20, 28, 20, 22), decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(18)), child: Column(children: [Icon(Icons.local_shipping_outlined, color: linercolor, size: 48), const SizedBox(height: 12), Text('No vehicles available nearby', textAlign: TextAlign.center, style: TextStyle(color: notifier.text, fontSize: 18, fontFamily: 'Gilroy_Bold')), const SizedBox(height: 6), Text(_availabilityError ?? "We couldn't find an available vehicle near your pickup location right now.", textAlign: TextAlign.center, style: TextStyle(color: greaycolor, height: 1.35, fontFamily: 'Gilroy_Medium')), const SizedBox(height: 14), OutlinedButton.icon(onPressed: _refreshAvailability, icon: const Icon(Icons.refresh_rounded), label: const Text('Try again'))]));
  Widget _bottomCta() => Container(padding: EdgeInsets.fromLTRB(15, 12, 15, 12 + MediaQuery.of(context).padding.bottom), decoration: BoxDecoration(color: notifier.getBgColor, boxShadow: [BoxShadow(color: Colors.black.withOpacity(.10), blurRadius: 16, offset: const Offset(0, -5))]), child: Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('₹${_modelFare(_selectedModel!)!.toStringAsFixed(2)}', style: TextStyle(color: notifier.text, fontSize: 17, fontFamily: 'Gilroy_Bold')), Text('${_vehicleName(_selected!)} · ${_modelTitle(_selectedModel!)}', style: TextStyle(color: greaycolor, fontSize: 12, fontFamily: 'Gilroy_Medium'))])), SizedBox(width: 145, height: 50, child: ElevatedButton.icon(onPressed: _booking ? null : _bookSelected, icon: const Icon(Icons.arrow_forward_rounded, size: 19), iconAlignment: IconAlignment.end, label: Text(_booking ? 'Booking...' : 'Book now'), style: ElevatedButton.styleFrom(backgroundColor: linercolor, foregroundColor: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))))) ]));
}
