// ignore_for_file: avoid_print, unnecessary_const, deprecated_member_use

import 'dart:developer';
import 'package:flutter_svg/svg.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'location_search_screen.dart';

class SelectAStore extends StatefulWidget {
  const SelectAStore({super.key});

  @override
  State<SelectAStore> createState() => _SelectAStoreState();
}

class _SelectAStoreState extends State<SelectAStore> {
  double? latitude = 0.0;
  double? longitude = 0.0;
  List nearbyList = [];

  @override
  void initState() {
    super.initState();
    getLatLong();
    getCurrentData();
  }

  nearbyStore(val) {
    debugPrint("============ value ============= $val");
    debugPrint("========== latitude ============ $latitude");
    debugPrint("========== longitude =========== $longitude");
    debugPrint("========= googleApikey ========= ${Config.googleApikey}");
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
      resizeToAvoidBottomInset: false,
      backgroundColor: linercolor,
      appBar: appbar(tital: "Select A Store".tr),
      body: Container(
        padding: EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Column(
          children: [
            seacrhfild(),
            nearbyList.isNotEmpty
              ? Expanded(
                  child: ListView.separated(
                    itemCount: nearbyList.length,
                    shrinkWrap: true,
                    padding: EdgeInsets.symmetric(vertical: 10),
                    physics: BouncingScrollPhysics(),
                    itemBuilder: (ctx, i) {
                      return InkWell(
                        onTap: () {
                          save("SelectStore", nearbyList[i]);
                          debugPrint("========= selctstore ======= ${getdata.read("SelectStore")}");
                          Get.back();
                          log(
                            nearbyList[i].toString(),
                            name: "Near By Store :",
                          );
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
                    }, separatorBuilder: (BuildContext context, int index) { 
                      return SizedBox(height: 10);
                    },
                  ),
                )
                : Column(
                    children: [
                      SizedBox(height: 10),
                      Text(
                        "OR".tr,
                        style: TextStyle(
                          color: greaycolor,
                          fontSize: 20,
                          fontFamily: 'Gilroy_Medium',
                        ),
                      ),
                      SizedBox(height: 10),
                      InkWell(
                        onTap: () => Get.to(() => const LocationSearchScreen(locationType: "Store")),
                        child: Container(
                          padding: EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: notifier.getBgColor,
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Row(
                            children: [
                              Image.asset(
                                "assets/Locationgreay.png",
                                height: 24,
                                color: notifier.darklinercolor,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  "Set location of the store on Map".tr,
                                  style: TextStyle(
                                    color: notifier.darklinercolor,
                                    fontSize: 16,
                                    fontFamily: 'Gilroy_Medium',
                                  ),
                                ),
                              ),
                              Icon(
                                Icons.arrow_forward_ios,
                                size: 17,
                                color: notifier.darklinercolor,
                              ),
                            ],
                          ),
                        ),
                      ),
                      SizedBox(height: 30),
                      Container(
                        padding: EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: greencolor.withOpacity(0.10),
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Row(
                          children: [
                            Image.asset(
                              "assets/message-time.png",
                              height: 40,
                            ),
                            SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                "Please call the store to check the opening times and in-store availability before ordering.".tr,
                                style: TextStyle(
                                  fontSize: 16,
                                  fontFamily: 'Gilroy_Medium',
                                  color: greencolor,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
          ],
        ),
      ),
    );
  }

  Widget seacrhfild() {
    Future.delayed(const Duration(seconds: 0), () {
      setState(() {});
    });
    return textfild(
      fillColor: notifier.getBgColor,
      hintText: "Search by store name or type".tr,
      prefixIcon: InkWell(
        onTap: () {},
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: SvgPicture.asset(
            "assets/search.svg",
            height: 25,
            color: notifier.darklinercolor,
          ),
        ),
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(
          color: notifier.bordecolor,
        ),
      ),
      onChanged: (val) {
        val == "" ? nearbyList.clear() : nearbyStore(val);
      },
    );
  }

  Future<void> getCurrentData() async {
    Position position = await getLatLong();
    latitude = position.latitude;
    longitude = position.longitude;
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
    return await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high);
  }
}
