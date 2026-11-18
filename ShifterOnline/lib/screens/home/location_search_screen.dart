// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:convert';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:http/http.dart' as http;
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/location_intent_handler.dart';
import 'location_confirm_map_screen.dart';
import 'widgets/place_list_tile.dart';
import 'widgets/saved_places_row.dart';
import 'widgets/search_results_pane.dart';
import '../authscreen/signin.dart';
import '../profile/AddressList.dart';
import '../../theme/widgets/route_marker.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_skeleton.dart';
import '../../theme/widgets/app_top_bar.dart';
import '../../theme/widgets/pressable_scale.dart';

class LocationSearchScreen extends StatefulWidget {
  final String locationType; // 'Pickup', 'Drop', 'Stop'
  final int stopIndex;
  final Map<String, dynamic>? pickupData; // For Drop/Stop mode header
  final Map<String, dynamic>? initialData;

  /// Customise Order: search + pin on map only (see LocationConfirmMapScreen.locationOnly).
  final bool locationOnly;

  const LocationSearchScreen({
    this.locationOnly = false,
    super.key,
    required this.locationType,
    this.stopIndex = 0,
    this.pickupData,
    this.initialData,
  });

  @override
  State<LocationSearchScreen> createState() => _LocationSearchScreenState();
}

class _LocationSearchScreenState extends State<LocationSearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  final GetStorage _storage = GetStorage();

  Timer? _debounce;
  bool _isSearching = false;
  List<Map<String, dynamic>> _predictions = [];
  List<Map<String, dynamic>> _recentSearches = [];

  // Current Location state
  double? _currentLat;
  double? _currentLng;
  String _currentAddress = "";
  String _currentPlaceName = "";
  bool _isDetectingLocation = false;

  // Speech to text state
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _speechAvailable = false;
  bool _isListening = false;

  // Saved places (Home / Work / Other) — moved here from the Home screen.
  List<Map<String, dynamic>> _savedPlaces = [];
  bool _isLoadingSavedPlaces = true;

  bool get _isPickup => widget.locationType.toLowerCase() == 'pickup';
  bool get _isDrop => widget.locationType.toLowerCase() == 'drop';
  bool get _isAddress => widget.locationType.toLowerCase() == 'address';

  @override
  void initState() {
    super.initState();
    _loadRecentSearches();
    _detectCurrentLocation();
    _initSpeech();
    if (_isDrop && !widget.locationOnly) _loadSavedPlaces();

    if (widget.initialData != null && widget.initialData!['address'] != null) {
      _searchController.text = widget.initialData!['address'].toString();
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    if (_isListening) {
      _speech.stop();
    }
    _searchController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _initSpeech() async {
    try {
      _speechAvailable = await _speech.initialize(
        onStatus: (status) {
          debugPrint('Speech status: $status');
          if (status == 'done' || status == 'notListening') {
            if (mounted) {
              setState(() => _isListening = false);
            }
          }
        },
        onError: (errorNotification) {
          debugPrint('Speech error: $errorNotification');
          if (mounted) {
            setState(() => _isListening = false);
          }
        },
      );
      if (mounted) setState(() {});
    } catch (e) {
      debugPrint("Speech init error: $e");
    }
  }

  Future<void> _toggleListening() async {
    if (_isListening) {
      await _speech.stop();
      if (mounted) setState(() => _isListening = false);
      return;
    }

    // 1. Direct Native System OS Microphone Permission Request
    PermissionStatus status = await Permission.microphone.status;
    if (!status.isGranted) {
      status = await Permission.microphone.request();
    }

    if (status.isPermanentlyDenied) {
      ApiWrapper.showToastMessage("Please enable Microphone permission in App Settings");
      await openAppSettings();
      return;
    }

    if (!status.isGranted) {
      ApiWrapper.showToastMessage("Microphone permission is required for voice search");
      return;
    }

    // 2. Initialize speech recognition if needed
    if (!_speechAvailable) {
      _speechAvailable = await _speech.initialize(
        onStatus: (st) {
          if (st == 'done' || st == 'notListening') {
            if (mounted) setState(() => _isListening = false);
          }
        },
        onError: (err) {
          debugPrint('Speech error: $err');
          if (mounted) setState(() => _isListening = false);
        },
      );
    }

    if (_speechAvailable) {
      setState(() => _isListening = true);

      await _speech.listen(
        onResult: (result) {
          if (mounted) {
            setState(() {
              _searchController.text = result.recognizedWords;
            });
            _onSearchChanged(result.recognizedWords);
          }
        },
        listenFor: const Duration(seconds: 15),
        pauseFor: const Duration(seconds: 3),
        localeId: 'en_IN',
        cancelOnError: true,
        partialResults: true,
      );
    } else {
      ApiWrapper.showToastMessage("Speech recognition service is unavailable on this device");
    }
  }

  Future<Position?> _getSafePosition() async {
    try {
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        debugPrint("Location services disabled");
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          return null;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        return null;
      }

      Position? pos = await Geolocator.getLastKnownPosition();
      pos ??= await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 4),
      );
      return pos;
    } catch (e) {
      debugPrint("Error getting GPS position: $e");
      return null;
    }
  }

  Future<Map<String, String>> _resolveAddress(double lat, double lng) async {
    String fullAddress = "";
    String placeName = "";

    // 1. Native Geocoding (Fast & Reliable on device)
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(lat, lng);
      if (placemarks.isNotEmpty) {
        final place = placemarks.first;
        final parts = [
          place.name,
          place.subLocality,
          place.locality,
          place.administrativeArea,
          place.postalCode,
          place.country,
        ].where((e) => e != null && e.toString().trim().isNotEmpty).toSet().toList();

        fullAddress = parts.join(', ');
        placeName = (place.subLocality?.isNotEmpty ?? false)
            ? place.subLocality!
            : ((place.name?.isNotEmpty ?? false) ? place.name! : (place.locality ?? "Selected Location"));
      }
    } catch (e) {
      debugPrint("Native geocoding error: $e");
    }

    // 2. Fallback to Google Geocoding API HTTP
    if (fullAddress.isEmpty) {
      try {
        final geoUrl = Uri.parse(
          'https://maps.googleapis.com/maps/api/geocode/json'
          '?latlng=$lat,$lng'
          '&key=${Config.googleApikey}',
        );
        final resp = await http.get(geoUrl);
        if (resp.statusCode == 200) {
          final data = jsonDecode(resp.body);
          if (data['status'] == 'OK' && (data['results'] as List).isNotEmpty) {
            final first = data['results'][0];
            fullAddress = first['formatted_address']?.toString() ?? '';
            for (var comp in (first['address_components'] as List? ?? [])) {
              final types = (comp['types'] as List? ?? []).cast<String>();
              if (types.contains('sublocality_level_1') || types.contains('sublocality') || types.contains('neighborhood') || types.contains('route')) {
                placeName = comp['long_name']?.toString() ?? '';
                break;
              }
            }
            if (placeName.isEmpty && (first['address_components'] as List? ?? []).isNotEmpty) {
              placeName = first['address_components'][0]['long_name']?.toString() ?? '';
            }
          }
        }
      } catch (e) {
        debugPrint("Google API geocoding error: $e");
      }
    }

    // 3. Fallback to coordinate string if both fail
    if (fullAddress.isEmpty) {
      fullAddress = "Location (${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)})";
      placeName = "Current Location";
    }
    if (placeName.isEmpty) {
      placeName = fullAddress;
    }

    return {
      'address': fullAddress,
      'placeName': placeName,
    };
  }

  Future<void> _detectCurrentLocation() async {
    setState(() => _isDetectingLocation = true);
    try {
      // 1. Check storage cache first for instant display
      final cachedAddress = _storage.read('CurrentAddress')?.toString();
      final cachedLat = double.tryParse(_storage.read('CurrentLat')?.toString() ?? '');
      final cachedLng = double.tryParse(_storage.read('CurrentLng')?.toString() ?? '');
      if (cachedLat != null && cachedLng != null && (cachedAddress?.isNotEmpty ?? false)) {
        if (mounted) {
          setState(() {
            _currentLat = cachedLat;
            _currentLng = cachedLng;
            _currentAddress = cachedAddress!;
            _currentPlaceName = "Current Location";
          });
        }
      }

      // 2. Fetch live GPS position
      Position? position = await _getSafePosition();
      if (position != null) {
        _currentLat = position.latitude;
        _currentLng = position.longitude;

        final resolved = await _resolveAddress(position.latitude, position.longitude);
        if (mounted) {
          setState(() {
            _currentAddress = resolved['address']!;
            _currentPlaceName = resolved['placeName']!;
          });
          _storage.write('CurrentAddress', resolved['address']);
          _storage.write('CurrentLat', position.latitude);
          _storage.write('CurrentLng', position.longitude);
        }
      }
    } catch (e) {
      debugPrint("Error detecting current location in search screen: $e");
    } finally {
      if (mounted) {
        setState(() => _isDetectingLocation = false);
      }
    }
  }

  void _loadRecentSearches() {
    final raw = _storage.read('recent_searches_list');
    if (raw is List) {
      setState(() {
        _recentSearches = raw.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      });
    }
  }

  void _saveToRecentSearches(Map<String, dynamic> item) {
    try {
      final list = List<Map<String, dynamic>>.from(_recentSearches);
      list.removeWhere((x) => x['address'] == item['address'] || x['name'] == item['name']);
      list.insert(0, item);
      if (list.length > 8) list.removeRange(8, list.length);
      _storage.write('recent_searches_list', list);
      _recentSearches = list;
    } catch (e) {
      debugPrint("Error saving recent search: $e");
    }
  }

  void _onSearchChanged(String query) {
    if (_debounce?.isActive ?? false) _debounce?.cancel();
    if (query.trim().isEmpty) {
      setState(() {
        _isSearching = false;
        _predictions = [];
      });
      return;
    }

    _debounce = Timer(const Duration(milliseconds: 350), () {
      _fetchPlacePredictions(query.trim());
    });
  }

  Future<void> _fetchPlacePredictions(String query) async {
    setState(() => _isSearching = true);
    try {
      final url = Uri.parse(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json'
        '?input=${Uri.encodeComponent(query)}'
        '&key=${Config.googleApikey}'
        '&components=country:in',
      );

      final response = await http.get(url);
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['status'] == 'OK' && data['predictions'] is List) {
          final list = (data['predictions'] as List).map((p) {
            final structured = p['structured_formatting'] ?? {};
            return {
              'place_id': p['place_id']?.toString() ?? '',
              'main_text': structured['main_text']?.toString() ?? p['description']?.toString() ?? '',
              'secondary_text': structured['secondary_text']?.toString() ?? '',
              'description': p['description']?.toString() ?? '',
            };
          }).toList();
          setState(() {
            _predictions = list;
            _isSearching = false;
          });
          return;
        }
      }
    } catch (e) {
      debugPrint("Error fetching predictions: $e");
    }
    setState(() => _isSearching = false);
  }

  Future<void> _selectPrediction(Map<String, dynamic> prediction) async {
    final placeId = prediction['place_id'];
    final mainText = prediction['main_text'];
    final description = prediction['description'];

    Get.dialog(
      Center(child: CircularProgressIndicator(color: notifier.darklinercolor)),
      barrierDismissible: false,
    );

    double targetLat = 0.0;
    double targetLng = 0.0;
    String fullAddress = description ?? mainText ?? '';

    try {
      if (placeId != null && placeId.toString().isNotEmpty) {
        final detailsUrl = Uri.parse(
          'https://maps.googleapis.com/maps/api/place/details/json'
          '?place_id=$placeId'
          '&fields=geometry,name,formatted_address'
          '&key=${Config.googleApikey}',
        );
        final resp = await http.get(detailsUrl);
        if (resp.statusCode == 200) {
          final data = jsonDecode(resp.body);
          if (data['status'] == 'OK' && data['result'] != null) {
            final loc = data['result']['geometry']?['location'];
            if (loc != null) {
              targetLat = (loc['lat'] as num).toDouble();
              targetLng = (loc['lng'] as num).toDouble();
            }
            if (data['result']['formatted_address'] != null) {
              fullAddress = data['result']['formatted_address'].toString();
            }
          }
        }
      }
    } catch (e) {
      debugPrint("Error fetching place details: $e");
    }

    if (Get.isDialogOpen ?? false) Get.back();

    _saveToRecentSearches({
      'name': mainText ?? fullAddress,
      'address': fullAddress,
      'lat': targetLat,
      'lng': targetLng,
    });

    _openConfirmMapScreen(
      lat: targetLat,
      lng: targetLng,
      address: fullAddress,
      placeName: mainText ?? fullAddress,
    );
  }

  Future<void> _useCurrentLocation() async {
    Get.dialog(
      Center(child: CircularProgressIndicator(color: notifier.darklinercolor)),
      barrierDismissible: false,
    );

    double targetLat = _currentLat ?? 26.9124;
    double targetLng = _currentLng ?? 75.7873;
    String targetAddress = _currentAddress;
    String targetPlaceName = _currentPlaceName;

    try {
      Position? position = await _getSafePosition();
      if (position != null) {
        targetLat = position.latitude;
        targetLng = position.longitude;

        final resolved = await _resolveAddress(targetLat, targetLng);
        targetAddress = resolved['address']!;
        targetPlaceName = resolved['placeName']!;
      }
    } catch (e) {
      debugPrint("Error in _useCurrentLocation: $e");
    }

    if (Get.isDialogOpen ?? false) Get.back();

    _openConfirmMapScreen(
      lat: targetLat,
      lng: targetLng,
      address: targetAddress,
      placeName: targetPlaceName.isNotEmpty ? targetPlaceName : "Current Location",
    );
  }

  Future<void> _selectOnMap() async {
    Get.dialog(
      Center(child: CircularProgressIndicator(color: notifier.darklinercolor)),
      barrierDismissible: false,
    );

    double defaultLat = _currentLat ?? 26.9124;
    double defaultLng = _currentLng ?? 75.7873;
    String defaultAddress = _currentAddress;
    String defaultPlaceName = _currentPlaceName;

    try {
      Position? position = await _getSafePosition();
      if (position != null) {
        defaultLat = position.latitude;
        defaultLng = position.longitude;
        if (defaultAddress.isEmpty) {
          final resolved = await _resolveAddress(defaultLat, defaultLng);
          defaultAddress = resolved['address']!;
          defaultPlaceName = resolved['placeName']!;
        }
      }
    } catch (e) {
      debugPrint("Geolocator error in selectOnMap: $e");
    }

    if (Get.isDialogOpen ?? false) Get.back();

    _openConfirmMapScreen(
      lat: defaultLat,
      lng: defaultLng,
      address: defaultAddress,
      placeName: defaultPlaceName,
    );
  }

  Future<void> _openConfirmMapScreen({
    required double lat,
    required double lng,
    required String address,
    required String placeName,
  }) async {
    final result = await Get.to<Map<String, dynamic>>(
      () => LocationConfirmMapScreen(
        locationType: widget.locationType,
        stopIndex: widget.stopIndex,
        initialLat: lat,
        initialLng: lng,
        initialAddress: address,
        initialPlaceName: placeName,
        initialData: widget.initialData,
        locationOnly: widget.locationOnly,
      ),
    );

    if (result != null && mounted) {
      Get.back(result: result);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);
    final themeColor = notifier.darklinercolor;
    final String searchPlaceholder = _isListening
        ? "Listening... Speak your address"
        : (_isAddress
            ? "Search address, street, or area"
            : (_isPickup
                ? "Where is your PickUp ?"
                : (_isDrop ? "Where is your Drop ?" : "Where is your Stop ${widget.stopIndex + 1} ?")));

    final p = AppPalette.current;
    final String title = _isAddress
        ? "Add New Address".tr
        : (_isPickup
            ? "Select Pickup Location".tr
            : (_isDrop ? "Select Drop Location".tr : "Select Stop @n".trParams({'n': '${widget.stopIndex + 1}'})));

    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(title: title, onBack: () => Get.back()),
      body: SafeArea(
        top: false,
        bottom: true,
        child: Column(
          children: [
            // ── Route card: pickup summary + search field (Porter layout) ───────
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
              decoration: BoxDecoration(
                color: p.surface,
                borderRadius: BorderRadius.circular(AppRadius.card),
                boxShadow: AppShadow.card,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // If Drop/Stop mode and pickupData provided: pickup row
                  if (!_isPickup && widget.pickupData != null) ...[
                    Row(
                      children: [
                        const RouteMarker.pickup(),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "${widget.pickupData?['c_name'] ?? 'Pickup Contact'.tr} · ${widget.pickupData?['c_number'] ?? ''}",
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                widget.pickupData?['address']?.toString() ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.caption(p.inkSubtle),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    // Dotted connector between the pickup row and the field
                    Padding(
                      padding: const EdgeInsets.only(left: 11),
                      child: Column(
                        children: List.generate(
                          3,
                          (_) => Container(
                            width: 2,
                            height: 3,
                            margin: const EdgeInsets.symmetric(vertical: 1.5),
                            color: p.line,
                          ),
                        ),
                      ),
                    ),
                  ],

                  // ── Search Input Field ────────────────────────────────────
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Row(
                      children: [
                        _isListening
                            ? SizedBox(width: 24, child: Icon(Icons.mic_rounded, color: p.danger, size: 20))
                            : (_isDrop
                                ? const RouteMarker.drop()
                                : (_isPickup || _isAddress
                                    ? const RouteMarker.pickup()
                                    : RouteMarker.stop(widget.stopIndex + 1))),
                        const SizedBox(width: 12),
                        Expanded(
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 180),
                            padding: const EdgeInsets.only(left: 12, right: 4),
                            decoration: BoxDecoration(
                              color: p.surface,
                              borderRadius: BorderRadius.circular(AppRadius.input),
                              border: Border.all(color: _isListening ? p.danger : p.brand, width: _isListening ? 2 : 1.5),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: _searchController,
                                    focusNode: _focusNode,
                                    onChanged: _onSearchChanged,
                                    style: AppText.bodyStrong(p.ink),
                                    decoration: InputDecoration(
                                      hintText: searchPlaceholder.tr,
                                      hintStyle:
                                          AppText.body(_isListening ? p.danger : p.inkSubtle).copyWith(fontSize: 14.5),
                                      border: InputBorder.none,
                                      // The app theme adds its own outline; the box around this field already draws one.
                                      enabledBorder: InputBorder.none,
                                      focusedBorder: InputBorder.none,
                                      filled: false,
                                      contentPadding: const EdgeInsets.symmetric(vertical: 13),
                                    ),
                                  ),
                                ),
                                if (_searchController.text.isNotEmpty)
                                  IconButton(
                                    tooltip: 'Clear'.tr,
                                    icon: Icon(Icons.cancel_rounded, color: p.inkSubtle, size: 20),
                                    onPressed: () {
                                      _searchController.clear();
                                      _onSearchChanged('');
                                    },
                                  ),

                                // Voice Search Mic Button
                                PressableScale(
                                  onTap: _toggleListening,
                                  semanticLabel: 'Search by voice'.tr,
                                  child: Container(
                                    width: 40,
                                    height: 40,
                                    decoration: BoxDecoration(
                                      color: _isListening ? p.dangerTint : p.brandTint,
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Icon(
                                      _isListening ? Icons.graphic_eq_rounded : Icons.mic_rounded,
                                      color: _isListening ? p.danger : p.brand,
                                      size: 22,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // ── Quick actions: map + WhatsApp ─────────────────────────────────
            SizedBox(
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
                children: [
                  _searchActionChip(
                    p,
                    icon: Icon(Icons.map_outlined, color: p.brand, size: 17),
                    label: "Select on map".tr,
                    onTap: _selectOnMap,
                  ),
                  const SizedBox(width: 8),
                  _searchActionChip(
                    p,
                    icon: SvgPicture.asset('assets/whatsapp_logo.svg', width: 18, height: 18),
                    label: "Import from WhatsApp".tr,
                    onTap: _importFromWhatsApp,
                  ),
                ],
              ),
            ),

            // ── Everything below the search card scrolls as one list (small phones + keyboard) ──
            Expanded(
              child: SearchResultsPane(
                children: [
                  // Current location row
                  Container(
                    margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: p.surface,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                      boxShadow: AppShadow.card,
                    ),
                    child: PlaceListTile(
                      title: (_isPickup ? "Your Current Location" : "Use Current Location").tr,
                      subtitle: _currentAddress.isNotEmpty
                          ? _currentAddress
                          : (_isDetectingLocation
                              ? "Detecting GPS location...".tr
                              : "Tap to use device current location".tr),
                      icon: Icons.my_location_rounded,
                      onTap: _useCurrentLocation,
                      trailing: _isDetectingLocation
                          ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: p.brand))
                          : Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 20),
                    ),
                  ),

                  // Saved places (moved here from Home) — only before the customer starts typing
                  if (_isDrop && !widget.locationOnly && _searchController.text.trim().isEmpty)
                    SavedPlacesRow(
                      places: _savedPlaces,
                      loading: _isLoadingSavedPlaces,
                      onSelect: _selectSavedPlace,
                      onAdd: _addSavedPlace,
                      onManage: () async {
                        await Get.to(() => const AddressListPage());
                        _loadSavedPlaces();
                      },
                    ),

                  // Results / recents
                  if (_isSearching)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Column(
                        children: [
                          AppSkeleton(height: 56),
                          SizedBox(height: 10),
                          AppSkeleton(height: 56),
                          SizedBox(height: 10),
                          AppSkeleton(height: 56),
                        ],
                      ),
                    )
                  else if (_searchController.text.trim().isNotEmpty)
                    _buildPredictionsList(notifier, themeColor)
                  else
                    _buildRecentSearchesList(notifier, themeColor),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _searchActionChip(AppPalette p, {required Widget icon, required String label, required VoidCallback onTap}) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: p.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            icon,
            const SizedBox(width: 6),
            Text(label, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _searchEmptyState(AppPalette p, IconData icon, String title, String body) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: p.surface, shape: BoxShape.circle),
              child: Icon(icon, size: 30, color: p.inkSubtle),
            ),
            const SizedBox(height: 12),
            Text(title, textAlign: TextAlign.center, style: AppText.bodyStrong(p.ink)),
            const SizedBox(height: 4),
            Text(body, textAlign: TextAlign.center, style: AppText.caption(p.inkSubtle)),
          ],
        ),
      ),
    );
  }

  // ── Predictions List ───────────────────────────────────────────────────
  Widget _buildPredictionsList(ColorNotifier notifier, Color themeColor) {
    final p = AppPalette.current;
    if (_predictions.isEmpty) {
      return _searchEmptyState(p, Icons.location_off_rounded, "No places found".tr,
          "Try searching with a different keyword or area".tr);
    }

    return _placeListCard(
      p,
      itemCount: _predictions.length,
      itemBuilder: (index) {
        final item = _predictions[index];
        return PlaceListTile(
          title: item['main_text'] ?? '',
          subtitle: item['secondary_text'] ?? '',
          highlight: _searchController.text,
          icon: Icons.location_on_outlined,
          onTap: () => _selectPrediction(item),
        );
      },
    );
  }

  // ── Recent Searches List ───────────────────────────────────────────────
  Widget _buildRecentSearchesList(ColorNotifier notifier, Color themeColor) {
    final p = AppPalette.current;
    if (_recentSearches.isEmpty) {
      return _searchEmptyState(p, Icons.search_rounded, "Search your destination".tr,
          "Type an address or choose current location above".tr);
    }

    return _placeListCard(
      p,
      header: "RECENT".tr,
      itemCount: _recentSearches.length,
      itemBuilder: (index) {
        final item = _recentSearches[index];
        final name = item['name'] ?? item['address'] ?? '';
        final address = item['address'] ?? '';
        return PlaceListTile(
          title: name,
          subtitle: address,
          icon: Icons.history_rounded,
          trailing: Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 20),
          onSave: (!_isAddress && !widget.locationOnly) ? () => _saveRecentAsPlace(item) : null,
          onTap: () {
            final lat = (item['lat'] as num?)?.toDouble() ?? 0.0;
            final lng = (item['lng'] as num?)?.toDouble() ?? 0.0;
            _openConfirmMapScreen(
              lat: lat,
              lng: lng,
              address: address,
              placeName: name,
            );
          },
        );
      },
    );
  }

  Widget _placeListCard(AppPalette p,
      {String? header, required int itemCount, required Widget Function(int index) itemBuilder}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (header != null)
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(header, style: AppText.caption(p.inkSubtle).copyWith(fontFamily: 'Gilroy_Bold', letterSpacing: 0.4)),
          ),
        Container(
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            boxShadow: AppShadow.card,
          ),
          child: Column(
            children: [
              for (var i = 0; i < itemCount; i++) ...[
                if (i > 0) Divider(height: 1, indent: 62, color: p.divider),
                itemBuilder(i),
              ],
            ],
          ),
        ),
      ],
      ),
    );
  }

  // ── SAVED PLACES (moved from Home) ───────────────────────────────────────
  Future<void> _loadSavedPlaces() async {
    final uid = _storage.read("Uid");
    if (uid == null || uid.toString().isEmpty || uid.toString() == "0") {
      if (mounted) setState(() => _isLoadingSavedPlaces = false);
      return;
    }

    try {
      final response = await ApiWrapper.dataPostNode(Config.nodeAddressList, {"uid": uid.toString()});
      final rawLocations = response is Map ? response["AddressList"] : null;
      final locations = rawLocations is List
          ? rawLocations
              .whereType<Map>()
              .map((location) => Map<String, dynamic>.from(location))
              .toList()
          : <Map<String, dynamic>>[];

      if (!mounted) return;
      setState(() {
        _savedPlaces = locations;
        _isLoadingSavedPlaces = false;
      });
    } catch (error) {
      debugPrint("Saved locations failed: $error");
      if (mounted) {
        setState(() {
          _savedPlaces = [];
          _isLoadingSavedPlaces = false;
        });
      }
    }
  }

  /// Same as the old Home saved-place tap: store it as the drop and hand it back. The caller
  /// (Home._startDropSelection) then runs the service-area check and opens Select Vehicle.
  void _selectSavedPlace(Map<String, dynamic> place) {
    final drop = Map<String, dynamic>.from(place);
    _storage.write("DropeAddress", [drop]);
    Get.back(result: drop);
  }

  /// Login guard from the old Home "Add" chip. Returns false when the customer is still logged out.
  Future<bool> _ensureLoggedInToSave() async {
    final uid = _storage.read("Uid") ?? _storage.read("UserLogin")?["id"];
    if (uid != null && uid.toString().isNotEmpty && uid.toString() != "0") return true;
    ApiWrapper.showToastMessage("Please login to save locations".tr);
    await Get.to(() => SignIn());
    final newUid = _storage.read("Uid") ?? _storage.read("UserLogin")?["id"];
    return newUid != null && newUid.toString().isNotEmpty && newUid.toString() != "0";
  }

  Future<void> _addSavedPlace() async {
    if (!await _ensureLoggedInToSave()) return;
    final result = await Get.to(() => const LocationSearchScreen(locationType: "Address"));
    if (result != null) await _loadSavedPlaces();
  }

  /// "❤ SAVE" on a recent: the existing save-address flow, prefilled with that place.
  Future<void> _saveRecentAsPlace(Map<String, dynamic> item) async {
    if (!await _ensureLoggedInToSave()) return;
    final address = (item['address'] ?? '').toString();
    final result = await Get.to(() => LocationConfirmMapScreen(
          locationType: 'Address',
          initialLat: (item['lat'] as num?)?.toDouble() ?? 0.0,
          initialLng: (item['lng'] as num?)?.toDouble() ?? 0.0,
          initialAddress: address,
          initialPlaceName: (item['name'] ?? address).toString(),
        ));
    if (result != null && _isDrop) await _loadSavedPlaces();
  }

  // ── WHATSAPP LOCATION IMPORT ─────────────────────────────────────────────
  /// Opens WhatsApp (or WhatsApp Business) directly. Does NOT gate on
  /// canLaunchUrl: on some Android 11+ builds it reports false for an installed
  /// WhatsApp (package-visibility), which used to send users to the Play Store
  /// even though WhatsApp was installed. Launching can only succeed when an
  /// app really handles the link, so just try, most specific first.
  Future<bool> _openWhatsApp() async {
    // First choice: start the installed app like its launcher icon (works even when WhatsApp is not
    // in recents, where whatsapp:// shows "Couldn't open this link").
    try {
      if (await const MethodChannel('com.shifter.online/contacts').invokeMethod<bool>('openWhatsApp') == true) {
        return true;
      }
    } catch (_) {
      // channel missing (non-Android) - fall back to the links below
    }
    final attempts = <Uri>[
      Uri.parse('whatsapp://send'), // WhatsApp / WhatsApp Business app scheme
      Uri.parse('whatsapp://'),
    ];
    for (final uri in attempts) {
      try {
        if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return true;
      } catch (_) {
        // not handled by any installed app - try the next form
      }
    }
    try {
      // wa.me is claimed by WhatsApp as an app link; externalNonBrowserApplication
      // only succeeds if a real app (not a browser) opens it, so a phone without
      // WhatsApp returns false here instead of opening a web page.
      return await launchUrl(Uri.parse('https://wa.me/'), mode: LaunchMode.externalNonBrowserApplication);
    } catch (_) {
      return false;
    }
  }

  Future<void> _importFromWhatsApp() async {
    // 1. Directly open WhatsApp — no dialog, no friction
    if (!await _openWhatsApp()) {
      // WhatsApp (and WhatsApp Business) not installed — fallback to Play Store
      await launchUrl(
        Uri.parse('https://play.google.com/store/apps/details?id=com.whatsapp'),
        mode: LaunchMode.externalApplication,
      );
      return;
    }

    // 2. Listen for the next incoming geo URI (user taps a WA location → Shifter opens)
    try {
      final appLinks = AppLinks();
      final uri = await appLinks.uriLinkStream.first
          .timeout(const Duration(minutes: 3));

      if (!mounted) return;

      // Show brief loading spinner
      Get.dialog(
        const Center(
          child: SizedBox(
            width: 56,
            height: 56,
            child: CircularProgressIndicator(
              color: Color(0xff25D366),
              strokeWidth: 3,
            ),
          ),
        ),
        barrierDismissible: false,
      );

      final loc = await parseLocationUri(uri);

      if (Get.isDialogOpen ?? false) Get.back();

      if (loc == null || !mounted) {
        ApiWrapper.showToastMessage("Could not read location from that link.");
        return;
      }

      // 3. Reverse-geocode lat/lng → human-readable address
      String address = '';
      try {
        final geocodeUrl = Uri.parse(
          'https://maps.googleapis.com/maps/api/geocode/json'
          '?latlng=${loc.lat},${loc.lng}'
          '&key=${Config.googleApikey}',
        );
        final geocodeRes = await http.get(geocodeUrl).timeout(const Duration(seconds: 8));
        final geocodeJson = jsonDecode(geocodeRes.body);
        if (geocodeJson['status'] == 'OK' &&
            geocodeJson['results'] is List &&
            (geocodeJson['results'] as List).isNotEmpty) {
          address = geocodeJson['results'][0]['formatted_address']?.toString() ?? '';
        }
      } catch (_) {}

      if (address.isEmpty) {
        address = loc.label?.isNotEmpty == true
            ? loc.label!
            : '${loc.lat.toStringAsFixed(5)}, ${loc.lng.toStringAsFixed(5)}';
      }

      // 4. Open map confirm screen so user can fine-tune pin
      if (mounted) {
        _openConfirmMapScreen(
          lat: loc.lat,
          lng: loc.lng,
          address: address,
          placeName: loc.label ?? 'WhatsApp Location',
        );
      }
    } catch (_) {
      if (Get.isDialogOpen ?? false) Get.back();
      // User timed out or dismissed — do nothing
    }
  }
}
