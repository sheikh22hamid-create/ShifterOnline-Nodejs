import 'dart:developer';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/authscreen/signin.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import '../colors.dart';

//================================ Custome Button ============================

appButton({VoidCallback? onTap, String? tital}) {
  return InkWell(
    onTap: onTap,
    child: Container(
      height: Get.height / 18,
      width: Get.width / 1.2,
      decoration: BoxDecoration(
        color: const Color(0xfffa5700),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Center(
        child: Text(
          tital!,
          style: TextStyle(
            color: whitecolor,
            fontSize: Get.height / 50,
            fontFamily: 'Gilroy_Medium',
          ),
        ),
      ),
    ),
  );
}

appButton1({
  Function()? onTap,
  String? tital,
  Color? buttonbgColor,
  Color? textColor,
  Color? bordecolor,
}) {
  return InkWell(
    onTap: onTap,
    child: Container(
      height: 55,
      width: Get.width - 20,
      decoration: BoxDecoration(
        color: buttonbgColor ?? linercolor,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: bordecolor ?? linercolor,
        ),
      ),
      child: Center(
        child: Text(
          tital!,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: textColor ?? whitecolor,
            fontSize: 16,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
      ),
    ),
  );
}
//================================ Appbar ============================

appbar({required String tital, List<Widget>? actions}) {
  return AppBar(
    title: Text(
      tital,
      style: TextStyle(
        color: whitecolor,
        fontFamily: "Gilroy_Bold",
      ),
    ),
    centerTitle: true,
    elevation: 0,
    backgroundColor: linercolor,
    actions: actions,
  );
}

//================================ customtextfild ============================

Widget textfild({
  String? hintText,
  String? labelText,
  double? widtht,
  TextInputType? keyboardType,
  TextInputAction? textInputAction,
  TextEditingController? controller,
  ScrollController? scrollController,
  InputBorder? border,
  InputBorder? focusedBorder,
  Color? fillColor,
  Widget? suffixIcon,
  Widget? prefixIcon,
  void Function(String)? onChanged,
  void Function(String?)? onSaved,
  List<TextInputFormatter>? inputFormatters,
  String? Function(String?)? validator,
}) {
  return TextFormField(
    textCapitalization: TextCapitalization.words,
    cursorColor: notifier.darklinercolor,
    scrollController: scrollController,
    controller: controller,
    autofocus: false,
    textInputAction: textInputAction,
    keyboardType: keyboardType,
    onChanged: onChanged,
    onSaved: onSaved,
    validator: validator,
    style: TextStyle(
      fontSize: 15,
      color: notifier.text,
      fontFamily: 'Gilroy_Bold',
    ),
    inputFormatters: inputFormatters,
    decoration: InputDecoration(
      hintText: hintText,
      contentPadding: EdgeInsets.symmetric(horizontal: 10),
      filled: true,
      fillColor: fillColor ?? Colors.transparent,
      hintStyle: TextStyle(
        color: greaycolor,
        fontSize: 15,
        fontFamily: "Gilroy_Regular",
      ),
      labelText: labelText,
      labelStyle: TextStyle(
        color: notifier.darklinercolor,
        fontSize: 15,
        fontFamily: "Gilroy_Regular",
      ),
      suffixIcon: suffixIcon,
      prefixIcon: prefixIcon,
      border: border ?? OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(color: notifier.bordecolor),
      ),
      focusedBorder: focusedBorder ??  OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(
          color: notifier.darklinercolor,
        )
      ),
      enabledBorder: border ?? OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(color: notifier.bordecolor),
      ),
    ),
  );
}

//================================ TextField ================================

myTextFormField({
  required String title,
  required String hintText,
  required TextEditingController controller,
  required TextInputType keyboardType,
  bool? obscureText,
  String? Function(String?)? validator,
  required Widget prefixIcon,
  Widget? suffixIcon,
  void Function(String)? onChanged,
  bool? readOnly,
}) {
  return Column(
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
      SizedBox(height: 5),
      TextFormField(
        readOnly: readOnly ?? false,
        textCapitalization: TextCapitalization.words,
        controller: controller,
        cursorColor: notifier.darklinercolor,
        keyboardType: keyboardType,
        onChanged: onChanged,
        validator: validator,
        autofocus: false,
        style: TextStyle(
          fontSize: 15,
          fontFamily: 'Gilroy_Medium',
          color: notifier.text,
        ),
        obscureText: obscureText ?? false,
        decoration: InputDecoration(
          contentPadding: EdgeInsets.zero,
          hintText: hintText,
          hintStyle: TextStyle(
            color: greaycolor.withOpacity(0.8),
            fontSize: 15,
            fontFamily: 'Gilroy_Medium',
          ),
          prefixIcon: prefixIcon,
          suffixIcon: suffixIcon,
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(15),
            borderSide: BorderSide(
              color: notifier.darklinercolor,
            ),
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(15),
            borderSide: BorderSide(
              color: notifier.bordecolor,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(15),
            borderSide: BorderSide(
              color: notifier.bordecolor,
            ),
          ),
        ),
      ),
    ],
  );
}

//! save data
save(key, val) {
  final data = GetStorage();
  data.write(key, val);
}

tostmsg(msg) {
  Fluttertoast.showToast(
    msg: msg,
    toastLength: Toast.LENGTH_SHORT,
    gravity: ToastGravity.BOTTOM,
    timeInSecForIosWeb: 1,
    backgroundColor: linercolor,
    textColor: Colors.white,
    fontSize: 16.0,
  );
}

Widget packagedetails({
  String? packagename,
  String? subtitel,
  String? items,
  Color? colors,
  titleColor,
  FontWeight? fontWeight,
}) {
  return Padding(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    child: Row(
      children: [
        Text(
          packagename!,
          style: TextStyle(
            fontWeight: fontWeight ?? FontWeight.normal,
            color: titleColor ?? notifier.text,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
        SizedBox(width: 5),
        Text(
          subtitel ?? "",
          style: TextStyle(
            fontWeight: fontWeight ?? FontWeight.normal,
            color: titleColor ?? greaycolor,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
        Spacer(),
        Text(
          items!,
          style: TextStyle(
            color: colors,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
      ],
    ),
  );
}

// ========================= get address ===========================
Future<String> getAddressFromLatLng(double latitude, double longitude) async {
  try {
    List<Placemark> placemarks = await placemarkFromCoordinates(latitude, longitude);

    if (placemarks.isNotEmpty) {
      Placemark place = placemarks.first;
      debugPrint("--------- place --------- $place");
      return "${place.street}${place.street == "" ? "" : ", "}${place.name == place.thoroughfare ? "" : "${place.name}${place.name == "" ? "" : ", "}"}${place.thoroughfare}${place.thoroughfare == "" ? "" : ", "}${place.subLocality}${place.subLocality == "" ? "" : ", "}${place.locality}${place.locality == "" ? "" : ", "}${place.administrativeArea}.";
    }
    return "No address found";
  } catch (e) {
    return "Error: $e";
  }
}

successfullBottomSheets(
  context, {
  required String tital,
  required String subtitle,
  required String buttonText,
  required VoidCallback ontap,
}) {
  try {
    notifier = Provider.of<ColorNotifier>(context, listen: false);
  } catch (_) {}
  return showModalBottomSheet(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      backgroundColor: notifier.lightBgColor,
      barrierColor: notifier.text.withOpacity(0.3),
      isDismissible: false,
      isScrollControlled: true,
      context: context,
      builder: (context) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(20),
                    topRight: Radius.circular(20),
                  ),
                  child: Center(
                    child: Image.asset(
                      "assets/bottom_bg.png",
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    SizedBox(height: Get.height / 80),
                    Center(
                      child: Container(
                        height: Get.height / 80,
                        width: Get.width / 5,
                        decoration: BoxDecoration(
                          color: greaycolor.withOpacity(0.4),
                          borderRadius: const BorderRadius.all(Radius.circular(20)),
                        ),
                      ),
                    ),
                    SizedBox(height: Get.height / 3.5),
                    Text(
                      tital,
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
                        fontSize: Get.height / 40,
                      ),
                    ),
                    SizedBox(height: Get.height / 30),
                    Column(
                      children: [
                        SizedBox(
                          width: Get.width / 1.2,
                          child: Text(
                            subtitle,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: greaycolor.withOpacity(0.8),
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 15,
                            ),
                          ),
                        ),
                        SizedBox(height: Get.height /20),
                        appButton(
                          tital: buttonText,
                          onTap: ontap,
                        ),

                        SizedBox(height: Get.height /36),

                      ],
                    ),
                  ],
                ),
              ],
            ),
          ],
        );
      });
}

double? currentLat;
double? currentLong;

Future<Position> customGetLatLong() async {
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

Future<LatLng> customGetCurrentData() async {
  Position position = await customGetLatLong();
  debugPrint("========= position ========= $position");
  currentLat = position.latitude;
  currentLong = position.longitude;
  return LatLng(currentLat ?? 0, currentLong ?? 0);
}

Future forgorPasswordBottomsheet(context, {required String mobile}) {
  bool newPassword = true;
  bool conformPassword = true;

  TextEditingController newPasswordController = TextEditingController();
  TextEditingController conformPasswordController = TextEditingController();

  bool isLoding = false;

  notifier = Provider.of(context, listen: false);

  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.only(
        topRight: Radius.circular(20),
        topLeft: Radius.circular(20),
      ),
    ),
    barrierColor: notifier.text.withOpacity(0.3),
    backgroundColor: notifier.lightBgColor,
    enableDrag: true,
    builder: (context) {
      return StatefulBuilder(builder: (context, setState) {
        return Container(
          width: Get.width,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
          decoration: const BoxDecoration(),
          child: Padding(
            padding: MediaQuery.of(context).viewInsets,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Center(
                  child: Text(
                    "Creat New Password".tr,
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: "Gilroy_Bold",
                      fontSize: 20,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8.0),
                  child: Divider(color: greaycolor),
                ),
                myTextFormField(
                  title: "New Password".tr,
                  hintText: "New Password".tr,
                  obscureText: newPassword,
                  controller: newPasswordController,
                  keyboardType: TextInputType.visiblePassword,
                  prefixIcon: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Image.asset(
                      "assets/lock.png",
                      height: 20,
                    ),
                  ),
                  suffixIcon: IconButton(
                    icon: Icon(
                      newPassword ? Icons.visibility : Icons.visibility_off,
                      color: notifier.darklinercolor,
                    ),
                    onPressed: () {
                      setState(() {
                        newPassword = !newPassword;
                      });
                    },
                  ),
                ),
                const SizedBox(height: 20),
                myTextFormField(
                  title: "Password".tr,
                  hintText: "Enter your password".tr,
                  obscureText: conformPassword,
                  controller: conformPasswordController,
                  keyboardType: TextInputType.visiblePassword,
                  prefixIcon: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Image.asset(
                      "assets/lock.png",
                      height: 20,
                    ),
                  ),
                  suffixIcon: IconButton(
                    icon: Icon(
                      conformPassword ? Icons.visibility : Icons.visibility_off,
                      color: notifier.darklinercolor,
                    ),
                    onPressed: () {
                      setState(() {
                        conformPassword = !conformPassword;
                      });
                    },
                  ),
                ),
                const SizedBox(height: 20),
                isLoding
                    ? Container(
                        width: Get.width,
                        height: Get.height / 16,
                        decoration: BoxDecoration(
                          color: linercolor,
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Center(
                          child: SpinKitThreeBounce(color: whitecolor, size: 25.0),
                        ),
                      )
                    : Container(
                        decoration: BoxDecoration(),
                        width: Get.width,
                        child: appButton(
                          onTap: () {
                            if (newPasswordController.value == conformPasswordController.value) {
                              isLoding = true;
                              setState(() {});
                              Map<String, dynamic> body = {
                                "mobile": mobile,
                                "password": newPasswordController.text,
                              };
                              ApiWrapper.dataPostNode(Config.nodeForgotPassword, body).then((value) {
                                if ((value != null) && (value.isNotEmpty)) {
                                  if ((value['ResponseCode'] == "200") &&
                                      (value['Result'] == "true")) {
                                    Get.back();
                                    successfullBottomSheets(
                                      context,
                                      tital: "Recovery password Successfully",
                                      subtitle: "Please login again to get started.".tr,
                                      buttonText: "Go To Sign In",
                                      ontap: () {
                                        Get.offAll(SignIn(paymenttype: "onboarding"));
                                      },
                                    );
                                    tostmsg(value["ResponseMsg"]);
                                    isLoding = false;
                                    setState(() {});
                                  } else {
                                    log(value.toString());
                                    tostmsg(value["ResponseMsg"]);
                                    isLoding = false;
                                    setState(() {});
                                  }
                                } else {
                                  isLoding = false;
                                  setState(() {});
                                }
                              });
                            } else {
                              tostmsg("Check ConformPassword.");
                            }
                          },
                          tital: "CONTINUE".tr,
                        ),
                      ),
              ],
            ),
          ),
        );
      });
    },
  );
}

addressCustomerdetails({
  String? name,
  String? number,
  Color? textColor,
}) {
  return Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      Expanded(
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: notifier.lightBgColor,
                shape: BoxShape.circle,
              ),
              child: Center(child: Icon(Icons.person, size: 15, color: notifier.darklinercolor)),
            ),
            SizedBox(width: Get.width / 40),
            Text(
              name ?? "",
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                color: textColor ?? notifier.text,
                fontFamily: "Gilroy_Medium",
              ),
            ),
          ],
        ),
      ),
      Expanded(
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: notifier.lightBgColor,
                shape: BoxShape.circle,
              ),
              child: Center(child: Icon(Icons.call, size: 15, color: notifier.darklinercolor)),
            ),
            SizedBox(width: Get.width / 40),
            Expanded(
              child: Text(
                number ?? "",
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  color: textColor ?? notifier.text,
                  fontFamily: "Gilroy_Medium",
                ),
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

tooltipComanText({
  required String text1,
  required String text2,
}) {
  return RichText(
    text: TextSpan(
      text: text1,
      style: TextStyle(
        fontFamily: 'Gilroy_Regular',
        color: whitecolor,
        fontSize: 12,
      ),
      children: <TextSpan>[
        TextSpan(
          text: text2,
          style: TextStyle(
            fontFamily: 'Gilroy_Medium',
          ),
        ),
      ],
    ),
  );
}
