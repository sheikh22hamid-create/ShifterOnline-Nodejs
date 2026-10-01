// ignore_for_file: deprecated_member_use

import 'package:flutter_native_contact_picker/flutter_native_contact_picker.dart';
import 'package:goParcel/utils/phone_number.dart';
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

class LocationConfirmMapScreen extends StatefulWidget {
  final String locationType; // 'Pickup', 'Drop', 'Stop'
  final int stopIndex;
  final double initialLat;
  final double initialLng;
  final String initialAddress;
  final String initialPlaceName;
  final Map<String, dynamic>? initialData;

  const LocationConfirmMapScreen({
    super.key,
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
      "address": finalAddress,
      "c_name": name,
      "c_number": mobile,
      "lat_map": _currentLat,
      "long_map": _currentLng,
      "landmark": "",
      "type": _selectedTag,
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
    final themeColor = notifier.darklinercolor;
    final indicatorColor = _isAddress
        ? themeColor
        : (_isPickup ? const Color(0xff10B981) : const Color(0xffEF4444));

    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          // ── 1. Full Google Map ──────────────────────────────────────────
          SizedBox(
            height: MediaQuery.of(context).size.height * 0.52,
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

          // ── 2. Centered Pin Marker Pointer ───────────────────────────────
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: MediaQuery.of(context).size.height * 0.52,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 36),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: indicatorColor,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.25),
                        blurRadius: 8,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Icon(
                    _isPickup
                        ? Icons.arrow_upward_rounded
                        : (_isDrop ? Icons.arrow_downward_rounded : Icons.location_on_rounded),
                    color: Colors.white,
                    size: 24,
                  ),
                ),
              ),
            ),
          ),

          // ── 3. Top Floating App Bar / Controls ──────────────────────────
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // Back Button
                  InkWell(
                    onTap: () => Get.back(),
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: notifier.getBgColor,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.12),
                            blurRadius: 10,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Icon(Icons.arrow_back_rounded, color: notifier.text, size: 22),
                    ),
                  ),

                  // GPS Recenter Button
                  InkWell(
                    onTap: _recenterToGps,
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: notifier.getBgColor,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.12),
                            blurRadius: 10,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Icon(Icons.my_location_rounded, color: themeColor, size: 22),
                    ),
                  ),
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
              padding: EdgeInsets.fromLTRB(
                16,
                16,
                16,
                MediaQuery.of(context).padding.bottom > 0
                    ? MediaQuery.of(context).padding.bottom + 8
                    : 16,
              ),
              decoration: BoxDecoration(
                color: notifier.getBgColor,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.16),
                    blurRadius: 20,
                    offset: const Offset(0, -4),
                  ),
                ],
              ),
              child: Column(
                children: [
                  // Scrollable form fields
                  Expanded(
                    child: SingleChildScrollView(
                      physics: const BouncingScrollPhysics(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Top Address Row + Change Button
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: notifier.lightBgColor,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: notifier.bordecolor),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(5),
                                  decoration: BoxDecoration(
                                    color: indicatorColor,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    _isAddress
                                        ? Icons.location_on_rounded
                                        : (_isPickup ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded),
                                    color: Colors.white,
                                    size: 14,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _isGeocoding
                                            ? "Locating address..."
                                            : (_currentPlaceName.isNotEmpty ? _currentPlaceName : "Selected Location"),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 15,
                                          color: notifier.text,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        _isGeocoding ? "Please wait..." : _currentAddress,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 12,
                                          color: greaycolor,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                OutlinedButton(
                                  onPressed: () => Get.back(),
                                  style: OutlinedButton.styleFrom(
                                    side: BorderSide(color: themeColor, width: 1.2),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                    minimumSize: Size.zero,
                                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  child: Text(
                                    "Change",
                                    style: TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 12,
                                      color: themeColor,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),

                          const SizedBox(height: 14),

                          // House / Building / Flat input
                          TextField(
                            controller: _houseNoController,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 14,
                              color: notifier.text,
                            ),
                            decoration: InputDecoration(
                              hintText: "House / Flat / Block / Floor No. (Optional)",
                              hintStyle: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 13,
                                color: greaycolor,
                              ),
                              filled: true,
                              fillColor: notifier.lightBgColor,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: notifier.bordecolor),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: notifier.bordecolor),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: themeColor, width: 1.5),
                              ),
                            ),
                          ),

                          const SizedBox(height: 16),

                          // Section Heading: Contact Details
                          Text(
                            _isAddress ? "Contact Details" : (_isPickup ? "Sender Details" : (_isDrop ? "Receiver Details" : "Contact Details")),
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 14,
                              color: notifier.text,
                            ),
                          ),

                          const SizedBox(height: 10),

                          // Contact Name Input
                          TextField(
                            controller: _nameController,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 14,
                              color: notifier.text,
                            ),
                            decoration: InputDecoration(
                              labelText: _isAddress ? "Contact Name" : (_isPickup ? "Sender's Name" : "Receiver's Name"),
                              labelStyle: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 13,
                                color: greaycolor,
                              ),
                              prefixIcon: Icon(Icons.person_outline_rounded, color: themeColor, size: 20),
                              filled: true,
                              fillColor: notifier.lightBgColor,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: notifier.bordecolor),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: notifier.bordecolor),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: themeColor, width: 1.5),
                              ),
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
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 14,
                              color: notifier.text,
                            ),
                            decoration: InputDecoration(
                              labelText: _isAddress ? "Contact Mobile" : (_isPickup ? "Sender's Mobile" : "Receiver's Mobile"),
                              labelStyle: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 13,
                                color: greaycolor,
                              ),
                              prefixIcon: Icon(Icons.phone_outlined, color: themeColor, size: 20),
                              // Pick from (and search) the phone book instead of typing.
                              suffixIcon: IconButton(
                                tooltip: 'Choose from phone book'.tr,
                                icon: Icon(Icons.contacts_rounded, color: themeColor, size: 22),
                                onPressed: _pickFromPhoneBook,
                              ),
                              filled: true,
                              fillColor: notifier.lightBgColor,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: notifier.bordecolor),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: notifier.bordecolor),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: themeColor, width: 1.5),
                              ),
                            ),
                          ),

                          // "Use my mobile number" Checkbox
                          if (_myMobile.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: () => _toggleUseMyNumber(null),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: Checkbox(
                                        value: _useMyNumber,
                                        activeColor: themeColor,
                                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                                        onChanged: (val) => _toggleUseMyNumber(val),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      "Use my mobile number ($_myMobile)",
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 12.5,
                                        color: notifier.text,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],

                          const SizedBox(height: 12),

                          // "Save as" chips (Home, Shop, Other)
                          Row(
                            children: [
                              Text(
                                "Save as: ",
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 12.5,
                                  color: greaycolor,
                                ),
                              ),
                              const SizedBox(width: 8),
                              _buildTagChip("Home", Icons.home_rounded, notifier, themeColor),
                              const SizedBox(width: 8),
                              _buildTagChip("Shop", Icons.storefront_rounded, notifier, themeColor),
                              const SizedBox(width: 8),
                              _buildTagChip("Other", Icons.location_on_rounded, notifier, themeColor),
                            ],
                          ),
                          const SizedBox(height: 8),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 8),

                  // Pinned Confirm and Proceed Button (always above navigation bar)
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isSavingAddress ? null : _confirmAndProceed,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: themeColor,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: _isSavingAddress
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                            )
                          : Text(
                              _isAddress
                                  ? "Save Address"
                                  : (_isPickup
                                      ? "Confirm & Continue"
                                      : (_isDrop ? "Confirm & Proceed to Vehicles" : "Confirm Stop")),
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 16,
                                color: Colors.white,
                              ),
                            ),
                    ),
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
    final isSelected = _selectedTag == label;
    return InkWell(
      onTap: () => setState(() => _selectedTag = label),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? themeColor.withOpacity(0.12) : notifier.lightBgColor,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isSelected ? themeColor : notifier.bordecolor,
            width: 1.2,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 15,
              color: isSelected ? themeColor : notifier.text,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontFamily: isSelected ? 'Gilroy_Bold' : 'Gilroy_Medium',
                fontSize: 12.5,
                color: isSelected ? themeColor : notifier.text,
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
