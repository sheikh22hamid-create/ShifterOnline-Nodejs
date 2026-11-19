// ignore_for_file: deprecated_member_use, prefer_typing_uninitialized_variables

import 'dart:async';
import 'dart:developer';
import 'dart:io';
import 'package:flutter_svg/svg.dart';
import 'package:goParcel/Api/config.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class MapSearch extends StatefulWidget {
  const MapSearch({super.key});

  @override
  State<MapSearch> createState() => _MapSearchState();
}

class _MapSearchState extends State<MapSearch> {
  final storeAddress = TextEditingController();
  double? latitude = 0.0;
  double? longitude = 0.0;
  List nearbyList = [];
  var location;
  bool hidebutton = false;
  String? currentAddress;
  CameraPosition? _kGooglePlex;
  Map<MarkerId, Marker> markers = <MarkerId, Marker>{};
  LatLng lastLatLng = const LatLng(0.0, 0.0);
  final Completer<GoogleMapController> _controller = Completer();
  BitmapDescriptor? pinLocationIcon;

  @override
  void initState() {
    super.initState();
    debugPrint("============== currentLat :---- $currentLat");
    debugPrint("============== currentLong :---- $currentLong");
    if (currentLat != null && currentLong != null) {
      latitude = currentLat ?? 0;
      longitude = currentLong ?? 0;
      setState(() {});
    debugPrint("============== latitude :---- $latitude");
    debugPrint("============= longitude :---- $longitude");
      getCurrentMap(LatLng(latitude!, longitude!));
    } else {
      getCurrentData(); 
    }
    setCustomMapPin();
  }

  nearbyStore(val) {
    nearbyList.clear();
    var url = Uri.parse("https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=$latitude,$longitude&radius=2500&keyword=$val&key=${Config.googleApikey}");

    ApiWrapper.dataGetLocation(url).then((val) {
      nearbyList = val["results"];
      log(val["results"].toString(), name: "Near By Location data List");
    });
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        elevation: 0,
        centerTitle: true,
        titleSpacing: 0,
        backgroundColor: linercolor,
        title: ktextfield(),
      ),
      body: Stack(
        children: [
          Container(
            decoration: BoxDecoration(
              color: notifier.lightBgColor,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(24),
                topRight: Radius.circular(24),
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(24),
                topRight: Radius.circular(24),
              ),
              child: GoogleMap(
                zoomControlsEnabled: false,
                mapType: MapType.normal,
                initialCameraPosition: _kGooglePlex ?? CameraPosition(target: lastLatLng, zoom: 16),
                markers: Set<Marker>.of(markers.values),
                onMapCreated: (GoogleMapController controller) {
                  _controller.complete(controller);
                },
                onTap: (latLag) {
                  log(latLag.toString(), name: "latlong : ");
                  debugPrint("============== latitude :---- ${latLag.latitude}");
                  debugPrint("============= longitude :---- ${latLag.longitude}");
                  latitude = latLag.latitude;
                  longitude = latLag.longitude;
                  setState(() {});
                  getCurrentMap(latLag);
                },
              ),
            ),
          ),
          nearbyList.isNotEmpty
            ? ListView.separated(
              itemCount: nearbyList.length,
              shrinkWrap: true,
              physics: BouncingScrollPhysics(),
              padding: EdgeInsets.symmetric(horizontal: 15, vertical: 10),
              itemBuilder: (ctx, i) {
                return InkWell(
                  onTap: () {
                    FocusScope.of(context).requestFocus(FocusNode());
                    hidebutton = true;
                    storeAddress.text = nearbyList[i]["name"];
                    latitude = nearbyList[i]["geometry"]["location"]["lat"];
                    longitude = nearbyList[i]["geometry"]["location"]["lng"];
                    LatLng lastLatLngstore = LatLng(
                      double.parse(latitude.toString()),
                      double.parse(longitude.toString()),
                    );
                    debugPrint("============== latitude :---- $latitude");
                    debugPrint("============= longitude :---- $longitude");
                    
                    getCurrentMap(lastLatLngstore);
                    location = nearbyList[i];
                    Future.delayed(Duration(seconds: 1), () {
                      setState(() {});
                      nearbyList.clear();
                    });
                  },
                  child: Container(
                    padding: EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: notifier.getBgColor,
                      borderRadius: BorderRadius.circular(15)
                    ),
                    child: Row(
                      children: [
                        Container(
                          height: 60,
                          width: 60,
                          padding: EdgeInsets.all(13),
                          decoration: BoxDecoration(
                            color: notifier.isDark ? notifier.lightBgColor : notifier.getimag,
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Image.network("${nearbyList[i]["icon"]}"),
                        ),
                        SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                nearbyList[i]["name"],
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                ),
                              ),
                              Text(
                                nearbyList[i]["vicinity"],
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: greaycolor,
                                  fontFamily: 'Gilroy_Medium',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
              separatorBuilder: (BuildContext context, int index) => SizedBox(height: 10),
            )
            : const SizedBox(),
          hidebutton
            ? Positioned(
              bottom: 10,
              left: 10,
              right: 10,
              child: SizedBox(
                width: Get.width,
                child: appButton(
                  tital: "Set location".tr,
                  onTap: () {
                    save("SelectStore", location);
                    log(getdata.read("SelectStore").toString(), name: "select Store");
                    Get.close(2);
                  },
                ),
              ),
            )
            : SizedBox()
        ],
      ),
    );
  }

  Future<void> getCurrentData() async {
    Position position = await getLatLong();
    latitude = position.latitude;
    longitude = position.longitude;
    getCurrentMap(LatLng(position.latitude, position.longitude));
  }

  Future<void> getCurrentMap(LatLng latLng) async {
    _kGooglePlex = CameraPosition(target: latLng, zoom: 16);
    const MarkerId markerId = MarkerId("markerIdVal");
    final Marker marker = Marker(
      markerId: markerId,
      position: latLng,
      icon: pinLocationIcon = await BitmapDescriptor.fromAssetImage(
        const ImageConfiguration(devicePixelRatio: 1000),
        'assets/map_pin.png',
      ),
      infoWindow: const InfoWindow(title: "", snippet: '*'),
      onTap: () {},
    );
    markers.clear();
    markers[markerId] = marker;

    // setCustomMapPin();
    GoogleMapController controller = await _controller.future;
    controller.animateCamera(
      CameraUpdate.newCameraPosition(
        CameraPosition(target: latLng, zoom: 16.0),
      ),
    );
    setState(() {});
    getAddressFromLatLong(latLng);
  }

  void setCustomMapPin() async {
    pinLocationIcon = await BitmapDescriptor.fromAssetImage(
      const ImageConfiguration(devicePixelRatio: 2.5),
      'assets/map_pin.png',
    );
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
      return Future.error('Location permissions are permanently denied, we cannot request permissions.');
    }
    return await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
  }

  Future<void> getAddressFromLatLong(LatLng latLng) async {
    lastLatLng = latLng;
    List<Placemark> placemarks = await placemarkFromCoordinates(latLng.latitude, latLng.longitude);
    if (placemarks.isNotEmpty) {
      Placemark place = placemarks[0];
      String name = place.name.toString();
      String thoroughfare = place.thoroughfare.toString();
      String area = place.subLocality.toString();
      String city = place.locality.toString();
      String state = place.administrativeArea.toString();
      String country = place.country.toString();
      currentAddress = "$name${(name.isNotEmpty) ? ", " : ""}$thoroughfare${(thoroughfare.isNotEmpty) ? ", " : ""}$area${(area.isNotEmpty) ? ", " : ""}$city${(city.isNotEmpty) ? ", " : ""}$state${(state.isNotEmpty) ? ", " : ""}$country.";
      setState(() {});
    }
  }

  Widget ktextfield() {
    Future.delayed(const Duration(seconds: 0), () => setState(() {}));

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 15),
      child: textfild(
        controller: storeAddress,
        fillColor: notifier.getBgColor,
        onChanged: (val) {
          debugPrint("--------- val -------- $val");
          debugPrint("--------- val runtimeType -------- ${val.runtimeType}");
          if (val.isEmpty || val == "") {
            setState(() {
              nearbyList.clear();
            });
          } else {
            nearbyStore(val);
          }
        },
        hintText: "Search by store name or type".tr,
        prefixIcon: Padding(
          padding: EdgeInsets.all(12),
          child: InkWell(
            onTap: () => Get.back(),
            child: Icon(
              Platform.isIOS ? Icons.arrow_back_ios : Icons.arrow_back,
              color: notifier.darklinercolor,
            ),
          )
        ),
        suffixIcon: Padding(
          padding: const EdgeInsets.all(12),
          child: SvgPicture.asset(
            "assets/search.svg",
            color: notifier.darklinercolor,
            height: 20,
          ),
        ),
      ),
    );
  }
}
