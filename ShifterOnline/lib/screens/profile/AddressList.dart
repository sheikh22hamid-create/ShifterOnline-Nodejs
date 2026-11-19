// ignore_for_file: file_names, prefer_typing_uninitialized_variables, deprecated_member_use

import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/location_search_screen.dart';
import 'package:goParcel/screens/home/traking.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';

import '../../../utils/colors.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_buttons.dart';
import '../../theme/widgets/app_skeleton.dart';
import '../../theme/widgets/app_top_bar.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class AddressListPage extends StatefulWidget {
  const AddressListPage({super.key});

  @override
  State<AddressListPage> createState() => _AddressListPageState();
}

class _AddressListPageState extends State<AddressListPage> {
  var addressList;
  bool isLoading = true;

  @override
  void initState() {
    addressListApi();
    super.initState();
  }

  Future<void> _openAddAddress() async {
    final result = await Get.to(() => const LocationSearchScreen(locationType: "Address"));
    if (result != null) {
      addressListApi();
    }
  }

  void _deleteAddress(String aid) {
    final p = AppPalette.current;
    Get.dialog(
      AlertDialog(
        backgroundColor: p.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text("Delete Address".tr, style: AppText.section(p.ink)),
        content: Text("Are you sure you want to delete this address?".tr, style: AppText.body(p.inkMuted).copyWith(fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: Text("Cancel".tr, style: AppText.bodyStrong(p.inkMuted).copyWith(fontSize: 14)),
          ),
          TextButton(
            onPressed: () {
              Get.back();
              final uid = getdata.read("Uid") ?? "";
              ApiWrapper.dataPostNode(Config.nodeAddressDelete, {
                "uid": uid.toString(),
                "aid": aid,
              }).then((val) {
                if (val != null && (val['ResponseCode'] == "200" || val['Result'] == "true")) {
                  tostmsg(val['ResponseMsg'] ?? "Address Deleted Successfully!!!");
                  addressListApi();
                } else {
                  tostmsg(val?['ResponseMsg'] ?? "Failed to delete address");
                }
              }).catchError((_) {
                tostmsg("Failed to delete address");
              });
            },
            child: Text("Delete".tr, style: AppText.bodyStrong(p.danger).copyWith(fontSize: 14)),
          ),
        ],
      ),
    );
  }

  static String _title(dynamic type) {
    final t = (type ?? '').toString();
    if (t.isEmpty) return 'Address';
    return t.toLowerCase() == 'office' ? 'Work' : t;
  }

  static IconData _icon(dynamic type) {
    switch ((type ?? '').toString().toLowerCase()) {
      case 'home':
        return Icons.home_rounded;
      case 'office':
        return Icons.work_rounded;
      default:
        return Icons.place_rounded;
    }
  }

  void _editAddress(Map item) {
    Get.to(
      () => Traking(
        type2: "Edit",
        addressAdd: item["id"]?.toString(),
        addresstype: item["type"],
        cname: item["c_name"],
        cnumbere: item["c_number"],
        elang: item["long_map"]?.toString(),
        elat: item["lat_map"]?.toString(),
        housenumber: item["hno"],
        landmark: item["landmark"],
      ),
    )!.then((_) {
      addressListApi();
    });
  }

  Widget _addressCard(Map item) {
    final p = AppPalette.current;
    String t(String k) {
      final v = item[k]?.toString().trim() ?? '';
      return v == 'null' ? '' : v;
    }

    final parts = [t('hno'), t('landmark'), t('address')].where((s) => s.isNotEmpty).toList();
    final contact = [t('c_name'), t('c_number')].where((s) => s.isNotEmpty).join(' · ');
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      padding: const EdgeInsets.fromLTRB(14, 14, 4, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
            child: Icon(_icon(item['type']), color: p.brandText, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_title(item['type']).tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15.5)),
                const SizedBox(height: 4),
                Text(parts.join(', '),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.body(p.inkMuted).copyWith(fontSize: 13.5, height: 1.35)),
                if (contact.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Row(children: [
                    Icon(Icons.person_outline_rounded, size: 15, color: p.inkSubtle),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(contact,
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption(p.inkSubtle).copyWith(fontSize: 12.5)),
                    ),
                  ]),
                ],
              ],
            ),
          ),
          Column(
            children: [
              IconButton(
                tooltip: 'Edit'.tr,
                onPressed: () => _editAddress(item),
                icon: Icon(Icons.edit_outlined, size: 20, color: p.ink),
              ),
              IconButton(
                tooltip: 'Delete'.tr,
                onPressed: () {
                  final aid = item["id"]?.toString() ?? "";
                  if (aid.isNotEmpty) _deleteAddress(aid);
                },
                icon: Icon(Icons.delete_outline_rounded, size: 20, color: p.danger),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _empty() {
    final p = AppPalette.current;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 88,
              width: 88,
              decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
              child: Icon(Icons.bookmark_add_outlined, size: 40, color: p.brandText),
            ),
            const SizedBox(height: 18),
            Text("No Saved Addresses".tr, style: AppText.title(p.ink).copyWith(fontSize: 20)),
            const SizedBox(height: 8),
            Text(
              "Add your home, office, or frequent places for quicker 1-tap bookings.".tr,
              textAlign: TextAlign.center,
              style: AppText.body(p.inkMuted).copyWith(fontSize: 14, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final p = AppPalette.current;
    final hasAddresses = addressList is List && (addressList as List).isNotEmpty;

    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(title: "Saved Addresses".tr, subtitle: "Home, work and other places".tr),
      bottomNavigationBar: isLoading
          ? null
          : Material(
              color: p.surface,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  child: AppPrimaryButton(label: '+  ${"Add New Address".tr}', onPressed: _openAddAddress),
                ),
              ),
            ),
      body: isLoading
          ? ListView(padding: const EdgeInsets.all(16), children: const [
              AppSkeleton(height: 96, radius: 16),
              SizedBox(height: 12),
              AppSkeleton(height: 96, radius: 16),
            ])
          : !hasAddresses
              ? _empty()
              : ListView.separated(
                  itemCount: addressList.length,
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  physics: const BouncingScrollPhysics(),
                  itemBuilder: (context, index) => _addressCard(addressList[index] as Map),
                  separatorBuilder: (BuildContext context, int index) => const SizedBox(height: 12),
                ),
    );
  }

  void addressListApi() {
    var uid = getdata.read("Uid") ?? "";
    var data = {"uid": uid.toString()};
    debugPrint("AddressList request: $data");
    ApiWrapper.dataPostNode(Config.nodeAddressList, data).then(
      (val) {
        if (!mounted) return;
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            final list = val["AddressList"];
            addressList = (list is List) ? list : [];
            isLoading = false;
            debugPrint("=========== addressList ========= $addressList");
            setState(() {});
          } else if (val['ResponseMsg'] == "Address List Not Found!!" ||
              val['ResponseMsg'] == "Address List Not Found") {
            addressList = [];
            isLoading = false;
            setState(() {});
          } else {
            isLoading = false;
            setState(() {});
            tostmsg(val['ResponseMsg']?.toString() ?? "Something went wrong,");
          }
        } else {
          isLoading = false;
          setState(() {});
        }
      },
    ).catchError((e) {
      debugPrint("AddressList error: $e");
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    });
  }
}
