// ignore_for_file: deprecated_member_use, prefer_typing_uninitialized_variables, file_names
import 'dart:convert';
import 'package:dotted_border/dotted_border.dart';
import 'package:flutter/material.dart';
import 'package:flutter_html/flutter_html.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/AppModelApi/couponlist_api_model.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../home/home.dart';

class CouponListPage extends StatefulWidget {
  final dynamic bill;
  const CouponListPage({super.key, this.bill});

  @override
  State<CouponListPage> createState() => _CouponListPageState();
}

class _CouponListPageState extends State<CouponListPage> {
  double bill = 0.0;
  bool isLoding = true;
  bool _isApplying = false;
  final TextEditingController _codeController = TextEditingController();

  CouponlistApiModel? couponlistApiModel;
  var couponList;

  @override
  void initState() {
    super.initState();
    bill = double.tryParse(widget.bill?.toString() ?? '0') ?? 0.0;
    getCouponList();
  }

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> getCouponList() async {
    setState(() => isLoding = true);
    final uid = (getdata.read("Uid") ?? getdata.read("UserLogin")?["id"] ?? "0").toString();
    try {
      final url = Uri.parse('${Config.nodeBaseUrl}/${Config.nodeCoupons}');
      final request = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({"uid": uid}),
      );
      if (request.statusCode == 200) {
        final response = jsonDecode(request.body);
        couponlistApiModel = couponlistApiModelFromJson(request.body);
        couponList = response["couponlist"];
      } else {
        debugPrint("getCouponList status: ${request.statusCode}");
      }
    } catch (e) {
      debugPrint("getCouponList Exception: $e");
    } finally {
      if (mounted) {
        setState(() => isLoding = false);
      }
    }
  }

  Future<void> couponCheckApi(dynamic coupon) async {
    final uid = (getdata.read("Uid") ?? getdata.read("UserLogin")?["id"] ?? "0").toString();
    final cid = coupon is Map ? (coupon["id"] ?? coupon["cid"]) : null;
    final code = coupon is Map ? (coupon["coupon_code"] ?? coupon["c_title"] ?? "") : "";

    setState(() => _isApplying = true);
    try {
      final val = await ApiWrapper.dataPostNode(Config.nodeCouponsCheck, {
        "cid": cid,
        "code": code,
        "coupon_code": code,
        "uid": uid,
      });

      if (val != null && (val['Result'] == "true" || val['Result'] == true || val['ResponseCode'] == "200")) {
        ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Coupon Applied Successfully!!");
        final result = {
          "id": cid?.toString() ?? "",
          "coupon_code": code?.toString() ?? "",
          "c_value": (coupon["c_value"] ?? val["coupon"]?["c_value"] ?? "0").toString(),
          "coupon_title": (coupon["coupon_title"] ?? coupon["ctitle"] ?? "").toString(),
          "min_amt": (coupon["min_amt"] ?? val["coupon"]?["min_amt"] ?? "0").toString(),
          "c_desc": (coupon["c_desc"] ?? "").toString(),
          "c_img": (coupon["c_img"] ?? "").toString(),
        };
        Get.back(result: result);
      } else {
        ApiWrapper.showToastMessage(val?["ResponseMsg"] ?? "Coupon cannot be applied");
      }
    } catch (e) {
      ApiWrapper.showToastMessage("Failed to apply coupon".tr);
    } finally {
      if (mounted) setState(() => _isApplying = false);
    }
  }

  Future<void> _applyManualCoupon(String code) async {
    final trimmed = code.trim();
    if (trimmed.isEmpty) {
      ApiWrapper.showToastMessage("Please enter a coupon code".tr);
      return;
    }

    final uid = (getdata.read("Uid") ?? getdata.read("UserLogin")?["id"] ?? "0").toString();
    setState(() => _isApplying = true);
    try {
      final val = await ApiWrapper.dataPostNode(Config.nodeCouponsCheck, {
        "code": trimmed,
        "coupon_code": trimmed,
        "uid": uid,
      });

      if (val != null && (val['Result'] == "true" || val['Result'] == true || val['ResponseCode'] == "200")) {
        ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Coupon Applied Successfully!!");
        final couponInfo = (val["coupon"] is Map) ? val["coupon"] : {};
        final result = {
          "id": couponInfo["id"]?.toString() ?? "0",
          "coupon_code": couponInfo["coupon_code"]?.toString() ?? trimmed,
          "c_value": couponInfo["c_value"]?.toString() ?? "0",
          "coupon_title": couponInfo["coupon_title"]?.toString() ?? trimmed,
          "min_amt": couponInfo["min_amt"]?.toString() ?? "0",
          "c_desc": couponInfo["c_desc"]?.toString() ?? "",
        };
        Get.back(result: result);
      } else {
        ApiWrapper.showToastMessage(val?["ResponseMsg"] ?? "Invalid or expired coupon code");
      }
    } catch (e) {
      ApiWrapper.showToastMessage("Failed to verify coupon code".tr);
    } finally {
      if (mounted) setState(() => _isApplying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final coupons = couponlistApiModel?.couponlist ?? [];

    return Scaffold(
      backgroundColor: linercolor,
      appBar: appbar(tital: "Coupons & Offers".tr),
      body: Container(
        height: Get.height,
        width: Get.width,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Column(
          children: [
            // ── TOP: Enter Promo Code Box ──────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 10),
              child: Container(
                decoration: BoxDecoration(
                  color: notifier.getBgColor,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                child: Row(
                  children: [
                    Icon(Icons.local_offer_outlined, color: linercolor, size: 22),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _codeController,
                        textCapitalization: TextCapitalization.characters,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: "Gilroy_Bold",
                          fontSize: 14,
                          letterSpacing: 0.8,
                        ),
                        decoration: InputDecoration(
                          hintText: "Enter coupon code (e.g. FLAT50)".tr,
                          hintStyle: TextStyle(
                            color: greaycolor,
                            fontFamily: "Gilroy_Medium",
                            fontSize: 13,
                          ),
                          border: InputBorder.none,
                          // The app theme adds its own outline; the box around this field already draws one.
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          filled: false,
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _isApplying
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : TextButton(
                            onPressed: () => _applyManualCoupon(_codeController.text),
                            style: TextButton.styleFrom(
                              backgroundColor: linercolor.withOpacity(0.12),
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                            ),
                            child: Text(
                              "APPLY",
                              style: TextStyle(
                                color: linercolor,
                                fontFamily: "Gilroy_Bold",
                                fontSize: 13,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                  ],
                ),
              ),
            ),

            // ── Section Title ──────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
              child: Row(
                children: [
                  Text(
                    "Available Offers",
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: "Gilroy_Bold",
                      fontSize: 15,
                    ),
                  ),
                  const Spacer(),
                  if (!isLoding && coupons.isNotEmpty)
                    Text(
                      "${coupons.length} offer${coupons.length > 1 ? 's' : ''}",
                      style: TextStyle(
                        color: greaycolor,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),

            // ── Body / List View ───────────────────────────────────────
            Expanded(
              child: isLoding
                  ? Center(
                      child: CircularProgressIndicator(color: notifier.darklinercolor),
                    )
                  : RefreshIndicator(
                      onRefresh: getCouponList,
                      color: linercolor,
                      child: coupons.isEmpty
                          ? ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              children: [
                                SizedBox(height: Get.height * 0.12),
                                Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.all(22),
                                        decoration: BoxDecoration(
                                          color: linercolor.withOpacity(0.1),
                                          shape: BoxShape.circle,
                                        ),
                                        child: Icon(
                                          Icons.confirmation_num_outlined,
                                          color: linercolor,
                                          size: 52,
                                        ),
                                      ),
                                      const SizedBox(height: 18),
                                      Text(
                                        "No Coupons Available Right Now",
                                        style: TextStyle(
                                          fontSize: 17,
                                          color: notifier.text,
                                          fontFamily: "Gilroy_Bold",
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 36),
                                        child: Text(
                                          "Have a promo code? Enter it in the box above to claim your instant discount!",
                                          textAlign: TextAlign.center,
                                          style: TextStyle(
                                            fontSize: 13,
                                            color: greaycolor,
                                            fontFamily: "Gilroy_Medium",
                                            height: 1.4,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(height: 24),
                                      OutlinedButton.icon(
                                        onPressed: getCouponList,
                                        icon: Icon(Icons.refresh, size: 18, color: linercolor),
                                        label: Text(
                                          "Refresh",
                                          style: TextStyle(
                                            color: linercolor,
                                            fontFamily: "Gilroy_Bold",
                                          ),
                                        ),
                                        style: OutlinedButton.styleFrom(
                                          side: BorderSide(color: linercolor),
                                          shape: RoundedRectangleBorder(
                                            borderRadius: BorderRadius.circular(10),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
                              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                              itemCount: coupons.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 12),
                              itemBuilder: (context, index) {
                                final item = coupons[index];
                                final minAmt = double.tryParse(item.minAmt ?? '0') ?? 0.0;
                                final isEligible = bill >= minAmt;
                                final rawMap = (couponList is List && index < couponList.length)
                                    ? couponList[index]
                                    : {
                                        "id": item.id,
                                        "coupon_code": item.couponCode,
                                        "c_value": item.cValue,
                                        "coupon_title": item.couponTitle,
                                        "min_amt": item.minAmt,
                                        "c_desc": item.cDesc,
                                        "c_img": item.cImg,
                                      };

                                return Container(
                                  decoration: BoxDecoration(
                                    color: notifier.getBgColor,
                                    borderRadius: BorderRadius.circular(18),
                                    boxShadow: [
                                      BoxShadow(
                                        color: Colors.black.withOpacity(0.04),
                                        blurRadius: 8,
                                        offset: const Offset(0, 3),
                                      ),
                                    ],
                                    border: Border.all(
                                      color: isEligible
                                          ? linercolor.withOpacity(0.15)
                                          : Colors.grey.withOpacity(0.12),
                                    ),
                                  ),
                                  padding: const EdgeInsets.all(14),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      // Top row: Icon/Image + Value + Title
                                      Row(
                                        children: [
                                          Config.isValidImageUrl(item.cImg)
                                              ? ClipRRect(
                                                  borderRadius: BorderRadius.circular(10),
                                                  child: Image.network(
                                                    Config.resolveImageUrl(item.cImg),
                                                    height: 38,
                                                    width: 38,
                                                    fit: BoxFit.cover,
                                                    errorBuilder: (_, __, ___) => Icon(
                                                      Icons.local_offer_outlined,
                                                      color: linercolor,
                                                      size: 32,
                                                    ),
                                                  ),
                                                )
                                              : Container(
                                                  height: 38,
                                                  width: 38,
                                                  decoration: BoxDecoration(
                                                    color: linercolor.withOpacity(0.12),
                                                    borderRadius: BorderRadius.circular(10),
                                                  ),
                                                  child: Icon(
                                                    Icons.local_offer_rounded,
                                                    color: linercolor,
                                                    size: 22,
                                                  ),
                                                ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  item.couponTitle?.isNotEmpty == true
                                                      ? item.couponTitle!
                                                      : "Special Discount",
                                                  style: TextStyle(
                                                    fontSize: 15,
                                                    fontFamily: "Gilroy_Bold",
                                                    color: notifier.text,
                                                  ),
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                ),
                                                const SizedBox(height: 2),
                                                Text(
                                                  minAmt > 0
                                                      ? "On minimum order of $currency$minAmt"
                                                      : "No minimum spend required",
                                                  style: TextStyle(
                                                    fontSize: 11.5,
                                                    fontFamily: "Gilroy_Medium",
                                                    color: greaycolor,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                            decoration: BoxDecoration(
                                              color: const Color(0xffFFF4E5),
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Text(
                                              "$currency${item.cValue} OFF",
                                              style: const TextStyle(
                                                fontSize: 13,
                                                fontFamily: "Gilroy_Bold",
                                                color: Color(0xffD97706),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),

                                      // Description (if available)
                                      if (item.cDesc?.isNotEmpty == true && item.cDesc != "<p></p>") ...[
                                        const SizedBox(height: 8),
                                        Html(
                                          data: item.cDesc ?? "",
                                          style: {
                                            "body": Style(
                                              margin: Margins.zero,
                                              maxLines: 3,
                                              textOverflow: TextOverflow.ellipsis,
                                              color: notifier.text.withOpacity(0.75),
                                              fontFamily: "Gilroy_Regular",
                                              fontSize: FontSize(12),
                                            ),
                                          },
                                        ),
                                      ],

                                      const SizedBox(height: 12),

                                      // Bottom row: Code + Apply Button
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          DottedBorder(
                                            borderType: BorderType.RRect,
                                            radius: const Radius.circular(8),
                                            strokeWidth: 1,
                                            dashPattern: const [4, 3],
                                            color: linercolor.withOpacity(0.6),
                                            child: Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                              decoration: BoxDecoration(
                                                color: linercolor.withOpacity(0.08),
                                                borderRadius: BorderRadius.circular(8),
                                              ),
                                              child: Text(
                                                item.couponCode ?? "PROMO",
                                                style: TextStyle(
                                                  color: linercolor,
                                                  fontFamily: "Gilroy_Bold",
                                                  fontSize: 13,
                                                  letterSpacing: 0.8,
                                                ),
                                              ),
                                            ),
                                          ),

                                          // Apply Button or Ineligibility Notice
                                          isEligible
                                              ? InkWell(
                                                  onTap: () => couponCheckApi(rawMap),
                                                  borderRadius: BorderRadius.circular(10),
                                                  child: Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 8),
                                                    decoration: BoxDecoration(
                                                      color: linercolor,
                                                      borderRadius: BorderRadius.circular(10),
                                                    ),
                                                    child: const Text(
                                                      "Apply",
                                                      style: TextStyle(
                                                        color: Colors.white,
                                                        fontFamily: "Gilroy_Bold",
                                                        fontSize: 13,
                                                      ),
                                                    ),
                                                  ),
                                                )
                                              : Container(
                                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                                  decoration: BoxDecoration(
                                                    color: Colors.grey.withOpacity(0.12),
                                                    borderRadius: BorderRadius.circular(8),
                                                  ),
                                                  child: Text(
                                                    "Add $currency${(minAmt - bill).toStringAsFixed(0)} more",
                                                    style: TextStyle(
                                                      color: greaycolor,
                                                      fontFamily: "Gilroy_Medium",
                                                      fontSize: 11.5,
                                                    ),
                                                  ),
                                                ),
                                        ],
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
