// ignore_for_file: deprecated_member_use

import 'package:accordion/accordion.dart';
import 'package:accordion/controllers.dart';
import 'package:get/get.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';

import '../../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../../utils/colors.dart';
import '../../../utils/Calculation.dart';
import 'package:flutter/material.dart';

import '../home/home.dart';

class Faq extends StatefulWidget {
  const Faq({super.key});

  @override
  State<Faq> createState() => _FaqState();
}

class _FaqState extends State<Faq> {
  List faqList = [];
  String customerCareNumber = "+91 9999908008";

  @override
  void initState() {
    super.initState();
    getfaqApi();
    fetchCustomerCare();
  }

  Future<void> fetchCustomerCare() async {
    try {
      final res = await ApiWrapper.dataPostNode(Config.nodeCustomerCare, {});
      if (res != null && (res["Result"] == "true" || res["Result"] == true)) {
        if (mounted) {
          setState(() {
            final num = (res["customer_care_number"] ?? "").toString().trim();
            if (num.isNotEmpty) customerCareNumber = num;
          });
        }
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: appbar(tital: "FAQ's".tr),
      body: Container(
        height: Get.height,
        padding: EdgeInsets.only(top: 1.5),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Column(
              children: [
                Accordion(
                  headerBorderColorOpened: Colors.transparent,
                  contentBorderWidth: 3,
                  contentHorizontalPadding: 10,
                  scaleWhenAnimating: true,
                  openAndCloseAnimation: true,
                  contentBorderColor: linercolor,
                  headerBackgroundColor: linercolor,
                  contentBackgroundColor: notifier.lightBgColor,
                  headerPadding: const EdgeInsets.symmetric(
                    vertical: 7,
                    horizontal: 15,
                  ),
                  sectionOpeningHapticFeedback: SectionHapticFeedback.heavy,
                  sectionClosingHapticFeedback: SectionHapticFeedback.light,
                  children: [
                    for (var i = 0; i < faqList.length; i++)
                      AccordionSection(
                        rightIcon: Container(),
                        isOpen: true,
                        contentVerticalPadding: 20,
                        header: Text(
                          faqList[i]["question"],
                          style: TextStyle(
                            color: whitecolor,
                            fontSize: 15,
                            fontFamily: "Gilroy_Bold",
                          ),
                        ),
                        content: Text(
                          faqList[i]["answer"],
                          style:  TextStyle(
                            color: notifier.text,
                            fontSize: 15,
                            fontFamily: "Gilroy_Medium",
                          ),
                        ),
                        contentHorizontalPadding: 15,
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: notifier.getBgColor,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.03),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: const BoxDecoration(
                          color: Color(0xFFE8F8EE),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.headset_mic_rounded, color: Color(0xFF00C853), size: 28),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        "Still have questions?".tr,
                        style: TextStyle(
                          fontFamily: "Gilroy_Bold",
                          fontSize: 16,
                          color: notifier.text,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "Our customer care team is here to assist you".tr,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontFamily: "Gilroy_Medium",
                          fontSize: 12.5,
                          color: greaycolor,
                        ),
                      ),
                      const SizedBox(height: 14),
                      ElevatedButton.icon(
                        onPressed: () => makePhoneCall(customerCareNumber),
                        icon: const Icon(Icons.call_rounded, color: Colors.white, size: 18),
                        label: Text(
                          "Call $customerCareNumber",
                          style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 13.5, color: Colors.white),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF00C853),
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          elevation: 0,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 30),
              ],
            ),
          ),
        ),
      ),
    );
  }

  getfaqApi() {
    var uid = getdata.read("Uid") ?? "";
    var body = {"uid": uid};
    ApiWrapper.dataPostNode(Config.nodeFaqs, body).then((faq) {
      if ((faq != null) && (faq.isNotEmpty)) {
        if ((faq['ResponseCode'] == "200") && (faq['Result'] == "true")) {
          setState(() {});
          faqList = faq["FaqData"];
          debugPrint("========= faqList[i] ===== $faqList");
        } else {}
      }
    });
  }
}
