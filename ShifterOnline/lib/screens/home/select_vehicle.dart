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
import '../../bottombar.dart';
import '../../utils/colors.dart';
import 'add_stops_screen.dart';
import 'confirm_order_map.dart';
import 'vehicle_details_screen.dart';
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

  late Map<String, dynamic> _pickupData;
  late Map<String, dynamic> _dropData;
  late List<Map<String, dynamic>> _stopsData;
  late int _currentBookingType;

  int _selectedIndex = -1;
  int _selectedRadiusKm = 4;
  bool _loadingRoute = true;
  bool _loadingAvailability = false;
  bool _loadingModels = false;
  bool _booking = false;
  String? _availabilityError;
  int? _radiusSuggestionShownFor;
  String? _modelsError;
  List<Map<String, dynamic>> _vehicles = [];
  List<Map<String, dynamic>> _models = [];
  int? _selectedModelIndex;

  List<String> _vehicleDetailNotes = [];
  double? _fareDistanceKm;
  bool _hasPlanDiscount = false;
  double _planDiscountPercent = 0;
  double _planDiscountMaxCap = 0;

  double _number(dynamic value) => double.tryParse(value?.toString() ?? '') ?? 0;
  LatLng get _pickup => LatLng(_number(_pickupData['lat_map']), _number(_pickupData['long_map']));
  LatLng get _drop => LatLng(_number(_dropData['lat_map']), _number(_dropData['long_map']));

  Map<String, dynamic>? get _selected =>
      _vehicles.isEmpty || _selectedIndex < 0 || _selectedIndex >= _vehicles.length
          ? null
          : _vehicles[_selectedIndex];
  Map<String, dynamic>? get _selectedModel =>
      _selectedModelIndex == null || _selectedModelIndex! >= _models.length ? null : _models[_selectedModelIndex!];

  final Map<String, String> _catalogImageByCategoryId = {};

  @override
  void initState() {
    super.initState();
    final savedRadius = int.tryParse(_storage.read('default_search_radius')?.toString() ?? '');
    if (savedRadius != null && savedRadius > 0) {
      _selectedRadiusKm = savedRadius;
    }
    _currentBookingType = widget.bookingType;
    _pickupData = Map<String, dynamic>.from(widget.pickup);
    _dropData = Map<String, dynamic>.from(widget.drop);
    _stopsData = widget.stops.map((s) => Map<String, dynamic>.from(s)).toList();

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
      final waypoints = _stopsData
          .map((stop) => '${stop['lat_map']},${stop['long_map']}')
          .where((w) => w != '0.0,0.0' && w != ',')
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
      ..._stopsData.map((stop) => LatLng(
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
        'booking_type': _currentBookingType == 3 ? 'next_day' : 'now',
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
      int retainedIndex = -1;
      if (previousVehicleKey != null) {
        retainedIndex = refreshed.indexWhere((option) => _vehicleKey(option) == previousVehicleKey && _isAvailable(option['availability']));
        if (retainedIndex < 0) {
          retainedIndex = refreshed.indexWhere((option) => _vehicleKey(option) == previousVehicleKey);
        }
      }
      if (retainedIndex < 0 && _selectedIndex < 0 && refreshed.isNotEmpty) {
        // Only auto-select a vehicle that actually has drivers nearby - falling
        // back to index 0 when NONE are available pre-selected an unavailable
        // vehicle (e.g. "Bike - No drivers nearby") and still let the user see
        // "Choose delivery option" / "Book now" for it, as if it were bookable.
        retainedIndex = refreshed.indexWhere((option) => _isAvailable(option['availability']));
      }
      final rawSuggestion = decoded['radius_suggestion'];
      final radiusSuggestion = rawSuggestion is Map && rawSuggestion['shown'] == true
          ? Map<String, dynamic>.from(rawSuggestion)
          : null;
      final rawNotes = decoded['vehicle_detail_notes'];
      final notes = rawNotes is List ? rawNotes.map((n) => n.toString()).where((n) => n.trim().isNotEmpty).toList() : <String>[];
      setState(() {
        _vehicles = refreshed;
        _availabilityError = decoded['serviceable'] == true || refreshed.isNotEmpty ? null : "We couldn't find an available vehicle near your pickup location right now.";
        _selectedIndex = retainedIndex >= 0 ? retainedIndex : -1;
        _selectedModelIndex = null;
        _vehicleDetailNotes = notes;
      });
      if (radiusSuggestion != null && _radiusSuggestionShownFor != _selectedRadiusKm) {
        _radiusSuggestionShownFor = _selectedRadiusKm;
        _showRadiusSuggestionDialog(radiusSuggestion);
      }
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
      'stops': _stopsData.map((stop) => {
        'lat': stop['lat_map'], 'lng': stop['long_map'], 'address': stop['address'],
        'hno': stop['hno'], 'landmark': stop['landmark'],
        'contact_name': stop['c_name'], 'contact_number': stop['c_number'],
      }).toList(),
      'radius_km': _selectedRadiusKm,
      if (uid != null) 'uid': int.tryParse(uid.toString()) ?? uid,
    });
    final rawModels = response is Map ? response['packages'] : null;
    if (!mounted) return;
    if (response is Map && (response['Result'] == true || response['Result'] == 'true') && rawModels is List) {
      var models = rawModels.whereType<Map>().map(Map<String, dynamic>.from).where((model) => _modelFare(model) != null).toList();
      if (_currentBookingType == 3 && models.isNotEmpty) {
        models = [models.first];
      }
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
        _planDiscountMaxCap = _number(response['plan_discount_max_cap']);
      });
    } else {
      setState(() { _loadingModels = false; _modelsError = _text(response is Map ? response['ResponseMsg'] : null, 'Could not load delivery options.'); });
    }
  }

  Future<void> _showRadiusSuggestionDialog(Map<String, dynamic> suggestion) async {
    final suggestedRadius = int.tryParse(_text(suggestion['suggested_radius_km'])) ?? (_selectedRadiusKm + 1);
    final message = _text(suggestion['message'],
        'No drivers found within $_selectedRadiusKm km. Try increasing your search radius to $suggestedRadius km for a better chance of finding a driver.');
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('No drivers nearby'),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Not now')),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              setState(() => _selectedRadiusKm = suggestedRadius.clamp(1, 20));
              _refreshAvailability();
            },
            child: Text('Search within $suggestedRadius km'),
          ),
        ],
      ),
    );
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
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('1 km', style: TextStyle(color: greaycolor, fontSize: 12)), Text('20 km', style: TextStyle(color: greaycolor, fontSize: 12))]),
          Slider(value: pendingRadius.toDouble(), min: 1, max: 20, divisions: 19, activeColor: linercolor, label: '$pendingRadius km', onChanged: (value) => setSheetState(() => pendingRadius = value.round())),
          Container(width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14), decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(14), border: Border.all(color: notifier.bordecolor)), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Current search area', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium')), Text('$pendingRadius km', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 16))])),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, height: 50, child: ElevatedButton(onPressed: () { Navigator.pop(sheetContext); if (pendingRadius != _selectedRadiusKm) { setState(() => _selectedRadiusKm = pendingRadius); _refreshAvailability(); } }, style: ElevatedButton.styleFrom(backgroundColor: linercolor, foregroundColor: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))), child: const Text('Apply', style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16)))),
        ]),
      )),
    );
  }

  void _swapLocations() {
    setState(() {
      final temp = _pickupData;
      _pickupData = _dropData;
      _dropData = temp;
      _stopsData = _stopsData.reversed.toList();
    });
    _storage.write("PickupAddress", [_pickupData]);
    _storage.write("DropeAddress", [_dropData]);
    _loadRoute();
    _refreshAvailability();
    if (_selectedIndex >= 0) {
      _loadModelsForSelectedVehicle();
    }
  }

  Future<void> _toggleNextDayDelivery() async {
    final nextType = _currentBookingType == 3 ? 1 : 3;
    setState(() {
      _currentBookingType = nextType;
    });

    if (nextType == 3) {
      ApiWrapper.showToastMessage("Next Day Saver Delivery Selected 🚚");
    } else {
      ApiWrapper.showToastMessage("Standard Instant Delivery Selected ⚡");
    }

    await _refreshAvailability();
  }

  Future<void> _openAddStopsScreen() async {
    final result = await Get.to<Map<String, dynamic>>(
      () => AddStopsScreen(
        pickup: _pickupData,
        drop: _dropData,
        stops: _stopsData,
        bookingType: _currentBookingType,
      ),
    );

    if (result != null && mounted) {
      setState(() {
        _pickupData = Map<String, dynamic>.from(result['pickup']);
        _dropData = Map<String, dynamic>.from(result['drop']);
        _stopsData = List<Map<String, dynamic>>.from(result['stops'] ?? []);
      });
      _loadRoute();
      _refreshAvailability();
      if (_selectedIndex >= 0) {
        _loadModelsForSelectedVehicle();
      }
    }
  }

  Future<void> _bookSelected() async {
    final selected = _selected; final model = _selectedModel; final fee = model == null ? null : _modelFare(model);
    if (selected == null || model == null || fee == null || _booking) return;
    final walletBalance = await _fetchWalletBalance();
    if (!mounted) return;
    final category = _categoryOf(selected);
    await Get.to(() => ConfirmOrderMap(
      startLat: _pickup.latitude, startLng: _pickup.longitude, endLat: _drop.latitude, endLng: _drop.longitude,
      stops: _stopsData,
      deliveryFees: fee, walletBalance: walletBalance, currency: _text(model['currency'], '₹'),
      deliveryType: _text(model['package_id'] ?? model['id']),
      onConfirmPayment: (payValue, _) => _submitOrder(payValue, category, model, fee),
      onViewBreakup: () => _showFareBreakdown(model, fee),
    ));
  }

  Future<double> _fetchWalletBalance() async {
    final login = _storage.read('UserLogin');
    if (login is! Map) return 0;
    final response = await ApiWrapper.dataPostNode(Config.nodeWalletHistory, {'mobile': login['mobile'], 'wallet_type': 'user'});
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
      final deducted = await ApiWrapper.dataPostNode(Config.nodeWalletWithdraw, {'mobile': login['mobile'], 'wallet_type': 'user', 'amount': fee.toStringAsFixed(2), 'remark': 'Delivery payment'});
      if (deducted is! Map || !(deducted['Result'] == true || deducted['Result'] == 'true')) { setState(() => _booking = false); ApiWrapper.showToastMessage('Wallet payment failed.'); return; }
    }
    final uid = _storage.read('Uid');
    final response = await ApiWrapper.dataPostNode(Config.nodeOrderCreate, {
      'uid': int.tryParse(uid?.toString() ?? '') ?? 0,
      'category': _text(category['cat_name'] ?? category['name'], _vehicleName(_selected!)),
      'delivery_type': deliveryTypeIds,
      'booking_type': _currentBookingType,
      'plat': _pickup.latitude, 'plong': _pickup.longitude, 'paddress': _text(_pickupData['address'], 'Pickup location'),
      'pick_name': _text(_pickupData['c_name'], 'Customer'), 'pmobile': _text(_pickupData['c_number']), 'pick_type': _text(_pickupData['type'], 'Other'),
      'dlat': _drop.latitude, 'dlong': _drop.longitude, 'daddress': _text(_dropData['address'], 'Drop location'),
      'drop_name': _text(_dropData['c_name'], 'Recipient'), 'dmobile': _text(_dropData['c_number']), 'drop_type': _text(_dropData['type'], 'Other'),
      'package_weight': '0', 'package_cost': '0', 'description': 'No description provided', 'p_method_id': payValue,
      'transaction_id': '${payValue == -2 ? 'wallet' : 'cash'}_${DateTime.now().millisecondsSinceEpoch}',
      'extra_mile_charge': 0, 'cou_id': 0, 'cou_amt': 0, 'radius_km': _selectedRadiusKm,
      'stops': _stopsData.map((stop) => {
        'lat': stop['lat_map'], 'lng': stop['long_map'], 'address': stop['address'],
        'hno': stop['hno'], 'landmark': stop['landmark'],
        'contact_name': stop['c_name'], 'contact_number': stop['c_number'],
      }).toList(),
    });
    if (!mounted) return;
    setState(() => _booking = false);
    if (response is Map && response['ResponseCode'].toString() == '200' && (response['Result'] == true || response['Result'] == 'true')) {
      final orderId = response['order_id']?.toString() ?? '';
      await _storage.write('OrderID', orderId);
      ApiWrapper.showToastMessage(_text(response['ResponseMsg'], 'Order placed successfully.'));
      if (_currentBookingType == 3) {
        _showNextDayOrderSuccessDialog(orderId, fee, payValue);
      } else {
        Get.offAll(() => WaitingScreen(orderId: orderId));
      }
    } else {
      ApiWrapper.showToastMessage(_text(response is Map ? response['ResponseMsg'] : null, 'Order could not be placed.'));
    }
  }

  void _showNextDayOrderSuccessDialog(String orderId, double fee, int payValue) {
    Get.dialog(
      WillPopScope(
        onWillPop: () async => false,
        child: Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          elevation: 0,
          backgroundColor: Colors.transparent,
          child: Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.15),
                  blurRadius: 24,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 70,
                  height: 70,
                  decoration: BoxDecoration(
                    color: const Color(0xff10B981).withOpacity(0.12),
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Icon(
                      Icons.check_circle_rounded,
                      color: Color(0xff10B981),
                      size: 46,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  "Order Confirmed! 🎉",
                  style: TextStyle(
                    fontSize: 20,
                    fontFamily: 'Gilroy_Bold',
                    color: Color(0xff1E293B),
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: linercolor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: linercolor.withOpacity(0.3)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.local_shipping_rounded, color: linercolor, size: 14),
                      const SizedBox(width: 4),
                      Text(
                        "Next Day Delivery",
                        style: TextStyle(
                          color: linercolor,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  "Your order #$orderId has been scheduled for tomorrow. A driver will be assigned for pickup in the morning.",
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    fontFamily: 'Gilroy_Medium',
                    color: Color(0xff64748B),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                  decoration: BoxDecoration(
                    color: const Color(0xffF8FAFC),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xffE2E8F0)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        "Total Amount:",
                        style: TextStyle(
                          fontSize: 12.5,
                          fontFamily: 'Gilroy_Medium',
                          color: Color(0xff64748B),
                        ),
                      ),
                      Text(
                        "₹${fee.toStringAsFixed(2)} (${payValue == -2 ? 'Wallet' : 'Cash'})",
                        style: TextStyle(
                          fontSize: 14,
                          fontFamily: 'Gilroy_Bold',
                          color: linercolor,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: () {
                      Get.offAll(() => const Bottombar(tabIndex: 1));
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: linercolor,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: const Text(
                      "View My Orders",
                      style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 15,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  height: 40,
                  child: TextButton(
                    onPressed: () {
                      Get.offAll(() => const Bottombar(tabIndex: 0));
                    },
                    child: const Text(
                      "Back to Home",
                      style: TextStyle(
                        color: Color(0xff64748B),
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 14,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      barrierDismissible: false,
    );
  }

  void _showFareBreakdown(Map<String, dynamic> model, double fee) {
    // These components come straight from the backend's calculateFareBreakdown
    // (same formula/inputs that produced `fee` itself — see pricingEngine.js),
    // not re-derived here from min_charge/per_km_charge: for a slab-priced
    // vehicle those two fields aren't even inputs to the real fare, so
    // reconstructing "base fare" and "distance charge" from them summed to a
    // completely different number than the actual quoted total.
    final baseFare = _number(model['base_fare_charge']);
    final distanceCharge = _number(model['distance_charge_amount']);
    final radiusCharge = _number(model['radius_charge']);
    final nightCharge = _number(model['night_charge_amount']);
    final serviceCharge = _number(model['service_charge_amount']);
    final extraCharge = _number(model['extra_charge_amount']);
    final discountSaved = _number(model['discount_amount']);
    final distance = _fareDistanceKm ?? _distanceKm ?? 0;
    // NOT model['original_per_km_charge'] — that's a single flat rate off the
    // package row, but most vehicles are priced via distance SLABS with a
    // different ₹/km rate per band (0-1km, 1-5km, 5-10km, ...), so no single
    // per_km_charge field actually produced distanceCharge above (confirmed
    // live: a 311.2 km trip labelled "× ₹9.82/km" implying ₹3055, while the
    // real slab-blended distance charge shown next to it was ₹675 — totally
    // different numbers under the same row). Deriving the label's rate FROM
    // distanceCharge instead keeps the label internally consistent — its own
    // "km × rate" always multiplies back out to the amount shown beside it,
    // whether the real pricing was linear or slab-blended.
    final perKmCharge = distance > 0 ? distanceCharge / distance : 0.0;

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
      // Was silently missing — pkg.service_charge_percent is added into
      // estimated_fare by the backend (calculateFareBreakdown) whenever a
      // package has one set, but this sheet never had a row for it, so the
      // total included money none of the rows above it accounted for
      // (confirmed live: user 9770798272 — base ₹37 + distance ₹0.17 +
      // radius ₹28 − discount ₹4.60 = ₹60.57, but the real total was ₹64;
      // the missing ₹3.43 was exactly this package's service charge).
      if (serviceCharge > 0) row('Service charge', '₹${serviceCharge.toStringAsFixed(2)}'),
      if (extraCharge > 0) row('Extra charge', '₹${extraCharge.toStringAsFixed(2)}'),
      if (_hasPlanDiscount && discountSaved > 0)
        row(
          _planDiscountMaxCap > 0
              ? 'Plan discount (${_planDiscountPercent.toStringAsFixed(0)}% off, max ₹${_planDiscountMaxCap.toStringAsFixed(0)})'
              : 'Plan discount (${_planDiscountPercent.toStringAsFixed(0)}% off)',
          '-₹${discountSaved.toStringAsFixed(2)}',
          color: Colors.green,
        ),
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
                  _nextDayDeliveryBanner(),
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

  Widget _nextDayDeliveryBanner() {
    final isSelected = _currentBookingType == 3;
    final isDark = notifier.isDark;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _toggleNextDayDelivery,
          borderRadius: BorderRadius.circular(18),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: isSelected
                  ? LinearGradient(
                      colors: isDark
                          ? [const Color(0xff2A160D), const Color(0xff1A0D07)]
                          : [const Color(0xffFFF6F0), const Color(0xffFFEFE5)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    )
                  : null,
              color: isSelected ? null : notifier.getBgColor,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: isSelected
                    ? linercolor
                    : notifier.bordecolor.withOpacity(0.8),
                width: isSelected ? 1.6 : 1,
              ),
              boxShadow: [
                BoxShadow(
                  color: isSelected
                      ? linercolor.withOpacity(isDark ? 0.12 : 0.08)
                      : Colors.black.withOpacity(0.03),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? linercolor.withOpacity(0.18)
                            : greaycolor.withOpacity(0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.bolt_rounded,
                        color: isSelected ? linercolor : greaycolor,
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Next Day Saver Delivery 🚚',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: notifier.text,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 1.5),
                          Text(
                            isSelected
                                ? 'Selected · Tap to unselect for Instant'
                                : 'Save up to 30% · Scheduled tomorrow',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: isSelected ? linercolor : greaycolor,
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),

                    // Toggle Button Badge (Selected / Select)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(horizontal: 8.5, vertical: 4),
                      decoration: BoxDecoration(
                        gradient: isSelected
                            ? LinearGradient(
                                colors: [linercolor, const Color(0xffFF8533)],
                              )
                            : null,
                        color: isSelected ? null : notifier.lightBgColor,
                        borderRadius: BorderRadius.circular(16),
                        border: isSelected
                            ? null
                            : Border.all(color: linercolor.withOpacity(0.6)),
                        boxShadow: isSelected
                            ? [
                                BoxShadow(
                                  color: linercolor.withOpacity(0.35),
                                  blurRadius: 6,
                                  offset: const Offset(0, 2),
                                ),
                              ]
                            : null,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            isSelected ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
                            color: isSelected ? Colors.white : linercolor,
                            size: 13,
                          ),
                          const SizedBox(width: 3.5),
                          Text(
                            isSelected ? 'SELECTED' : 'SELECT',
                            style: TextStyle(
                              color: isSelected ? Colors.white : linercolor,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 10,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                if (isSelected) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7.5),
                    decoration: BoxDecoration(
                      color: isDark ? Colors.black.withOpacity(0.25) : Colors.white.withOpacity(0.75),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: notifier.bordecolor.withOpacity(0.4)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.schedule_rounded, color: linercolor, size: 14),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                'Delivery window: Tomorrow (10:00 AM – 8:00 PM)',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 11.5,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4.5),
                        Row(
                          children: [
                            const Icon(Icons.verified_rounded, color: Color(0xff10B981), size: 14),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                'Guaranteed Model 1 base pricing · Zero Advance',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: greaycolor,
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 11,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _loadingVehicles() => Container(height: 142, alignment: Alignment.center, decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(16)), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: linercolor)), const SizedBox(width: 10), Text('Finding vehicles near pickup...', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 13))]));

  Widget _routeSummary() {
    String contactLine(Map<String, dynamic> data, String fallback) {
      final name = (data['c_name'] ?? '').toString().trim();
      final mobile = (data['c_number'] ?? '').toString().trim();
      if (name.isNotEmpty && mobile.isNotEmpty) {
        return "$name · $mobile";
      } else if (name.isNotEmpty) {
        return name;
      } else if (mobile.isNotEmpty) {
        return mobile;
      }
      return fallback;
    }

    String addressLine(Map<String, dynamic> data) {
      final addr = (data['address'] ?? data['c_ddress'] ?? '').toString().trim();
      if (addr.isNotEmpty) return addr;
      final hno = (data['hno'] ?? '').toString().trim();
      return hno.isNotEmpty ? hno : "Selected Location";
    }

    return Container(
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // Left Column: Icons & Connector line
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Pickup Icon
                    Container(
                      width: 26,
                      height: 26,
                      decoration: const BoxDecoration(
                        color: Color(0xff10B981),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 15),
                    ),

                    // Dashed / solid vertical line
                    Container(
                      width: 1.5,
                      height: _stopsData.isEmpty ? 26 : 14,
                      margin: const EdgeInsets.symmetric(vertical: 2),
                      color: Colors.grey.shade300,
                    ),

                    // Intermediate Stops icons (if any)
                    for (int i = 0; i < _stopsData.length; i++) ...[
                      Container(
                        width: 22,
                        height: 22,
                        decoration: BoxDecoration(
                          color: linercolor,
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: Text(
                            "${i + 1}",
                            style: const TextStyle(
                              color: Colors.white,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ),
                      Container(
                        width: 1.5,
                        height: 14,
                        margin: const EdgeInsets.symmetric(vertical: 2),
                        color: Colors.grey.shade300,
                      ),
                    ],

                    // Drop Icon
                    Container(
                      width: 26,
                      height: 26,
                      decoration: const BoxDecoration(
                        color: Color(0xffEF4444),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.arrow_downward_rounded, color: Colors.white, size: 15),
                    ),
                  ],
                ),

                const SizedBox(width: 12),

                // Middle: Text Details (Pickup, Intermediate Stops, Drop)
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Pickup Text
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            contactLine(_pickupData, "Sender's Details"),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 13.5,
                              color: notifier.text,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            addressLine(_pickupData),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 12,
                              color: greaycolor,
                            ),
                          ),
                        ],
                      ),

                      // Intermediate Stops text
                      for (int i = 0; i < _stopsData.length; i++) ...[
                        const SizedBox(height: 10),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              contactLine(_stopsData[i], "Stop ${i + 1}"),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 13,
                                color: notifier.text,
                              ),
                            ),
                            const SizedBox(height: 1),
                            Text(
                              addressLine(_stopsData[i]),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 11.5,
                                color: greaycolor,
                              ),
                            ),
                          ],
                        ),
                      ],

                      const SizedBox(height: 10),

                      // Drop Text
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            contactLine(_dropData, "Receiver's Details"),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 13.5,
                              color: notifier.text,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            addressLine(_dropData),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 12,
                              color: greaycolor,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(width: 8),

                // Right Side: Swap Locations Button ⇅
                InkWell(
                  onTap: _swapLocations,
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: notifier.lightBgColor,
                      shape: BoxShape.circle,
                      border: Border.all(color: notifier.bordecolor.withOpacity(0.5)),
                    ),
                    child: Center(
                      child: Icon(
                        Icons.swap_vert_rounded,
                        color: notifier.text,
                        size: 20,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const Divider(height: 1, thickness: 0.8),

          // Bottom Action Row: Add Stop | Edit Locations
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                // 1. Add Stop Button
                Expanded(
                  child: InkWell(
                    onTap: _openAddStopsScreen,
                    borderRadius: const BorderRadius.only(bottomLeft: Radius.circular(18)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_circle, color: linercolor, size: 18),
                          const SizedBox(width: 6),
                          Text(
                            "Add Stop",
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 13.5,
                              color: linercolor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Vertical Divider
                Container(
                  width: 1,
                  height: 22,
                  color: notifier.bordecolor.withOpacity(0.6),
                ),

                // 2. Edit Locations Button
                Expanded(
                  child: InkWell(
                    onTap: _openAddStopsScreen,
                    borderRadius: const BorderRadius.only(bottomRight: Radius.circular(18)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.edit, color: linercolor, size: 16),
                          const SizedBox(width: 6),
                          Text(
                            "Edit Locations",
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 13.5,
                              color: linercolor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _vehicleCard(int index, Map<String, dynamic> option) {
    final available = _isAvailable(option['availability']);
    final selected = index == _selectedIndex;
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
                  : FadeInImage.assetNetwork(placeholder: 'assets/loading.gif', image: Config.resolveImageUrl(image), fit: BoxFit.contain, imageErrorBuilder: (_, __, ___) => Icon(Icons.local_shipping_outlined, color: greaycolor, size: 38)),
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
      Row(children: [
        Expanded(child: Text(_vehicleName(selected), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 19))),
        if (_loadingModels) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
        TextButton.icon(
          onPressed: () => Get.to(() => VehicleDetailsScreen(category: _categoryOf(selected), notes: _vehicleDetailNotes)),
          icon: Icon(Icons.info_outline_rounded, color: linercolor, size: 16),
          label: Text('Details', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 12)),
          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6), minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
        ),
      ]),
      if (capacity.isNotEmpty) ...[const SizedBox(height: 4), Text('Up to $capacity kg', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12))],
      if (driverCount.isNotEmpty || eta.isNotEmpty) ...[const SizedBox(height: 8), Row(children: [if (driverCount.isNotEmpty) const Icon(Icons.people_alt_outlined, color: Colors.green, size: 16), if (driverCount.isNotEmpty) Text(' $driverCount nearby', style: TextStyle(color: greaycolor, fontSize: 11)), if (driverCount.isNotEmpty && eta.isNotEmpty) const SizedBox(width: 12), if (eta.isNotEmpty) Icon(Icons.schedule_rounded, color: greaycolor, size: 15), if (eta.isNotEmpty) Text(' ~$eta min', style: TextStyle(color: greaycolor, fontSize: 11))])],
      const SizedBox(height: 16), Text(_currentBookingType == 3 ? 'Next day delivery package' : 'Choose delivery option', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 16)), const SizedBox(height: 8),
      if (_loadingModels) const Padding(padding: EdgeInsets.symmetric(vertical: 18), child: Center(child: CircularProgressIndicator())),
      if (!_loadingModels && _modelsError != null) Text(_modelsError!, style: TextStyle(color: Colors.red.shade600, fontFamily: 'Gilroy_Medium', fontSize: 12)),
      if (!_loadingModels) ..._models.asMap().entries.map((entry) { final index = entry.key; final model = entry.value; final selectedModel = index == _selectedModelIndex; final fare = _modelFare(model)!; return InkWell(onTap: () => setState(() => _selectedModelIndex = index), child: Container(margin: const EdgeInsets.only(top: 7), padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11), decoration: BoxDecoration(color: selectedModel ? linercolor.withOpacity(.10) : Colors.transparent, borderRadius: BorderRadius.circular(12), border: Border.all(color: selectedModel ? linercolor : notifier.bordecolor)), child: Row(children: [Icon(selectedModel ? Icons.radio_button_checked : Icons.radio_button_off, color: selectedModel ? linercolor : greaycolor, size: 20), const SizedBox(width: 10), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [Text(_modelTitle(model), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 14)), if (_currentBookingType == 3) ...[const SizedBox(width: 6), Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2), decoration: BoxDecoration(color: linercolor.withOpacity(0.15), borderRadius: BorderRadius.circular(5)), child: Text('Next Day Saver', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 10.5)))]]), if (_text(model['description']).isNotEmpty) Text(_text(model['description']), style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11))])), Text('₹${fare.toStringAsFixed(0)}', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 14))]))); }),
      if (_selectedModel != null) ...[const SizedBox(height: 14), Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Estimated fare', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold')), Text('₹${_modelFare(_selectedModel!)!.toStringAsFixed(2)}', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 18))]), Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _showFareBreakdown(_selectedModel!, _modelFare(_selectedModel!)!), child: Text('View fare details', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 12))))],
    ]));
  }

  Widget _emptyState() => Container(padding: const EdgeInsets.fromLTRB(20, 28, 20, 22), decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(18)), child: Column(children: [Icon(Icons.local_shipping_outlined, color: linercolor, size: 48), const SizedBox(height: 12), Text('No vehicles available nearby', textAlign: TextAlign.center, style: TextStyle(color: notifier.text, fontSize: 18, fontFamily: 'Gilroy_Bold')), const SizedBox(height: 6), Text(_availabilityError ?? "We couldn't find an available vehicle near your pickup location right now.", textAlign: TextAlign.center, style: TextStyle(color: greaycolor, height: 1.35, fontFamily: 'Gilroy_Medium')), const SizedBox(height: 14), OutlinedButton.icon(onPressed: _refreshAvailability, icon: const Icon(Icons.refresh_rounded), label: const Text('Try again'))]));
  Widget _bottomCta() => Container(padding: EdgeInsets.fromLTRB(15, 12, 15, 12 + MediaQuery.of(context).padding.bottom), decoration: BoxDecoration(color: notifier.getBgColor, boxShadow: [BoxShadow(color: Colors.black.withOpacity(.10), blurRadius: 16, offset: const Offset(0, -5))]), child: Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('₹${_modelFare(_selectedModel!)!.toStringAsFixed(2)}', style: TextStyle(color: notifier.text, fontSize: 17, fontFamily: 'Gilroy_Bold')), Text('${_vehicleName(_selected!)} · ${_modelTitle(_selectedModel!)}', style: TextStyle(color: greaycolor, fontSize: 12, fontFamily: 'Gilroy_Medium'))])), SizedBox(width: 160, height: 50, child: ElevatedButton.icon(onPressed: _booking ? null : _bookSelected, icon: const Icon(Icons.arrow_forward_rounded, size: 19), iconAlignment: IconAlignment.end, label: Text(_booking ? 'Booking...' : (_currentBookingType == 3 ? 'Book Next Day' : 'Book now')), style: ElevatedButton.styleFrom(backgroundColor: linercolor, foregroundColor: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))))) ]));
}
