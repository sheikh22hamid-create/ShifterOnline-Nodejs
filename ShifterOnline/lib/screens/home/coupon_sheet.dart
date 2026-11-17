import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../theme/app_tokens.dart';
import '../home/home.dart';

/// Popup (bottom sheet) to apply a coupon without leaving the booking screen:
/// type a code, or tap one of the available coupons. Returns the same map
/// shape CouponListPage returned (id, coupon_code, c_value, ...) or null.
/// The server re-validates the coupon when the order is placed.
Future<Map<String, dynamic>?> showCouponSheet(BuildContext context) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _CouponSheet(),
  );
}

class _CouponSheet extends StatefulWidget {
  const _CouponSheet();

  @override
  State<_CouponSheet> createState() => _CouponSheetState();
}

class _CouponSheetState extends State<_CouponSheet> {
  final TextEditingController _code = TextEditingController();
  List<Map<String, dynamic>> _coupons = [];
  bool _loading = true;
  bool _applying = false;

  String get _uid => (getdata.read("Uid") ?? getdata.read("UserLogin")?["id"] ?? "0").toString();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await http.post(
        Uri.parse('${Config.nodeBaseUrl}/${Config.nodeCoupons}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({"uid": _uid}),
      );
      if (res.statusCode == 200) {
        final list = jsonDecode(res.body)["couponlist"];
        if (list is List) _coupons = List<Map<String, dynamic>>.from(list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
      }
    } catch (e) {
      debugPrint("coupon sheet load: $e");
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _apply({Map<String, dynamic>? coupon, String? typed}) async {
    final code = (coupon?["coupon_code"] ?? typed ?? "").toString().trim();
    if (code.isEmpty) {
      ApiWrapper.showToastMessage("Please enter a coupon code".tr);
      return;
    }
    setState(() => _applying = true);
    try {
      final val = await ApiWrapper.dataPostNode(Config.nodeCouponsCheck, {
        if (coupon != null) "cid": coupon["id"],
        "code": code,
        "coupon_code": code,
        "uid": _uid,
      });
      final ok = val != null && (val['Result'] == "true" || val['Result'] == true || val['ResponseCode'] == "200");
      if (!ok) {
        ApiWrapper.showToastMessage(val?["ResponseMsg"] ?? "Invalid or expired coupon code");
        return;
      }
      final info = (val["coupon"] is Map) ? Map<String, dynamic>.from(val["coupon"]) : <String, dynamic>{};
      String pick(String k) => (coupon?[k] ?? info[k] ?? "").toString();
      ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Coupon applied");
      if (mounted) {
        Navigator.pop(context, {
          "id": pick("id").isEmpty ? "0" : pick("id"),
          "coupon_code": pick("coupon_code").isEmpty ? code : pick("coupon_code"),
          "c_value": pick("c_value").isEmpty ? "0" : pick("c_value"),
          "coupon_title": pick("coupon_title").isEmpty ? code : pick("coupon_title"),
          "min_amt": pick("min_amt").isEmpty ? "0" : pick("min_amt"),
          "c_desc": pick("c_desc"),
        });
      }
    } catch (e) {
      ApiWrapper.showToastMessage("Failed to apply coupon".tr);
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Provider.of<ColorNotifier>(context, listen: true);
    final p = AppPalette.current;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.75),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: EdgeInsets.fromLTRB(16, 12, 16, 16 + MediaQuery.of(context).padding.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(width: 40, height: 4, decoration: BoxDecoration(color: p.line, borderRadius: BorderRadius.circular(2))),
            ),
            const SizedBox(height: 14),
            Text('Apply coupon'.tr, style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', fontSize: 18)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _code,
                  textCapitalization: TextCapitalization.characters,
                  style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', letterSpacing: 1),
                  decoration: InputDecoration(
                    hintText: 'Enter coupon code'.tr,
                    isDense: true,
                    filled: true,
                    fillColor: p.surface,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: _applying ? null : () => _apply(typed: _code.text),
                style: ElevatedButton.styleFrom(
                  backgroundColor: p.brand,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: _applying
                    ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: p.onBrand))
                    : Text('Apply'.tr, style: TextStyle(color: p.onBrand, fontFamily: 'Gilroy_Bold')),
              ),
            ]),
            const SizedBox(height: 18),
            Text('Available coupons'.tr, style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', fontSize: 14)),
            const SizedBox(height: 8),
            Flexible(
              child: _loading
                  ? Padding(padding: const EdgeInsets.all(24), child: Center(child: CircularProgressIndicator(color: p.brand)))
                  : _coupons.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.symmetric(vertical: 20),
                          child: Center(child: Text('No coupons available right now'.tr, style: TextStyle(color: p.inkSubtle, fontFamily: 'Gilroy_Medium'))),
                        )
                      : ListView.separated(
                          shrinkWrap: true,
                          itemCount: _coupons.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) {
                            final c = _coupons[i];
                            final min = double.tryParse("${c["min_amt"]}") ?? 0;
                            return InkWell(
                              onTap: _applying ? null : () => _apply(coupon: c),
                              borderRadius: BorderRadius.circular(14),
                              child: Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: p.line),
                                ),
                                child: Row(children: [
                                  Container(
                                    width: 38,
                                    height: 38,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
                                    child: Icon(Icons.local_offer_outlined, color: p.brandText, size: 18),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text("${c["coupon_code"] ?? ""}  ·  ${c["c_value"] ?? ""} off",
                                          style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', fontSize: 14)),
                                      if ("${c["coupon_title"] ?? ""}".isNotEmpty)
                                        Text("${c["coupon_title"]}", style: TextStyle(color: p.inkSubtle, fontFamily: 'Gilroy_Medium', fontSize: 12)),
                                      if (min > 0)
                                        Text("${'Min order'.tr} ₹${min.toStringAsFixed(0)}", style: TextStyle(color: p.inkSubtle, fontFamily: 'Gilroy_Medium', fontSize: 12)),
                                    ]),
                                  ),
                                  Text('Apply'.tr, style: TextStyle(color: p.brandText, fontFamily: 'Gilroy_Bold', fontSize: 13.5)),
                                ]),
                              ),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}
