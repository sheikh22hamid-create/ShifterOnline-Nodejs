import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:dotted_line/dotted_line.dart';
import 'package:flutter_phone_direct_caller/flutter_phone_direct_caller.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/chatscreen.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'home.dart';

class Tracklast extends StatefulWidget {
  final String? type;
  final String? uid;
  const Tracklast({super.key, this.type, this.uid});

  @override
  State<Tracklast> createState() => _TracklastState();
}

class _TracklastState extends State<Tracklast> {
  String? currentAddress;
  CameraPosition? kGooglePlex = CameraPosition(target: LatLng(0.0, 0.0), zoom: 14.0);

  final Completer<GoogleMapController> _controller = Completer();
  BitmapDescriptor? pinLocationIcon;

  PolylinePoints polylinePoints = PolylinePoints();
  Set<Marker> markers = {};

  Map<PolylineId, Polyline> polylines = {};
  double distance = 0.0;
  var buyMapinfo;
  bool maprefresh = false;
  bool isLoading = false;
  bool isLoadingmap = false;
  bool riderLive = false;
  String? uid;

  LatLng startLocation = const LatLng(0.0, 0.0);
  LatLng endLocation = const LatLng(0.0, 0.0);

  @override
  void initState() {
    super.initState();
    uid = widget.uid ?? (getdata?.read("Uid") ?? "");
    debugPrint("🚀 Tracklast init - type: ${widget.type} uid: $uid");
    mapinfo();
  }

  @override
  Future<void> dispose() async {
    polylines.clear();
    markers.clear();
    if (_controller.isCompleted) {
      try {
        final GoogleMapController controller = await _controller.future;
        controller.dispose();
      } catch (e) {
        debugPrint('❌ Controller dispose error: $e');
      }
    }
    super.dispose();
  }

  // ✅ FALLBACK: Direct HTTP call to Google Directions API and decode polyline
  Future<List<LatLng>?> getDirectionsViaHttp() async {
    try {
      debugPrint('🔄 Trying direct HTTP call to Directions API...');
      
      final origin = '${startLocation.latitude},${startLocation.longitude}';
      final destination = '${endLocation.latitude},${endLocation.longitude}';
      final url = Uri.parse(
        'https://maps.googleapis.com/maps/api/directions/json?'
        'origin=$origin&'
        'destination=$destination&'
        'mode=driving&'
        'key=${Config.googleApikey}'
      );
      
      debugPrint('   URL: ${url.toString().replaceAll(Config.googleApikey, 'API_KEY_HIDDEN')}');
      
      final response = await http.get(url);
      final data = jsonDecode(response.body);
      
      debugPrint('   HTTP Status: ${response.statusCode}');
      debugPrint('   API Status: ${data['status']}');
      
      if (data['status'] == 'OK' && data['routes'] != null && data['routes'].isNotEmpty) {
        final route = data['routes'][0];
        final encodedPolyline = route['overview_polyline']['points'];
        
        debugPrint('   ✅ Got encoded polyline: ${encodedPolyline.substring(0, 50)}...');
        
        // Decode polyline to get list of points
        final decodedPoints = polylinePoints.decodePolyline(encodedPolyline);
        
        debugPrint('   ✅ Decoded ${decodedPoints.length} points');
        
        // Convert to LatLng list
        List<LatLng> polylineCoordinates = [];
        for (var point in decodedPoints) {
          polylineCoordinates.add(LatLng(point.latitude, point.longitude));
        }
        
        return polylineCoordinates;
      } else {
        debugPrint('   ❌ API Error: ${data['status']} - ${data['error_message'] ?? 'Unknown error'}');
        return null;
      }
    } catch (e, stackTrace) {
      debugPrint('❌ HTTP fallback failed: $e');
      debugPrint('Stack: $stackTrace');
      return null;
    }
  }

  // Helper - safe parse double
  double? safeParseDouble(dynamic v, {bool treatZeroAsNull = true}) {
    try {
      if (v == null) return null;
      final s = v.toString().trim();
      if (s.isEmpty) return null;
      if (s.toLowerCase() == 'null') return null;
      final val = double.tryParse(s);
      if (val == null) return null;
      if (treatZeroAsNull && val == 0.0) return null;
      return val;
    } catch (e) {
      return null;
    }
  }

  getRiderDetails(rid) {
    try {
      return FirebaseFirestore.instance
          .collection('RiderParcel')
          .doc('$rid')
          .snapshots(includeMetadataChanges: true);
    } catch (e) {
      debugPrint('❌ getRiderDetails error: $e');
      return null;
    }
  }

  // ✅ FIXED: Old API syntax for flutter_polyline_points 1.0.0
  Future<void> getDirections() async {
    debugPrint('🎯 getDirections() CALLED');
    debugPrint('   Start: ${startLocation.latitude}, ${startLocation.longitude}');
    debugPrint('   End: ${endLocation.latitude}, ${endLocation.longitude}');
    
    // Must have valid start and end
    if ((startLocation.latitude == 0.0 && startLocation.longitude == 0.0) ||
        (endLocation.latitude == 0.0 && endLocation.longitude == 0.0)) {
      debugPrint('❌ getDirections SKIPPED - invalid start or end');
      debugPrint('   Start is (0,0): ${startLocation.latitude == 0.0 && startLocation.longitude == 0.0}');
      debugPrint('   End is (0,0): ${endLocation.latitude == 0.0 && endLocation.longitude == 0.0}');
      return;
    }

    // Check if start and end are same
    if (startLocation.latitude == endLocation.latitude &&
        startLocation.longitude == endLocation.longitude) {
      debugPrint('⚠️ Start and end locations are same');
      return;
    }

    try {
      isLoadingmap = true;
      if (mounted) setState(() {});

      List<LatLng> polylineCoordinates = [];

      debugPrint('🗺️ Fetching route from Google Directions API:');
      debugPrint('   From: ${startLocation.latitude}, ${startLocation.longitude}');
      debugPrint('   To: ${endLocation.latitude}, ${endLocation.longitude}');
      debugPrint('   API Key: ${Config.googleApikey.substring(0, 10)}...');

      // ✅ Google Directions API Call - Try package first
      PolylineResult result;
      List<LatLng>? httpPolylineCoordinates;
      
      try {
        result = await polylinePoints.getRouteBetweenCoordinates(
          Config.googleApikey,
          PointLatLng(startLocation.latitude, startLocation.longitude),
          PointLatLng(endLocation.latitude, endLocation.longitude),
          travelMode: TravelMode.driving,
        );
      } catch (e) {
        debugPrint('❌ Package API call failed: $e');
        // Fallback to direct HTTP call
        httpPolylineCoordinates = await getDirectionsViaHttp();
        if (httpPolylineCoordinates == null || httpPolylineCoordinates.isEmpty) {
          debugPrint('❌ Both API methods failed');
          isLoadingmap = false;
          if (mounted) setState(() {});
          return;
        }
        // Create dummy result for processing
        result = PolylineResult();
      }

      debugPrint('🔍 API Response:');
      debugPrint('   Status: ${result.status}');
      debugPrint('   Points received: ${result.points.length}');
      debugPrint('   Error: ${result.errorMessage ?? "None"}');

      // ✅ Check for errors first
      if (result.errorMessage != null && result.errorMessage!.isNotEmpty) {
        debugPrint('❌ API Error: ${result.errorMessage}');
        debugPrint('   Possible causes:');
        debugPrint('   1. Directions API not enabled in Google Cloud');
        debugPrint('   2. API Key missing Directions API permission');
        debugPrint('   3. Billing not enabled');
        debugPrint('   4. API Key restrictions blocking request');
        isLoadingmap = false;
        if (mounted) setState(() {});
        return;
      }

      // ✅ Decode actual route points from API
      if (httpPolylineCoordinates != null && httpPolylineCoordinates.isNotEmpty) {
        // Use HTTP fallback result
        polylineCoordinates = httpPolylineCoordinates;
        debugPrint('✅ Using HTTP fallback route: ${polylineCoordinates.length} coordinates');
      } else if (result.points.isNotEmpty) {
        debugPrint('✅ Decoding ${result.points.length} route points...');
        for (var point in result.points) {
          polylineCoordinates.add(LatLng(point.latitude, point.longitude));
        }
        debugPrint('✅ Route decoded: ${polylineCoordinates.length} coordinates');
      } else {
        debugPrint('❌ NO ROUTE POINTS - API returned empty result');
        debugPrint('   Status: ${result.status}');
        debugPrint('   Error: ${result.errorMessage ?? "No error message"}');
        debugPrint('   ⚠️ IMPORTANT: Enable Directions API in Google Cloud Console!');
        isLoadingmap = false;
        if (mounted) setState(() {});
        return;
      }
      
      if (polylineCoordinates.length >= 2) {
        debugPrint('   Route start: ${polylineCoordinates.first}');
        debugPrint('   Route end: ${polylineCoordinates.last}');
        debugPrint('   Route has ${polylineCoordinates.length} waypoints');
      }

      // Calculate total distance
      double totalDistance = 0.0;
      if (polylineCoordinates.length > 1) {
        for (var i = 0; i < polylineCoordinates.length - 1; i++) {
          totalDistance += calculateDistance(
            polylineCoordinates[i].latitude,
            polylineCoordinates[i].longitude,
            polylineCoordinates[i + 1].latitude,
            polylineCoordinates[i + 1].longitude,
          );
        }
      }
      distance = totalDistance;
      debugPrint('📏 Total distance: ${distance.toStringAsFixed(2)} km');

      // Clear old polylines and add new
      polylines.clear();
      debugPrint('🧹 Old polylines cleared');

      if (polylineCoordinates.isNotEmpty) {
        debugPrint('🎨 About to add polyline with ${polylineCoordinates.length} points');
        addPolyLine(polylineCoordinates);
        debugPrint('✅ addPolyLine() called. Current polylines count: ${polylines.length}');
        await setCameraBounds(polylineCoordinates);
        debugPrint('✅ Polyline should now be visible on map');
        debugPrint('   Total points in polyline: ${polylineCoordinates.length}');
        debugPrint('   Final polylines map size: ${polylines.length}');
      } else {
        debugPrint('❌ CRITICAL: Still no polyline coordinates to display');
        debugPrint('   polylineCoordinates.isEmpty = true');
      }

    } catch (e, stackTrace) {
      debugPrint('❌ getDirections exception: $e');
      debugPrint('Stack trace: $stackTrace');
      debugPrint('❌ Cannot draw route - API call failed');
      // ❌ NO FALLBACK - Only show actual route from Google
    } finally {
      isLoadingmap = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> setCameraBounds(List<LatLng> polylineCoordinates) async {
    if (polylineCoordinates.isEmpty) return;

    double swLat = polylineCoordinates.first.latitude;
    double swLng = polylineCoordinates.first.longitude;
    double neLat = polylineCoordinates.first.latitude;
    double neLng = polylineCoordinates.first.longitude;

    for (final p in polylineCoordinates) {
      if (p.latitude < swLat) swLat = p.latitude;
      if (p.latitude > neLat) neLat = p.latitude;
      if (p.longitude < swLng) swLng = p.longitude;
      if (p.longitude > neLng) neLng = p.longitude;
    }

    final bounds = LatLngBounds(
      southwest: LatLng(swLat, swLng),
      northeast: LatLng(neLat, neLng),
    );

    if (_controller.isCompleted) {
      try {
        final ctrl = await _controller.future;
        await ctrl.animateCamera(CameraUpdate.newLatLngBounds(bounds, 80));
        debugPrint('✅ Camera bounds set');
      } catch (e) {
        debugPrint('❌ setCameraBounds animate error: $e');
      }
    }
  }

  // ✅ ENHANCED: Better visibility with bright color for testing
  addPolyLine(List<LatLng> polylineCoordinates) {
    if (polylineCoordinates.isEmpty) {
      debugPrint('⚠️ Cannot add polyline - empty coordinates');
      return;
    }

    // ✅ FIX: Validate coordinates
    final validCoordinates = polylineCoordinates.where((coord) {
      return coord.latitude != 0.0 || coord.longitude != 0.0;
    }).toList();

    if (validCoordinates.isEmpty) {
      debugPrint('⚠️ No valid coordinates after filtering');
      return;
    }

    debugPrint('📍 Adding polyline:');
    debugPrint('   Points count: ${validCoordinates.length}');
    debugPrint('   First: ${validCoordinates.first.latitude}, ${validCoordinates.first.longitude}');
    debugPrint('   Last: ${validCoordinates.last.latitude}, ${validCoordinates.last.longitude}');

    final id = const PolylineId('poly');

    // ✅ ACTUAL ROUTE: Use bright blue color for Google Maps route
    final poly = Polyline(
      polylineId: id,
      color: const Color(0xFF4285F4), // Google Maps blue color
      width: 6, // Good visibility width
      points: validCoordinates,
      visible: true,
      geodesic: true, // CRITICAL: geodesic=true for actual road routes
      startCap: Cap.roundCap,
      endCap: Cap.roundCap,
      jointType: JointType.round,
      patterns: [], // Solid line (no dashes)
    );

    polylines[id] = poly;
    debugPrint('✅✅✅ Polyline object created and added to map ✅✅✅');
    debugPrint('   Polyline ID: ${id.value}');
    debugPrint('   Color: Google Blue (#4285F4)');
    debugPrint('   Width: 6');
    debugPrint('   Visible: true');
    debugPrint('   Geodesic: true (for actual road route)');
    debugPrint('   Points count: ${validCoordinates.length}');
    debugPrint('   Total polylines in map: ${polylines.length}');
    debugPrint('   Polylines keys: ${polylines.keys.map((k) => k.value).toList()}');
    debugPrint('   First 3 points: ${validCoordinates.take(3).map((p) => '(${p.latitude.toStringAsFixed(5)}, ${p.longitude.toStringAsFixed(5)})').join(', ')}');
    debugPrint('   Last 3 points: ${validCoordinates.skip(validCoordinates.length - 3).take(3).map((p) => '(${p.latitude.toStringAsFixed(5)}, ${p.longitude.toStringAsFixed(5)})').join(', ')}');

    // ✅ FIX: Force UI update
    if (mounted) {
      setState(() {
        // Explicitly update the state
      });
      debugPrint('✅ setState called - UI should update now');
      
      // ✅ FIX: Force map refresh by updating markers too
      Future.delayed(const Duration(milliseconds: 100), () {
        if (mounted) {
          setState(() {});
          debugPrint('✅ Delayed setState called for map refresh');
        }
      });
    }
  }

  double calculateDistance(lat1, lon1, lat2, lon2) {
    var p = 0.017453292519943295;
    var a = 0.5 -
        cos((lat2 - lat1) * p) / 2 +
        cos(lat1 * p) * cos(lat2 * p) * (1 - cos((lon2 - lon1) * p)) / 2;
    return 12742 * asin(sqrt(a));
  }

  markone() async {
    if (startLocation.latitude == 0.0 && startLocation.longitude == 0.0) {
      debugPrint('⚠️ markone skipped - invalid start location');
      return;
    }
    try {
      // ✅ Green icon for Pickup location
      final icon = BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen);
      markers.removeWhere((m) => m.markerId.value == 'start');
      markers.add(Marker(
        markerId: const MarkerId('start'),
        position: startLocation,
        icon: icon,
        infoWindow: InfoWindow(title: buyMapinfo?["pick_type"] ?? 'Pickup'),
      ));
      debugPrint('✅ Start marker (green) added at: ${startLocation.latitude}, ${startLocation.longitude}');
      if (mounted) setState(() {});
    } catch (e) {
      debugPrint('❌ markone error: $e');
    }
  }

  marktwo() async {
    if (endLocation.latitude == 0.0 && endLocation.longitude == 0.0) {
      debugPrint('⚠️ marktwo skipped - invalid end location');
      return;
    }
    try {
      // ✅ Red icon for Drop location
      final icon = BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed);
      markers.removeWhere((m) => m.markerId.value == 'end');
      markers.add(Marker(
        markerId: const MarkerId('end'),
        position: endLocation,
        icon: icon,
        infoWindow: InfoWindow(title: buyMapinfo?["drop_type"] ?? 'Drop'),
      ));
      debugPrint('✅ End marker (red) added at: ${endLocation.latitude}, ${endLocation.longitude}');
      if (mounted) setState(() {});
    } catch (e) {
      debugPrint('❌ marktwo error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    // ✅ FIX: Debug polyline state
    debugPrint('🗺️ Build called - Polylines: ${polylines.length}, Markers: ${markers.length}');
    debugPrint('   Start: ${startLocation.latitude}, ${startLocation.longitude}');
    debugPrint('   End: ${endLocation.latitude}, ${endLocation.longitude}');
    if (polylines.isNotEmpty) {
      polylines.forEach((key, value) {
        debugPrint('   ✅ Polyline ${key.value}: ${value.points.length} points, visible: ${value.visible}');
      });
    } else {
      debugPrint('   ⚠️ NO POLYLINES IN MAP - This is the problem!');
    }
    
    // ✅ FIX: Force getDirections if coordinates are valid but no polyline
    if (polylines.isEmpty && 
        startLocation.latitude != 0.0 && 
        endLocation.latitude != 0.0 &&
        !isLoadingmap) {
      debugPrint('🔄 No polyline found but coordinates are valid - calling getDirections()');
      Future.delayed(const Duration(milliseconds: 500), () {
        if (mounted && polylines.isEmpty) {
          getDirections();
        }
      });
    }
    
    // Delayed UI update
    Future.delayed(const Duration(seconds: 2), () {
      if (!mounted) return;
      marktwo();
      if (startLocation != const LatLng(0.0, 0.0) && !maprefresh) {
        getCurrentMap(startLocation);
        maprefresh = true;
      }
    });

    notifier = Provider.of(context, listen: true);

    return WillPopScope(
      onWillPop: () async {
        if (widget.type == "OrderDone") {
          if (mounted) {
            Get.offAll(Bottombar());
            getdata.remove("PickupAddress");
            getdata.remove("DropeAddress");
          }
        } else {
          Get.back();
        }
        return true;
      },
      child: Scaffold(
        backgroundColor: linercolor,
        appBar: AppBar(
          centerTitle: true,
          backgroundColor: linercolor,
          elevation: 0,
          title: Text(
            "Live Tracking".tr,
            style: TextStyle(color: whitecolor, fontFamily: 'Gilroy_Bold'),
          ),
          leading: InkWell(
            onTap: () {
              if (widget.type == "OrderDone") {
                if (mounted) {
                  Get.offAll(Bottombar());
                  getdata.remove("PickupAddress");
                  getdata.remove("DropeAddress");
                }
              } else {
                Get.back();
              }
            },
            child: Icon(
              Platform.isIOS ? Icons.arrow_back_ios : Icons.arrow_back,
              color: whitecolor,
            ),
          ),
          actions: [
            Row(children: [
              InkWell(
                onTap: mapinfo,
                child: !isLoading
                    ? Padding(
                  padding: const EdgeInsets.all(14),
                  child: Image.asset(
                    "assets/refresh.png",
                    color: whitecolor,
                    height: 20,
                  ),
                )
                    : Padding(
                  padding: const EdgeInsets.all(14),
                  child: loading(size: 20),
                ),
              ),
              const SizedBox(width: 10)
            ])
          ],
        ),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
        floatingActionButton: Container(
          width: Get.width,
          margin: const EdgeInsets.all(10),
          child: appButton(
            tital: "Order Details".tr,
            onTap: () {
              showModalBottomSheet(
                backgroundColor: notifier.lightBgColor,
                isScrollControlled: true,
                shape: const RoundedRectangleBorder(
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(20),
                    topRight: Radius.circular(20),
                  ),
                ),
                context: context,
                builder: (context) {
                  return Padding(
                    padding: const EdgeInsets.all(15),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          buyMapinfo != null ? buyMapinfo["rest_msg"].toString() : "",
                          style: TextStyle(
                            color: notifier.text,
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          buyMapinfo != null ? buyMapinfo["rider_msg"] ?? "" : "",
                          style: TextStyle(
                            color: greaycolor.withOpacity(0.8),
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          width: Get.width,
                          child: appButton(
                            tital: "Order Details".tr,
                            onTap: () {
                              Get.back();
                              Get.to(() => TrackingWay(type: "Pickup"));
                            },
                          ),
                        )
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Center(
              child: Text(
                "${"Order".tr} #${getdata.read("OrderID") ?? "0"}",
                style: TextStyle(
                  color: whitecolor.withOpacity(0.8),
                  fontFamily: 'Gilroy_Regular',
                  fontSize: 16,
                ),
              ),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: notifier.lightBgColor,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(24),
                    topRight: Radius.circular(24),
                  ),
                ),
                child: ClipRRect(
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(24),
                    topRight: Radius.circular(24),
                  ),
                  child: Stack(
                    alignment: Alignment.bottomCenter,
                    children: [
                      GoogleMap(
                        key: ValueKey('map_${polylines.length}_${markers.length}'), // Force rebuild when polylines change
                        tiltGesturesEnabled: false,
                        myLocationButtonEnabled: false,
                        zoomControlsEnabled: false,
                        mapType: MapType.normal,
                        liteModeEnabled: false,
                        polylines: Set<Polyline>.of(polylines.values),
                        initialCameraPosition: CameraPosition(
                          target: startLocation,
                          zoom: 14.0,
                        ),
                        markers: markers,
                        onMapCreated: (GoogleMapController controller) {
                          if (!_controller.isCompleted) {
                            _controller.complete(controller);
                            debugPrint('✅ Map controller completed');
                            debugPrint('   Polylines count: ${polylines.length}');
                            debugPrint('   Markers count: ${markers.length}');
                          }
                          if (mounted) setState(() {});
                        },
                        onTap: (latLag) {
                          markone();
                          marktwo();
                        },
                      ),
                      // Real-time rider tracking
                      riderLive &&
                          buyMapinfo != null &&
                          buyMapinfo["rider_id"] != null &&
                          buyMapinfo["rider_id"].toString().trim().isNotEmpty
                          ? StreamBuilder(
                        stream: getRiderDetails(
                          int.tryParse(buyMapinfo["rider_id"].toString()) ?? 0,
                        ),
                        builder: (context, AsyncSnapshot snapshot) {
                          if (snapshot.hasData && snapshot.data.exists) {
                            final data = snapshot.data.data();
                            final lat = safeParseDouble(
                              data["lats"],
                              treatZeroAsNull: false,
                            ) ?? 0.0;
                            final lng = safeParseDouble(
                              data["logs"],
                              treatZeroAsNull: false,
                            ) ?? 0.0;

                            if (lat != 0.0 || lng != 0.0) {
                              final newLocation = LatLng(lat, lng);

                              // Only update if location changed significantly (>10 meters)
                              if ((startLocation.latitude - lat).abs() > 0.0001 ||
                                  (startLocation.longitude - lng).abs() > 0.0001) {
                                startLocation = newLocation;
                                debugPrint('🚗 Rider location updated: $lat, $lng');
                                markone();

                                if (endLocation.latitude != 0.0 &&
                                    endLocation.longitude != 0.0) {
                                  debugPrint('🔄 Redrawing polyline with new rider position');
                                  getDirections();
                                }
                              }
                            }
                            return const SizedBox();
                          } else {
                            return const SizedBox();
                          }
                        },
                      )
                          : const SizedBox(),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> getCurrentMap(LatLng latLng) async {
    await setCustomMapPin();
    if (_controller.isCompleted) {
      try {
        GoogleMapController controller = await _controller.future;
        await controller.animateCamera(
          CameraUpdate.newCameraPosition(
            CameraPosition(target: latLng, zoom: 15),
          ),
        );
        debugPrint('✅ Camera moved to: ${latLng.latitude}, ${latLng.longitude}');
      } catch (e) {
        debugPrint('❌ getCurrentMap animate error: $e');
      }
    } else {
      kGooglePlex = CameraPosition(target: latLng, zoom: 15);
    }
    if (mounted) setState(() {});
    getAddressFromLatLong(latLng);
  }

  Future<void> setCustomMapPin() async {
    try {
      pinLocationIcon = await BitmapDescriptor.fromAssetImage(
        const ImageConfiguration(devicePixelRatio: 2.5),
        'assets/map_pin.png',
      );
    } catch (e) {
      debugPrint('❌ setCustomMapPin error: $e');
    }
  }

  Future<Position> getLatLong() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await Geolocator.openLocationSettings();
      return Future.error('Location services are disabled.');
    }
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return Future.error('Location permissions are denied');
      }
    }
    if (permission == LocationPermission.deniedForever) {
      return Future.error('Location permissions are permanently denied');
    }
    return await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
    );
  }

  Future<void> getAddressFromLatLong(LatLng latLng) async {
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(
        latLng.latitude,
        latLng.longitude,
      );
      if (placemarks.isNotEmpty) {
        final place = placemarks[0];
        currentAddress = "${place.name ?? ''}"
            "${(place.thoroughfare ?? '').isNotEmpty ? ', ${place.thoroughfare}' : ''}"
            "${(place.subLocality ?? '').isNotEmpty ? ', ${place.subLocality}' : ''}"
            "${(place.locality ?? '').isNotEmpty ? ', ${place.locality}' : ''}"
            "${(place.administrativeArea ?? '').isNotEmpty ? ', ${place.administrativeArea}' : ''}"
            "${(place.country ?? '').isNotEmpty ? ', ${place.country}' : ''}";
        if (mounted) setState(() {});
      }
    } catch (e) {
      debugPrint('❌ getAddressFromLatLong error: $e');
    }
  }

  Future getOrderApi() async {
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {"orderid": orderid};
    try {
      final response = await ApiWrapper.dataPostNode(Config.nodeMapInfo, data);
      if (response != null && response["ResponseCode"] == "200") {
        return response;
      } else {
        return [];
      }
    } catch (e) {
      debugPrint("❌ getOrderApi exception: $e");
      return null;
    }
  }

  mapinfo() async {
    setState(() {
      isLoading = true;
    });

    var orderid = getdata.read("OrderID") ?? "0";
    var data = {"orderid": orderid};

    debugPrint('📡 Fetching map info for order: $orderid');

    try {
      final val = await ApiWrapper.dataPostNode(Config.nodeMapInfo, data);

      if (val != null &&
          val.isNotEmpty &&
          (val['ResponseCode'] == "200" || val['ResponseCode'] == 200) &&
          (val['Result'] == "true" || val['Result'] == true)) {

        buyMapinfo = val["Mapinfo"];
        debugPrint('✅ Map info received');

        // Determine if rider is live
        final orderStepVal = (buyMapinfo["order_step"] is String)
            ? int.tryParse(buyMapinfo["order_step"]) ?? 0
            : (buyMapinfo["order_step"] is int ? buyMapinfo["order_step"] : 0);
        riderLive = (orderStepVal == 2 || orderStepVal == 3);
        debugPrint('🚗 Rider live: $riderLive (order_step: $orderStepVal)');

        // Parse coordinates
        final pickLat = safeParseDouble(val["Mapinfo"]["cust_address_plat"]);
        final pickLng = safeParseDouble(val["Mapinfo"]["cust_address_plong"]);
        final dropLat = safeParseDouble(val["Mapinfo"]["cust_address_dlat"]);
        final dropLng = safeParseDouble(val["Mapinfo"]["cust_address_dlong"]);

        debugPrint('📍 Pickup coordinates: $pickLat, $pickLng');
        debugPrint('📍 Drop coordinates: $dropLat, $dropLng');

        // ✅ startLocation = Pickup (green marker)
        if (pickLat != null && pickLng != null) {
          startLocation = LatLng(pickLat, pickLng);
          debugPrint('✅ Start (pickup) location set: $pickLat, $pickLng');
        } else {
          startLocation = const LatLng(0.0, 0.0);
          debugPrint('⚠️ Invalid pickup coordinates');
        }

        // ✅ endLocation = always Drop location (red marker)
        // For polyline: always draw pickup → drop
        // If order_step==2 (rider going to pickup), the polyline is rider→pickup (handled via Firebase)
        // For static map view, always show pickup→drop route
        if (dropLat != null && dropLng != null) {
          endLocation = LatLng(dropLat, dropLng);
          debugPrint('✅ End (drop) location set: $dropLat, $dropLng');
        } else {
          endLocation = const LatLng(0.0, 0.0);
          debugPrint('⚠️ Invalid drop coordinates');
        }

        // Update map if coordinates are valid
        if ((startLocation.latitude != 0.0 || startLocation.longitude != 0.0) ||
            (endLocation.latitude != 0.0 || endLocation.longitude != 0.0)) {

          if (startLocation.latitude != 0.0 || startLocation.longitude != 0.0) {
            await getCurrentMap(startLocation);
          }

          // Draw polyline if both start and end are valid
          debugPrint('🔍 Checking coordinates before calling getDirections:');
          debugPrint('   Start: ${startLocation.latitude}, ${startLocation.longitude}');
          debugPrint('   End: ${endLocation.latitude}, ${endLocation.longitude}');
          
          if (!((startLocation.latitude == 0.0 && startLocation.longitude == 0.0) ||
              (endLocation.latitude == 0.0 && endLocation.longitude == 0.0))) {
            debugPrint('🚀 CALLING getDirections() NOW...');
            await getDirections();
            debugPrint('✅ getDirections() completed. Polylines count: ${polylines.length}');
          } else {
            debugPrint('❌ Cannot draw polyline - invalid start/end coordinates');
            debugPrint('   Start is (0,0): ${startLocation.latitude == 0.0 && startLocation.longitude == 0.0}');
            debugPrint('   End is (0,0): ${endLocation.latitude == 0.0 && endLocation.longitude == 0.0}');
          }
        } else {
          debugPrint('⚠️ No valid coordinates found in Mapinfo');
        }

        await markone();
        await marktwo();

        setState(() {
          isLoading = false;
        });
      } else {
        debugPrint('❌ Invalid response from map API');
        setState(() {
          isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('❌ mapinfo exception: $e');
      setState(() {
        isLoading = false;
      });
    }
  }
}