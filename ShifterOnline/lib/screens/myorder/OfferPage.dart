// ignore_for_file: file_names, avoid_print, unnecessary_import, deprecated_member_use

import 'dart:convert';

import 'package:dotted_border/dotted_border.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/AppModelApi/couponlist_api_model.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';

import '../../Api/config.dart';
import '../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_html/flutter_html.dart';

import '../home/home.dart';

class OfferPage extends StatefulWidget {
  const OfferPage({super.key});

  @override
  State<OfferPage> createState() => _OfferPageState();
}

class _OfferPageState extends State<OfferPage> {
  dynamic bill = 0.0;
  @override
  void initState() {
    super.initState();
    getCouponList();
    setState(() {});
  }

  bool isLoding = true;

  CouponlistApiModel? couponlistApiModel;

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: appbar(tital: "Offers".tr),
      body: Container(
        height: Get.height,
        width: Get.width,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: isLoding
            ? Center(child: CircularProgressIndicator(color: notifier.darklinercolor))
            : (couponlistApiModel?.couponlist == null || couponlistApiModel!.couponlist!.isEmpty)
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.confirmation_num_outlined, size: 54, color: linercolor.withOpacity(0.7)),
                        const SizedBox(height: 14),
                        Text(
                          "No Offers Available",
                          style: TextStyle(
                            fontSize: 18,
                            color: notifier.text,
                            fontFamily: "Gilroy_Bold",
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          "Check back soon for new promotions and deals!",
                          style: TextStyle(
                            fontSize: 13,
                            color: greaycolor,
                            fontFamily: "Gilroy_Medium",
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    padding: EdgeInsets.all(15),
                    shrinkWrap: true,
                    itemCount: couponlistApiModel!.couponlist!.length,
                    physics: BouncingScrollPhysics(),
                    itemBuilder: (context, index) {
                      return Container(
                        padding: EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: notifier.getBgColor,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Config.isValidImageUrl(couponlistApiModel!.couponlist![index].cImg)
                                    ? Image.network(
                                        Config.resolveImageUrl(couponlistApiModel!.couponlist![index].cImg),
                                        height: 40,
                                        errorBuilder: (_, __, ___) => Icon(Icons.local_offer_outlined, color: linercolor, size: 36),
                                      )
                                    : Icon(Icons.local_offer_outlined, color: linercolor, size: 36),
                                Column(
                                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                                  children: [
                                    Text(
                                      "$currency${couponlistApiModel!.couponlist![index].cValue}",
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontFamily: "Gilroy_Bold",
                                        color: notifier.text
                                      ),
                                    ),
                                  ],
                                )
                              ],
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  "${couponlistApiModel!.couponlist![index].couponTitle}",
                                  textAlign: TextAlign.start,
                                  style: TextStyle(
                                    color: greaycolor,
                                    fontSize: 16,
                                    fontFamily: "Gilroy_Bold",
                                  ),
                                ),
                                Html(
                                  data: "${couponlistApiModel!.couponlist![index].cDesc}",
                                  style: {
                                    "body": Style(
                                      margin: Margins.zero,
                                      maxLines: 5,
                                      textOverflow: TextOverflow.ellipsis,
                                      color: notifier.text,
                                      fontFamily: "Gilroy_Regular",
                                      fontSize: FontSize(14),
                                    ),
                                  },
                                ),
                                DottedBorder(
                                  borderType: BorderType.RRect,
                                  radius: const Radius.circular(6),
                                  strokeWidth: 1, //thickness of dash/dots
                                  dashPattern: const [3, 2],
                                  color: Colors.blueAccent.shade100,
                                  child: Container(
                                    height: 30,
                                    decoration: BoxDecoration(
                                      color: Colors.blue.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Padding(
                                      padding: EdgeInsets.symmetric(horizontal: 10),
                                      child: Column(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        crossAxisAlignment: CrossAxisAlignment.center,
                                        children: [
                                          Text(
                                            "${couponlistApiModel!.couponlist![index].couponCode}",
                                            overflow: TextOverflow.ellipsis,
                                            maxLines: 1,
                                            style: TextStyle(
                                              color: notifier.text,
                                              fontFamily: "Gilroy_Medium",
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                    separatorBuilder: (BuildContext context, int index) => SizedBox(height: 10),
                  ),
      ),
    );
  }

  couponlist(user, i) {
    return Container(
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: whitecolor,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Config.isValidImageUrl(user[i]["c_img"]?.toString())
                  ? Image.network(
                      Config.resolveImageUrl(user[i]["c_img"]?.toString()),
                      height: 40,
                      errorBuilder: (_, __, ___) => Icon(Icons.local_offer_outlined, color: linercolor, size: 36),
                    )
                  : Icon(Icons.local_offer_outlined, color: linercolor, size: 36),
              Column(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  Text(
                    "$currency${user[i]["c_value"]}",
                    style: TextStyle(
                      fontSize: 18,
                      fontFamily: "Gilroy_Bold",
                    ),
                  ),
                ],
              )
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                user[i]["coupon_title"],
                textAlign: TextAlign.start,
                style: TextStyle(
                  color: greaycolor,
                  fontSize: 16,
                  fontFamily: "Gilroy_Bold",
                ),
              ),
              Html(
                data: user[i]["c_desc"],
                style: {
                  "body": Style(
                    margin: Margins.zero,
                    maxLines: 5,
                    textOverflow: TextOverflow.ellipsis,
                    color: blackcolor,
                    fontFamily: "Gilroy_Regular",
                    fontSize: FontSize(14),
                  ),
                },
              ),
              DottedBorder(
                borderType: BorderType.RRect,
                radius: const Radius.circular(6),
                strokeWidth: 1, //thickness of dash/dots
                dashPattern: const [3, 2],
                color: Colors.blueAccent.shade100,
                child: Container(
                    height: 30,
                    decoration: BoxDecoration(
                      color: Colors.blue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Text(
                            user[i]["coupon_code"],
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                            style: TextStyle(
                              color: blackcolor,
                              fontFamily: "Gilroy_Medium",
                            ),
                          ),
                        ],
                      ),
                    )),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future getCouponList() async {
    final uid = (getdata.read("Uid") ?? getdata.read("UserLogin")?["id"] ?? "0").toString();
    var data = {"uid": uid};
    try {
      var url = Uri.parse('${Config.nodeBaseUrl}/${Config.nodeCoupons}');
      var request = await http.post(url,
          headers: {'Content-Type': 'application/json'}, body: jsonEncode(data));
      var response = jsonDecode(request.body);
      if (request.statusCode == 200) {
        couponlistApiModel = couponlistApiModelFromJson(request.body);
        debugPrint("======== imag ==== ${couponlistApiModel?.responseMsg}");
        return response["couponlist"];
      } else {
        print(response.reasonPhrase);
      }
    } catch (e) {
      print("Exeption----- $e");
    } finally {
      if (mounted) {
        setState(() {
          isLoding = false;
        });
      }
    }
  }
}
