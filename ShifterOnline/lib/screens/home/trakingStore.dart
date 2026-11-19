// ignore_for_file: file_names, deprecated_member_use, unused_local_variable, prefer_typing_uninitialized_variables

import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:dotted_line/dotted_line.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/AppDataBase/BuyAnything.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/chatscreen.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_phone_direct_caller/flutter_phone_direct_caller.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart' as sql;

import 'home.dart';

class ItemListDelet {
  static Future<Database> database() async {
    final dbPath = await sql.getDatabasesPath();
    return sql.openDatabase(path.join(dbPath, 'byanything.db'), version: 1);
  }
}

//! -------- buy Anithing order Page -------
class TrakingStore extends StatefulWidget {
  final String? type;
  const TrakingStore({super.key, this.type});

  @override
  State<TrakingStore> createState() => _TrakingStoreState();
}

class _TrakingStoreState extends State<TrakingStore> {
  final sql = Additemlist();

  // Polling / retry control
  Timer? _pollTimer;
  int _pollAttempts = 0;
  final int _maxPollAttempts = 24; // e.g., 24 attempts * 5s = 2 minutes
  final Duration _pollInterval = Duration(seconds: 5);
  bool _showWaitingOverlay = false;


  String? currentAddress;
  CameraPosition? kGooglePlex;

  final Completer<GoogleMapController> _controller = Completer();
  BitmapDescriptor? pinLocationIcon;
  var buyMapinfo;

  //!
  PolylinePoints polylinePoints = PolylinePoints();
  Set<Marker> markers = {}; //markers for google map

  Map<PolylineId, Polyline> polylines = {}; //polylines to show direction
  int polylineindex = 0;

  double distance = 0.0;
  LatLng startLocation = LatLng(0.0, 0.0);
  LatLng endLocation = LatLng(0.0, 0.0);
  bool maprefresh = false;
  bool isLoading = false;
  bool orderStep = false;
  bool riderlive = false;

  @override
  void initState() {
    super.initState();
    buyMapinfoget();
    debugPrint("========= Order Type ========= ${widget.type}");
    setState(() {});
  }

  // Safe parsing helper
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

  // Adjust camera to fit pickup, drop, and polyline
  Future<void> setCameraBounds(List<LatLng> polylineCoordinates) async {
    if (polylineCoordinates.isEmpty) return;

    LatLngBounds bounds;
    double southWestLat, southWestLng, northEastLat, northEastLng;

    southWestLat = northEastLat = polylineCoordinates.first.latitude;
    southWestLng = northEastLng = polylineCoordinates.first.longitude;

    for (LatLng latLng in polylineCoordinates) {
      if (latLng.latitude < southWestLat) southWestLat = latLng.latitude;
      if (latLng.latitude > northEastLat) northEastLat = latLng.latitude;
      if (latLng.longitude < southWestLng) southWestLng = latLng.longitude;
      if (latLng.longitude > northEastLng) northEastLng = latLng.longitude;
    }

    bounds = LatLngBounds(
      southwest: LatLng(southWestLat, southWestLng),
      northeast: LatLng(northEastLat, northEastLng),
    );

    final GoogleMapController controller = await _controller.future;
    controller.animateCamera(
        CameraUpdate.newLatLngBounds(bounds, 100)); // 100 = padding
  }

  Future<void> getCurrentMap(LatLng latLng) async {
    kGooglePlex = CameraPosition(target: latLng, zoom: 16);
    const MarkerId markerId = MarkerId("markerIdVal");
    final Marker marker = Marker(
      markerId: markerId,
      position: latLng,
      icon: pinLocationIcon = await BitmapDescriptor.fromAssetImage(
        ImageConfiguration(devicePixelRatio: 1000),
        'assets/map_pin.png',
      ),
      infoWindow: const InfoWindow(title: "", snippet: '*'),
      onTap: () {},
    );
    setCustomMapPin();
    GoogleMapController controller = await _controller.future;
    controller.animateCamera(
      CameraUpdate.newCameraPosition(
        CameraPosition(target: latLng, zoom: 16),
      ),
    );
    setState(() {});
    getAddressFromLatLong(latLng);
  }

  void setCustomMapPin() async {
    pinLocationIcon = await BitmapDescriptor.fromAssetImage(
        ImageConfiguration(devicePixelRatio: 2.5), 'assets/map_pin.png');
  }

  Future<Position> getLatLong() async {
    bool serviceEnabled;
    LocationPermission permission;
    serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await Geolocator.openLocationSettings();
      return Future.error('Location services are disabled.');
    }
    permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return Future.error('Location permissions are denied');
      }
    }
    if (permission == LocationPermission.deniedForever) {
      return Future.error(
          'Location permissions are permanently denied, we cannot request permissions.');
    }
    return await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high);
  }

  Future<void> getAddressFromLatLong(LatLng latLng) async {
    List<Placemark> placemarks = await placemarkFromCoordinates(
        latLng.latitude, latLng.longitude);
    if (placemarks.isNotEmpty) {
      Placemark place = placemarks[0];
      String name = place.name.toString();
      String thoroughfare = place.thoroughfare.toString();
      String area = place.subLocality.toString();
      String city = place.locality.toString();
      String state = place.administrativeArea.toString();
      String country = place.country.toString();
      currentAddress =
      "$name${(name.isNotEmpty) ? ", " : ""}$thoroughfare${(thoroughfare
          .isNotEmpty) ? ", " : ""}$area${(area.isNotEmpty)
          ? ", "
          : ""}$city${(city.isNotEmpty) ? ", " : ""}$state${(state.isNotEmpty)
          ? ", "
          : ""}$country.";
      setState(() {});
    }
  }

  @override
  Future<void> dispose() async {
    // Cancel polling timer if active
    if (_pollTimer != null && _pollTimer!.isActive) {
      _pollTimer!.cancel();
      _pollTimer = null;
    }

    if (_controller.isCompleted) {
      final GoogleMapController controller = await _controller.future;
      controller.dispose();
    }
    startLocation = LatLng(0.0, 0.0);
    endLocation = LatLng(0.0, 0.0);
    super.dispose();
  }


  getRiderDetails(rid) {
    Stream? documentStream = FirebaseFirestore.instance
        .collection('RiderParcel')
        .doc('$rid')
        .snapshots(includeMetadataChanges: true);
    debugPrint("--------- documentStream ---------- $documentStream");
    return documentStream;
  }

  getDirections() async {
    // if start or end are invalid (0,0) don't call routing
    if ((startLocation.latitude == 0.0 && startLocation.longitude == 0.0) ||
        (endLocation.latitude == 0.0 && endLocation.longitude == 0.0)) {
      debugPrint('getDirections skipped: invalid start/end');
      return;
    }

    List<LatLng> polylineCoordinates = [];
    PolylineResult result = await polylinePoints.getRouteBetweenCoordinates(
      Config.googleApikey,
      PointLatLng(startLocation.latitude, startLocation.longitude),
      PointLatLng(endLocation.latitude, endLocation.longitude),
      travelMode: TravelMode.driving,
    );

    if (result.points.isNotEmpty) {
      for (var point in result.points) {
        polylineCoordinates.add(LatLng(point.latitude, point.longitude));
      }
    } else {
      debugPrint(result.errorMessage);
    }
    double totalDistance = 0;
    for (var i = 0; i < polylineCoordinates.length - 1; i++) {
      totalDistance += calculateDistance(
        polylineCoordinates[i].latitude,
        polylineCoordinates[i].longitude,
        polylineCoordinates[i + 1].latitude,
        polylineCoordinates[i + 1].longitude,
      );
    }
    distance = totalDistance;
    addPolyLine(polylineCoordinates);

    // optionally fit camera
    if (polylineCoordinates.isNotEmpty) {
      await setCameraBounds(polylineCoordinates);
    }
  }

  addPolyLine(List<LatLng> polylineCoordinates) {
    PolylineId id = const PolylineId("poly");
    Polyline polyline = Polyline(
        polylineId: id,
        visible: true,
        color: linercolor,
        points: polylineCoordinates,
        width: 4);
    polylines[id] = polyline;
    setState(() {});
  }

  double calculateDistance(lat1, lon1, lat2, lon2) {
    var p = 0.017453292519943295;
    var a = 0.5 -
        cos((lat2 - lat1) * p) / 2 +
        cos(lat1 * p) * cos(lat2 * p) * (1 - cos((lon2 - lon1) * p)) / 2;
    return 12742 * asin(sqrt(a));
  }

  markone() async {
    markers = <Marker>{};
    if (startLocation.latitude != 0.0 || startLocation.longitude != 0.0) {
      markers.add(
        Marker(
            draggable: true,
            visible: true,
            markerId: MarkerId(startLocation.toString()),
            position: startLocation,
            icon: pinLocationIcon = await BitmapDescriptor.fromAssetImage(
                const ImageConfiguration(devicePixelRatio: 2.5),
                riderlive ? 'assets/lock2.png' : 'assets/map_pin.png'),
            infoWindow: InfoWindow(title: buyMapinfo != null
                ? (buyMapinfo["pick_type"] ?? "")
                : "")),
      );
    }
    setState(() {});
  }

  marktwo() async {
    if (endLocation.latitude != 0.0 || endLocation.longitude != 0.0) {
      markers.add(
        Marker(
          markerId: MarkerId(endLocation.toString()),
          position: endLocation,
          draggable: true,
          visible: true,
          infoWindow: InfoWindow(
              title: buyMapinfo != null ? (buyMapinfo["drop_type"] ?? "") : ""),
          icon: pinLocationIcon = await BitmapDescriptor.fromAssetImage(
            const ImageConfiguration(devicePixelRatio: 2.5),
            'assets/lock1.png',
          ),
        ),
      );
    }
    setState(() {});
  }

  sqlDBDelete() async {
    final db = await ItemListDelet.database();
    await db.rawQuery('DELETE FROM itemlist');
    sql.saveitemlist(id: DateTime.now().toString(), title: "", count: "1");
    sql.fetchitemlist();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        marktwo();
        startLocation;
        if (startLocation != LatLng(0.0, 0.0) && maprefresh == false) {
          getCurrentMap(startLocation);
          maprefresh = true;
        }
      }
    });
    notifier = Provider.of(context, listen: true);
    return WillPopScope(
      onWillPop: () async {
        if (widget.type == "OrderDone") {
          sqlDBDelete();
          Get.offAll(() => Bottombar());
        } else if (widget.type == "OrderPage") {
          Get.back();
        } else if (widget.type == "OrderPage1") {
          Get.back();
          Get.back();
        } else {
          Get.back();
        }
        return true;
      },
      child: Scaffold(
        backgroundColor: linercolor,
        appBar: AppBar(
          centerTitle: true,
          elevation: 0,
          backgroundColor: linercolor,
          title: Text(
            "Live Tracking".tr,
            style: TextStyle(
              color: whitecolor,
              fontFamily: "Gilroy_Bold",
            ),
          ),
          leading: InkWell(
            onTap: () {
              debugPrint(widget.type);
              if (widget.type == "OrderDone") {
                sqlDBDelete();
                Get.offAll(() => Bottombar());
              } else if (widget.type == "OrderPage") {
                Get.back();
              } else if (widget.type == "OrderPage1") {
                Get.back();
                Get.back();
              } else {
                Get.back();
              }
            },
            child: Icon(
                Platform.isIOS ? Icons.arrow_back_ios : Icons.arrow_back,
                color: whitecolor),
          ),
          actions: [
            Row(
              children: [
                InkWell(
                  onTap: buyMapinfoget,
                  child: Image.asset(
                    "assets/refresh.png",
                    height: 20,
                    color: whitecolor,
                  ),
                ),
                SizedBox(width: 10),
              ],
            ),
          ],
        ),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
        floatingActionButton: Container(
          width: Get.width,
          margin: EdgeInsets.all(10),
          decoration: BoxDecoration(),
          child: appButton(
            tital: "Order Details".tr,
            onTap: () {
              showModalBottomSheet(
                backgroundColor: notifier.lightBgColor,
                isScrollControlled: true,
                shape: RoundedRectangleBorder(
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
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        //! --------------- order Status ---------------
                        Text(
                          buyMapinfo != null
                              ? buyMapinfo["rest_msg"].toString()
                              : "",
                          style: TextStyle(
                            color: notifier.text,
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 16,
                          ),
                        ),
                        SizedBox(height: 5),
                        Text(
                          buyMapinfo != null
                              ? buyMapinfo["rider_msg"]
                              : "",
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: greaycolor.withOpacity(0.8),
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 14,
                          ),
                        ),
                        buyMapinfo != null && buyMapinfo["rider_img"] != "" &&
                            orderStep
                            ? SizedBox(height: 10)
                            : SizedBox(),
                        //!----------------- Rider boy Detail ---------------------
                        buyMapinfo != null && buyMapinfo["rider_img"] != "" &&
                            orderStep
                            ? Container(
                          padding: EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: notifier.getBgColor,
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Row(
                            children: [
                              Container(
                                height: 50,
                                width: 50,
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(50),
                                  color: Colors.grey.shade200,
                                  image: Config.isValidImageUrl(buyMapinfo["rider_img"])
                                      ? DecorationImage(
                                          image: NetworkImage(
                                            Config.resolveImageUrl(buyMapinfo["rider_img"]),
                                          ),
                                          fit: BoxFit.fill,
                                        )
                                      : null,
                                ),
                                child: !Config.isValidImageUrl(buyMapinfo["rider_img"])
                                    ? Icon(Icons.person, color: Colors.grey.shade600, size: 28)
                                    : null,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  buyMapinfo["rider_name"] ?? "",
                                  style: TextStyle(
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: Get.height / 55,
                                    color: notifier.text,
                                  ),
                                ),
                              ),
                              buyMapinfo["order_step"] != 0
                                  ? InkWell(
                                onTap: () async {
                                  await FlutterPhoneDirectCaller.callNumber(
                                      buyMapinfo["rider_mobile"]);
                                },
                                child: Container(
                                  padding: EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: notifier.lightBgColor,
                                  ),
                                  child: Center(
                                    child: Image.asset(
                                      "assets/fillcall.png",
                                      height: 25,
                                      color: linercolor,
                                    ),
                                  ),
                                ),
                              )
                                  : SizedBox(),
                              SizedBox(width: 10),
                              buyMapinfo["order_step"] != 0
                                  ? InkWell(
                                onTap: () async {
                                  Get.back();
                                  Get.to(
                                    Chat(
                                      receiverId: buyMapinfo["rider_id"],
                                      receiverMobile: buyMapinfo["rider_mobile"],
                                      receiverImage: buyMapinfo["rider_img"],
                                      receiverName: buyMapinfo["rider_name"],
                                    ),
                                  );
                                  debugPrint(
                                      "============= receiverId ========== ${buyMapinfo["rider_id"]}");
                                },
                                child: Container(
                                  padding: EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: notifier.lightBgColor,
                                  ),
                                  child: Center(
                                    child: Image.asset(
                                      "assets/msgnotification.png",
                                      height: 25,
                                      color: linercolor,
                                    ),
                                  ),
                                ),
                              )
                                  : SizedBox(),
                            ],
                          ),
                        )
                            : SizedBox(height: 10),
                        buyMapinfo != null && buyMapinfo["rider_img"] != "" &&
                            orderStep
                            ? SizedBox(height: 10)
                            : SizedBox(),
                        Container(
                          padding: EdgeInsets.all(
                            buyMapinfo != null &&
                                buyMapinfo["rider_img"] != "" && orderStep
                                ? 0
                                : 10,
                          ),
                          decoration: buyMapinfo != null &&
                              buyMapinfo["rider_img"] != "" && orderStep
                              ? BoxDecoration()
                              : BoxDecoration(
                            color: notifier.getBgColor,
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Row(
                            children: [
                              Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Image.asset(
                                    "assets/shop.png",
                                    height: 28,
                                    color: greaycolor,
                                  ),
                                  SizedBox(height: 3),
                                  DottedLine(
                                    dashGapLength: 5,
                                    lineThickness: 2,
                                    dashColor: greaycolor.withOpacity(0.4),
                                    dashGapColor: Colors.transparent,
                                    direction: Axis.vertical,
                                    lineLength: 45,
                                  ),
                                  SizedBox(height: 3),
                                  Image.asset(
                                    "assets/location_drop.png",
                                    height: 28,
                                    color: linercolor,
                                  ),
                                ],
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    //! ------------------ location 1 ----------------------
                                    Text(
                                      buyMapinfo == null
                                          ? ""
                                          : "${buyMapinfo["pick_name"]} - ${buyMapinfo["pick_type"]}",
                                      style: TextStyle(
                                        color: notifier.text,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 16,
                                      ),
                                    ),
                                    Text(
                                      buyMapinfo != null
                                          ? buyMapinfo["store_paddress"] ?? ""
                                          : "",
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.8),
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 13,
                                      ),
                                    ),
                                    SizedBox(height: 15),
                                    //! ------------------ location 2 ----------------------
                                    Text(
                                      buyMapinfo == null
                                          ? ""
                                          : "${buyMapinfo["drop_name"]} - ${buyMapinfo["drop_type"]}",
                                      style: TextStyle(
                                        color: notifier.text,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 16,
                                      ),
                                    ),
                                    Text(
                                      buyMapinfo != null
                                          ? buyMapinfo["customer_daddress"] ??
                                          ""
                                          : "",
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.8),
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 13,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        SizedBox(height: 10),
                        Container(
                          width: Get.width,
                          decoration: BoxDecoration(),
                          child: appButton(
                            tital: "Order Details".tr,
                            onTap: () {
                              Get.back();
                              Get.to(TrackingWay(
                                  type: "Store", uid0: getdata.read("Uid")));
                            },
                          ),
                        ),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
        body: Column(
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
            SizedBox(height: 10),
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: notifier.lightBgColor,
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(24),
                    topRight: Radius.circular(24),
                  ),
                ),
                child: Stack(
                  children: [

                    // Put this inside the Stack children after the GoogleMap widget
                    if (_showWaitingOverlay)
                      Positioned.fill(
                        child: Container(
                          color: Colors.black.withOpacity(0.35),
                          child: Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                CircularProgressIndicator(color: Colors.white),
                                SizedBox(height: 12),
                                Text(
                                  buyMapinfo != null &&
                                      buyMapinfo["rest_msg"] != null
                                      ? buyMapinfo["rest_msg"].toString()
                                      : "Waiting for delivery partner...",
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                      color: Colors.white, fontSize: 14),
                                ),
                                SizedBox(height: 6),
                                Text(
                                  "We will update the map as soon as coordinates are assigned.",
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                      color: Colors.white70, fontSize: 12),
                                ),
                                SizedBox(height: 12),
                                ElevatedButton(
                                  onPressed: () {
                                    // manual retry: stop old timer and call immediately
                                    if (_pollTimer != null &&
                                        _pollTimer!.isActive) _pollTimer!
                                        .cancel();
                                    _pollTimer = null;
                                    buyMapinfoget();
                                  },
                                  child: Text("Retry now".tr),
                                )
                              ],
                            ),
                          ),
                        ),
                      ),


                    //! -------------- GoogleMap -----------------
                    ClipRRect(
                      borderRadius: BorderRadius.only(
                        topLeft: Radius.circular(24),
                        topRight: Radius.circular(24),
                      ),
                      child: GoogleMap(
                        tiltGesturesEnabled: false,
                        zoomControlsEnabled: false,
                        myLocationButtonEnabled: false,
                        mapType: MapType.normal,
                        liteModeEnabled: false,
                        polylines: Set<Polyline>.of(polylines.values),
                        initialCameraPosition: CameraPosition(
                            target: startLocation, zoom: 14.0),
                        markers: markers,
                        onMapCreated: (GoogleMapController controller) {
                          setState(() {});
                          if (!_controller.isCompleted) _controller.complete(
                              controller);
                        },
                        onTap: (latLag) {
                          markone();
                          marktwo();
                        },
                      ),
                    ),
                    buyMapinfo != null && riderlive &&
                        (buyMapinfo["rider_id"] != null &&
                            buyMapinfo["rider_id"]
                                .toString()
                                .trim()
                                .isNotEmpty)
                        ? StreamBuilder(
                      stream: getRiderDetails(
                          int.tryParse(buyMapinfo["rider_id"].toString()) ?? 0),
                      builder: (context, AsyncSnapshot snapshot) {
                        if (snapshot.connectionState ==
                            ConnectionState.waiting) {
                          return CircularProgressIndicator(); // Optional: show loading
                        }

                        if (snapshot.hasError) {
                          // return Text("Error: ${snapshot.error}");
                          tostmsg("${snapshot.error}");
                          return Center(child: CircularProgressIndicator(
                              color: linercolor));
                        }

                        if (snapshot.hasData && snapshot.data.exists) {
                          final data = snapshot.data.data();
                          debugPrint("-------------- Rider data: $data");
                          debugPrint(
                              "============== Rider name: ${data["name"]}");

                          isLoading = true;
                          final lat = safeParseDouble(
                              data["lats"], treatZeroAsNull: false) ?? 0.0;
                          final lng = safeParseDouble(
                              data["logs"], treatZeroAsNull: false) ?? 0.0;
                          // only update if valid values exist
                          if (lat != 0.0 || lng != 0.0) {
                            startLocation = LatLng(lat, lng);
                            getDirections();
                            markone();
                          }
                          return SizedBox();
                        } else {
                          // tostmsg("Rider not Found!");
                          return SizedBox();
                        }
                      },
                    )
                        : SizedBox(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  buyMapinfoget() {
    // prevent multiple overlapping calls
    if (_pollTimer != null && _pollTimer!.isActive) {
      debugPrint('buyMapinfoget: poll already running, skipping manual call');
      return;
    }

    setState(() {
      isLoading = true;
      _showWaitingOverlay = false;
    });

    _pollAttempts = 0;

    Future<void> _callApiOnce() async {
      var orderid = getdata.read("OrderID") ?? "0";
      var data = {"orderid": orderid};
      try {
        final val = await ApiWrapper.dataPostNode(Config.nodeBuyMapInfo, data);
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200" || val['ResponseCode'] == 200) &&
              (val['Result'] == "true" || val['Result'] == true)) {
            buyMapinfo = val["BuyMapinfo"];
            debugPrint("buyMapinfoget: received BuyMapinfo => $buyMapinfo");

            final orderStepValue = (buyMapinfo["order_step"] is String)
                ? int.tryParse(buyMapinfo["order_step"]) ?? 0
                : (buyMapinfo["order_step"] is int
                ? buyMapinfo["order_step"]
                : 0);

            // parse coords safely
            final storePlat = safeParseDouble(val["BuyMapinfo"]["store_plat"]);
            final storePlong = safeParseDouble(
                val["BuyMapinfo"]["store_plong"]);
            final custDlat = safeParseDouble(
                val["BuyMapinfo"]["cust_address_dlat"]);
            final custDlong = safeParseDouble(
                val["BuyMapinfo"]["cust_address_dlong"]);

            // if we have coords, stop polling & update map
            final hasCoords = (storePlat != null && storePlong != null) ||
                (custDlat != null && custDlong != null);
            if (hasCoords && _pollTimer != null && _pollTimer!.isActive) {
              _pollTimer!.cancel();
              _pollTimer = null;
              debugPrint('buyMapinfoget: coords found -> polling stopped');
            }

            // set start/end as before, but safe
            if (storePlat != null && storePlong != null &&
                !(orderStepValue == 1 || orderStepValue == 7)) {
              startLocation = LatLng(storePlat, storePlong);
            }
            if (orderStepValue == 1) {
              if (storePlat != null && storePlong != null) {
                endLocation = LatLng(storePlat, storePlong);
              }
            } else {
              if (custDlat != null && custDlong != null) {
                endLocation = LatLng(custDlat, custDlong);
              }
            }

            // Update order/rider flags
            switch (orderStepValue) {
              case 0:
                orderStep = false;
                riderlive = false;
                break;
              case 1:
                riderlive = true;
                orderStep = true;
                break;
              default:
              // other states as before
                break;
            }

            // map updates only if we have at least one valid coordinate
            if ((startLocation.latitude != 0.0 ||
                startLocation.longitude != 0.0) ||
                (endLocation.latitude != 0.0 || endLocation.longitude != 0.0)) {
              if (startLocation.latitude != 0.0 ||
                  startLocation.longitude != 0.0) getCurrentMap(startLocation);
              if (!((startLocation.latitude == 0.0 &&
                  startLocation.longitude == 0.0) ||
                  (endLocation.latitude == 0.0 &&
                      endLocation.longitude == 0.0))) {
                getDirections();
              }
            }

            markone();
            marktwo();

            setState(() {
              isLoading = false;
              _showWaitingOverlay = !hasCoords && orderStepValue == 0;
            });

            // If no coords and order_step==0 -> start periodic polling
            if (!hasCoords && orderStepValue == 0) {
              // start periodic polling only if not already started
              if (_pollTimer == null || !_pollTimer!.isActive) {
                _pollAttempts = 0;
                _pollTimer = Timer.periodic(_pollInterval, (timer) async {
                  _pollAttempts++;
                  debugPrint('Polling attempt: $_pollAttempts');
                  if (_pollAttempts > _maxPollAttempts) {
                    // give up after max attempts
                    timer.cancel();
                    _pollTimer = null;
                    setState(() {
                      _showWaitingOverlay =
                      true; // keep overlay but show that attempts exhausted
                    });
                    debugPrint('Polling stopped: max attempts reached');
                    return;
                  }
                  // call API again
                  await _callApiOnce();
                });
                debugPrint('Polling started for BuyMapinfo every ${_pollInterval
                    .inSeconds}s');
              }
            } else {
              // got coords — ensure polling cancelled
              if (_pollTimer != null && _pollTimer!.isActive) {
                _pollTimer!.cancel();
                _pollTimer = null;
              }
              setState(() {
                _showWaitingOverlay = false;
              });
            }
          } else {
            // Response not success
            setState(() {
              isLoading = false;
            });
          }
        } else {
          setState(() {
            isLoading = false;
          });
        }
      } catch (e) {
        debugPrint('buyMapinfoget error: $e');
        setState(() {
          isLoading = false;
        });
      }
    }

    // initial call (do not trigger poll twice because function guards it)
    _callApiOnce();
  }
}

