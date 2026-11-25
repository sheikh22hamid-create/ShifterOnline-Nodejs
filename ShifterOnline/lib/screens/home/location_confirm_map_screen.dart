// ignore_for_file: deprecated_member_use

import 'package:flutter_native_contact_picker/flutter_native_contact_picker.dart';
import 'package:goParcel/utils/phone_number.dart';
import 'package:goParcel/utils/address_format.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_buttons.dart';
import '../../theme/widgets/pressable_scale.dart';
import 'widgets/pin_drop_marker.dart';
import '../../theme/widgets/route_marker.dart';

class LocationConfirmMapScreen extends StatefulWidget {
  final String locationType; // 'Pickup', 'Drop', 'Stop'
  final int stopIndex;
  final double initialLat;
  final double initialLng;
  final String initialAddress;
  final String initialPlaceName;
  final Map<String, dynamic>? initialData;

  /// Customise Order only: just pick the point on the map. No sender/receiver contact
  /// details are asked, and the normal booking's saved pickup/drop is left untouched.
  final bool locationOnly;

  const LocationConfirmMapScreen({
    super.key,
    this.locationOnly = false,
    required this.locationType,
    this.stopIndex = 0,
    required this.initialLat,
    required this.initialLng,
    required this.initialAddress,
    required this.initialPlaceName,
    this.initialData,
  });

  @override
  State<LocationConfirmMapScreen> createState() => _LocationConfirmMapScreenState();
}

class _LocationConfirmMapScreenState extends State<LocationConfirmMapScreen> {
  final GetStorage _storage = GetStorage();
  GoogleMapController? _mapController;

  late double _currentLat;
  late double _currentLng;
  String _currentAddress = "";
  String _currentPlaceName = "";
  bool _isGeocoding = false;

  final TextEditingController _houseNoController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _mobileController = TextEditingController();

  bool _useMyNumber = false;
  // Sender opt-in for WhatsApp booking info + OTP. Off unless the customer ticks it.
  bool _sendWhatsapp = false;
  String _myMobile = "";
  String _myName = "";
  String _selectedTag = "Home"; // 'Home', 'Shop', 'Other'

  bool get _isPickup => widget.locationType.toLowerCase() == 'pickup';
  bool get _isDrop => widget.locationType.toLowerCase() == 'drop';
  bool get _isAddress => widget.locationType.toLowerCase() == 'address';
  bool _isSavingAddress = false;

  Timer? _geocodeDebounce;

  @override
  void initState() {
    super.initState();
    _currentLat = widget.initialLat != 0.0 ? widget.initialLat : 26.9124;
    _currentLng = widget.initialLng != 0.0 ? widget.initialLng : 75.7873;
    _currentAddress = widget.initialAddress;
    _currentPlaceName = widget.initialPlaceName;
    _sendWhatsapp = widget.initialData?['send_whatsapp'] == true;

    _loadUserData();

    // Immediately reverse geocode if address is empty or generic
    if (_currentAddress.isEmpty || _currentAddress.toLowerCase().contains("detecting")) {
      _reverseGeocode(_currentLat, _currentLng);
    }
  }

  @override
  void dispose() {
    _geocodeDebounce?.cancel();
    _houseNoController.dispose();
    _nameController.dispose();
    _mobileController.dispose();
    super.dispose();
  }

  void _loadUserData() {
    try {
      final user = _storage.read('UserLogin');
      if (user is Map) {
        final name = user['name']?.toString() ?? user['username']?.toString() ?? '';
        final mobile = user['mobile']?.toString() ?? user['phone']?.toString() ?? '';
        _myName = name.isNotEmpty ? name : (_storage.read('name')?.toString() ?? '');
        _myMobile = mobile.isNotEmpty ? mobile : (_storage.read('mobile')?.toString() ?? '');

        if (_isPickup || _isAddress) {
          _nameController.text = (widget.initialData?['c_name']?.toString().isNotEmpty ?? false)
              ? widget.initialData!['c_name'].toString()
              : _myName;
          _mobileController.text = (widget.initialData?['c_number']?.toString().isNotEmpty ?? false)
              ? widget.initialData!['c_number'].toString()
              : _myMobile;
          _houseNoController.text = widget.initialData?['hno']?.toString() ?? '';
          _useMyNumber = _mobileController.text.isNotEmpty && _mobileController.text == _myMobile;
        } else {
          // Drop mode: check existing stored receiver details or empty
          if (widget.initialData != null) {
            _nameController.text = widget.initialData?['c_name']?.toString() ?? '';
            _mobileController.text = widget.initialData?['c_number']?.toString() ?? '';
            _houseNoController.text = widget.initialData?['hno']?.toString() ?? '';
            _useMyNumber = _mobileController.text.isNotEmpty && _mobileController.text == _myMobile;
          } else {
            _nameController.text = '';
            _mobileController.text = '';
            _houseNoController.text = '';
            _useMyNumber = false;
          }
        }
      } else {
        _myName = _storage.read('name')?.toString() ?? '';
        _myMobile = _storage.read('mobile')?.toString() ?? '';
      }
    } catch (e) {
      debugPrint("Error loading user profile data: $e");
    }
  }

  /// Opens the phone's own contact picker (it has its own search) and fills
  /// the mobile number - and the name, when that is still empty or just the
  /// customer's own pre-filled name - from the chosen contact. Typing a number
  /// by hand keeps working exactly as before.
  Future<void> _pickFromPhoneBook() async {
    try {
      final contact = await FlutterNativeContactPicker().selectPhoneNumber();
      if (contact == null || !mounted) return;
      final number = normalizeIndianMobile(contact.selectedPhoneNumber ?? (contact.phoneNumbers?.isNotEmpty == true ? contact.phoneNumbers!.first : null));
      if (number.isEmpty) {
        ApiWrapper.showToastMessage('This contact has no phone number.'.tr);
        return;
      }
      setState(() {
        _mobileController.text = number;
        _mobileController.selection = TextSelection.collapsed(offset: number.length);
        _useMyNumber = number == _myMobile;
        final pickedName = (contact.fullName ?? '').trim();
        final currentName = _nameController.text.trim();
        if (pickedName.isNotEmpty && (currentName.isEmpty || currentName == _myName)) {
          _nameController.text = pickedName;
        }
      });
    } catch (e) {
      debugPrint('Phone book picker failed: $e');
      ApiWrapper.showToastMessage('Could not open the phone book.'.tr);
    }
  }

  void _toggleUseMyNumber(bool? val) {
    setState(() {
      _useMyNumber = val ?? !_useMyNumber;
      if (_useMyNumber) {
        if (_myMobile.isNotEmpty) {
          _mobileController.text = _myMobile;
        }
        if (_myName.isNotEmpty) {
          _nameController.text = _myName;
        }
      } else {
        if (_mobileController.text == _myMobile) {
          _mobileController.clear();
        }
        if (_nameController.text == _myName) {
          _nameController.clear();
        }
      }
    });
  }

  Future<void> _reverseGeocode(double lat, double lng) async {
    setState(() => _isGeocoding = true);
    String formattedAddress = "";
    String placeName = "";

    // 1. Native device geocoding (fast, offline capable, no API restrictions)
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

        formattedAddress = parts.join(', ');
        placeName = (place.subLocality?.isNotEmpty ?? false)
            ? place.subLocality!
            : ((place.name?.isNotEmpty ?? false) ? place.name! : (place.locality ?? "Selected Location"));
      }
    } catch (e) {
      debugPrint("Native geocoding in map confirm error: $e");
    }

    // 2. Google Geocoding API HTTP fallback
    if (formattedAddress.isEmpty) {
      try {
        final url = Uri.parse(
          'https://maps.googleapis.com/maps/api/geocode/json'
          '?latlng=$lat,$lng'
          '&key=${Config.googleApikey}',
        );
        final response = await http.get(url);
        if (response.statusCode == 200) {
          final data = jsonDecode(response.body);
          if (data['status'] == 'OK' && (data['results'] as List).isNotEmpty) {
            final first = data['results'][0];
            formattedAddress = first['formatted_address']?.toString() ?? '';

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
        debugPrint("Google API reverse geocode error: $e");
      }
    }

    // 3. Fallback to coordinate string so user is NEVER blocked
    if (formattedAddress.isEmpty) {
      formattedAddress = "Location (${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)})";
      placeName = "Pinned Location";
    }
    if (placeName.isEmpty) {
      placeName = formattedAddress;
    }

    if (mounted) {
      setState(() {
        _currentAddress = formattedAddress;
        _currentPlaceName = placeName;
        _isGeocoding = false;
      });
    }
  }

  void _onCameraIdle() {
    if (_mapController != null) {
      _geocodeDebounce?.cancel();
      _geocodeDebounce = Timer(const Duration(milliseconds: 300), () async {
        final bounds = await _mapController!.getVisibleRegion();
        final centerLat = (bounds.northeast.latitude + bounds.southwest.latitude) / 2;
        final centerLng = (bounds.northeast.longitude + bounds.southwest.longitude) / 2;

        if (mounted) {
          _currentLat = centerLat;
          _currentLng = centerLng;
          _reverseGeocode(centerLat, centerLng);
        }
      });
    }
  }

  Future<void> _recenterToGps() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      Position? position = await Geolocator.getLastKnownPosition();
      position ??= await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 4),
      );
      final target = LatLng(position.latitude, position.longitude);
      _currentLat = position.latitude;
      _currentLng = position.longitude;
      _mapController?.animateCamera(CameraUpdate.newLatLngZoom(target, 16));
      _reverseGeocode(_currentLat, _currentLng);
    } catch (e) {
      debugPrint("Error recentering to GPS: $e");
    }
  }

  void _confirmAndProceed() async {
    if (widget.locationOnly) {
      final houseNo = _houseNoController.text.trim();
      final base = _currentAddress.isNotEmpty
          ? _currentAddress
          : "Location (${_currentLat.toStringAsFixed(4)}, ${_currentLng.toStringAsFixed(4)})";
      // Coordinates are exactly the pin the customer confirmed; only the address text gets the flat no. in front.
      Get.back(result: <String, dynamic>{
        "address": cleanAddress(houseNo.isNotEmpty ? "$houseNo, $base" : base),
        "lat_map": _currentLat,
        "long_map": _currentLng,
      });
      return;
    }
    final name = _nameController.text.trim();
    final mobile = _mobileController.text.trim();
    final houseNo = _houseNoController.text.trim();

    if (name.isEmpty) {
      ApiWrapper.showToastMessage(
        _isAddress
            ? "Please enter Contact Name"
            : (_isPickup ? "Please enter Sender's Name" : "Please enter Receiver's Name"),
      );
      return;
    }
    if (mobile.isEmpty || mobile.length < 8) {
      ApiWrapper.showToastMessage("Please enter a valid mobile number");
      return;
    }
    
    // Safety check: if address is somehow still empty, create coordinates fallback
    final finalAddress = _currentAddress.isNotEmpty 
        ? _currentAddress 
        : "Location (${_currentLat.toStringAsFixed(4)}, ${_currentLng.toStringAsFixed(4)})";

    final Map<String, dynamic> addressData = {
      "hno": houseNo,
      "c_ddress": houseNo,
      "address": cleanAddress(finalAddress),
      "c_name": name,
      "c_number": mobile,
      "lat_map": _currentLat,
      "long_map": _currentLng,
      "landmark": "",
      "type": _selectedTag,
      if (!_isAddress) "send_whatsapp": _sendWhatsapp,
    };

    if (_isAddress) {
      final uid = _storage.read('Uid') ?? _storage.read('UserLogin')?['id'];
      if (uid == null || uid.toString().isEmpty || uid.toString() == "0") {
        ApiWrapper.showToastMessage("Please login to save address".tr);
        return;
      }
      setState(() => _isSavingAddress = true);
      try {
        final body = {
          "uid": uid.toString(),
          "address": finalAddress,
          "houseno": houseNo,
          "type": _selectedTag == 'Shop' ? 'Office' : _selectedTag,
          "lat_map": _currentLat.toString(),
          "long_map": _currentLng.toString(),
          "aid": "0",
          "c_name": name,
          "c_number": mobile,
          "landmark": "",
        };
        final res = await ApiWrapper.dataPostNode(Config.nodeAddressSave, body);
        if (mounted) setState(() => _isSavingAddress = false);
        if (res != null && (res['ResponseCode'] == "200" || res['Result'] == "true")) {
          final msg = res['ResponseMsg']?.toString() ?? "Address Saved Successfully";
          tostmsg(msg);
          Get.back(result: addressData);
        } else {
          final msg = res?['ResponseMsg']?.toString() ?? "Failed to save address";
          tostmsg(msg);
        }
      } catch (e) {
        if (mounted) setState(() => _isSavingAddress = false);
        tostmsg("Failed to save address");
      }
      return;
    }

    // Save in storage
    final storageKey = _isPickup ? "PickupAddress" : "DropeAddress";
    _storage.write(storageKey, [addressData]);

    Get.back(result: addressData);
  }

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);
    final p = AppPalette.current;
    final indicatorColor = _isAddress ? p.brand : (_isPickup ? p.success : p.brand);
    final mapHeight = MediaQuery.of(context).size.height * 0.52;
    final bottomInset = MediaQuery.of(context).padding.bottom;

    Widget roundMapButton({required IconData icon, required VoidCallback onTap, required String label, Color? color}) =>
        PressableScale(
          onTap: onTap,
          semanticLabel: label,
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: p.surface,
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.15), blurRadius: 12, offset: const Offset(0, 4))],
            ),
            child: Icon(icon, color: color ?? p.ink, size: 22),
          ),
        );

    return Scaffold(
      backgroundColor: p.canvas,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          // ── 1. Full Google Map ──────────────────────────────────────────
          SizedBox(
            height: mapHeight,
            width: double.infinity,
            child: GoogleMap(
              initialCameraPosition: CameraPosition(
                target: LatLng(_currentLat, _currentLng),
                zoom: 16.0,
              ),
              onMapCreated: (controller) {
                _mapController = controller;
              },
              onCameraIdle: _onCameraIdle,
              myLocationEnabled: true,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
            ),
          ),

          // ── 2. Centered Pin Marker (tip on the map centre) ───────────────
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: mapHeight,
            child: IgnorePointer(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: PinDropMarker.height - 10),
                  child: PinDropMarker(color: indicatorColor),
                ),
              ),
            ),
          ),

          // ── 3. Top Floating Controls ────────────────────────────────────
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  roundMapButton(icon: Icons.arrow_back_rounded, label: 'Back'.tr, onTap: () => Get.back()),
                  roundMapButton(
                      icon: Icons.my_location_rounded,
                      label: 'Use my current location'.tr,
                      color: p.brand,
                      onTap: _recenterToGps),
                ],
              ),
            ),
          ),

          // ── 4. Bottom Form Sheet ────────────────────────────────────────
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              height: MediaQuery.of(context).size.height * 0.58,
              width: double.infinity,
              padding: EdgeInsets.fromLTRB(16, 8, 16, bottomInset > 0 ? bottomInset + 8 : 16),
              decoration: BoxDecoration(
                color: p.surface,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 24, offset: const Offset(0, -8))],
              ),
              child: Column(
                children: [
                  Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(color: p.line, borderRadius: BorderRadius.circular(2)),
                  ),
                  // Scrollable form fields
                  Expanded(
                    child: SingleChildScrollView(
                      physics: const BouncingScrollPhysics(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Address + Change
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (_isAddress)
                                Container(
                                  width: 36,
                                  height: 36,
                                  decoration: BoxDecoration(
                                    color: _isPickup && !_isAddress ? p.successTint : p.brandTint,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(Icons.location_on_outlined, color: indicatorColor, size: 18),
                                )
                              else if (_isPickup)
                                const RouteMarker.pickup(size: 32)
                              else if (_isDrop)
                                const RouteMarker.drop(size: 32)
                              else
                                RouteMarker.stop(widget.stopIndex + 1, size: 32),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _isGeocoding
                                          ? "Locating address...".tr
                                          : (_currentPlaceName.isNotEmpty ? _currentPlaceName : "Selected Location".tr),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: AppText.bodyStrong(p.ink).copyWith(fontSize: 16),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      _isGeocoding ? "Please wait...".tr : _currentAddress,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: AppText.caption(p.inkSubtle),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              TextButton(
                                onPressed: () => Get.back(),
                                style: TextButton.styleFrom(minimumSize: const Size(44, 44), foregroundColor: p.brandText),
                                child: Text("Change".tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13)),
                              ),
                            ],
                          ),

                          const SizedBox(height: 14),

                          if (widget.locationOnly) ...[
                          TextField(
                            controller: _houseNoController,
                            style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14),
                            decoration: appInputDecoration(hint: "House / Flat / Block / Floor No. (Optional)".tr),
                          ),
                          ],

                          if (!widget.locationOnly) ...[
                          const SizedBox(height: 2),

                          // Section Heading: Contact Details
                          Text(
                            (_isAddress ? "Contact Details" : (_isPickup ? "Sender Details" : (_isDrop ? "Receiver Details" : "Contact Details"))).tr,
                            style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14),
                          ),

                          const SizedBox(height: 10),

                          // Contact Name Input
                          TextField(
                            controller: _nameController,
                            style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14),
                            decoration: appInputDecoration(
                              label: (_isAddress ? "Contact Name" : (_isPickup ? "Sender's Name" : "Receiver's Name")).tr,
                              prefixIcon: Icon(Icons.person_outline_rounded, color: p.inkSubtle, size: 20),
                            ),
                          ),

                          const SizedBox(height: 10),

                          // Mobile Number Input
                          TextField(
                            controller: _mobileController,
                            keyboardType: TextInputType.phone,
                            onChanged: (val) {
                              final trimmed = val.trim();
                              if (_useMyNumber && trimmed != _myMobile) {
                                setState(() => _useMyNumber = false);
                              } else if (!_useMyNumber && trimmed.isNotEmpty && trimmed == _myMobile) {
                                setState(() {
                                  _useMyNumber = true;
                                  if (_nameController.text.trim().isEmpty && _myName.isNotEmpty) {
                                    _nameController.text = _myName;
                                  }
                                });
                              }
                            },
                            style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14),
                            decoration: appInputDecoration(
                              label: (_isAddress ? "Contact Mobile" : (_isPickup ? "Sender's Mobile" : "Receiver's Mobile")).tr,
                              prefixIcon: Icon(Icons.phone_outlined, color: p.inkSubtle, size: 20),
                              // Pick from (and search) the phone book instead of typing.
                              suffixIcon: IconButton(
                                tooltip: 'Choose from phone book'.tr,
                                icon: Icon(Icons.contacts_rounded, color: p.brand, size: 22),
                                onPressed: _pickFromPhoneBook,
                              ),
                            ),
                          ),

                          // "Use my mobile number" Checkbox
                          if (_myMobile.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: () => _toggleUseMyNumber(null),
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(minHeight: 44),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: Checkbox(
                                        value: _useMyNumber,
                                        activeColor: p.brand,
                                        checkColor: p.onBrand,
                                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
                                        onChanged: (val) => _toggleUseMyNumber(val),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Flexible(
                                      child: Text(
                                        "Use my mobile number (@n)".trParams({'n': _myMobile}),
                                        style: AppText.caption(p.ink).copyWith(fontSize: 13),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],

                          // Optional WhatsApp opt-in (default unchecked)
                          if (!_isAddress) ...[
                            const SizedBox(height: 10),
                            InkWell(
                              borderRadius: BorderRadius.circular(AppRadius.input),
                              onTap: () => setState(() => _sendWhatsapp = !_sendWhatsapp),
                              child: Container(
                                constraints: const BoxConstraints(minHeight: 48),
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                decoration: BoxDecoration(
                                  color: p.successTint,
                                  borderRadius: BorderRadius.circular(AppRadius.input),
                                ),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: Checkbox(
                                        value: _sendWhatsapp,
                                        activeColor: p.success,
                                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
                                        onChanged: (val) => setState(() => _sendWhatsapp = val ?? false),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        // A stop has no OTP of its own, so its label only promises the booking info.
                                        (_isPickup || _isDrop
                                            ? "Send booking info & OTP on this WhatsApp number"
                                            : "Send booking info on this WhatsApp number").tr,
                                        style: AppText.caption(p.ink).copyWith(fontSize: 13),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],

                          const SizedBox(height: 12),

                          // House / Building / Flat input
                          TextField(
                            controller: _houseNoController,
                            style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14),
                            decoration: appInputDecoration(hint: "House / Flat / Block / Floor No. (Optional)".tr),
                          ),

                          const SizedBox(height: 12),

                          // "Save as" chips (Home, Shop, Other)
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text("Save as".tr, style: AppText.caption(p.inkMuted).copyWith(fontFamily: 'Gilroy_Bold')),
                              _buildTagChip("Home", Icons.home_outlined, notifier, p.brand),
                              _buildTagChip("Shop", Icons.storefront_outlined, notifier, p.brand),
                              _buildTagChip("Other", Icons.location_on_outlined, notifier, p.brand),
                            ],
                          ),
                          const SizedBox(height: 8),
                          ],
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 8),

                  // Pinned Confirm and Proceed Button (always above navigation bar)
                  _isSavingAddress
                      ? Container(
                          height: 54,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(color: p.brand, borderRadius: BorderRadius.circular(14)),
                          child: SizedBox(
                            height: 22,
                            width: 22,
                            child: CircularProgressIndicator(color: p.onBrand, strokeWidth: 2.5),
                          ),
                        )
                      : AppPrimaryButton(
                          label: (widget.locationOnly
                                  ? "Confirm Location"
                                  : _isAddress
                                      ? "Save Address"
                                      : (_isPickup
                                          ? "Confirm & Continue"
                                          : (_isDrop ? "Confirm & Proceed to Vehicles" : "Confirm Stop")))
                              .tr,
                          onPressed: _isSavingAddress ? null : _confirmAndProceed,
                        ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTagChip(String label, IconData icon, ColorNotifier notifier, Color themeColor) {
    final p = AppPalette.current;
    final isSelected = _selectedTag == label;
    return PressableScale(
      onTap: () => setState(() => _selectedTag = label),
      child: Container(
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: isSelected ? p.brandTint : p.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: isSelected ? p.brand : p.line, width: isSelected ? 1.5 : 1),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: isSelected ? p.brand : p.ink),
            const SizedBox(width: 6),
            Text(
              label.tr,
              style: AppText.caption(p.ink).copyWith(
                fontFamily: isSelected ? 'Gilroy_Bold' : 'Gilroy_Medium',
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BubbleTrianglePainter extends CustomPainter {
  final Color color;
  _BubbleTrianglePainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width / 2, size.height)
      ..lineTo(size.width, 0)
      ..close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
