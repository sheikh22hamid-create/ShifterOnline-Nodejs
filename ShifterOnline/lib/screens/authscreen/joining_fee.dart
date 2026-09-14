// SimpleJoiningFeeScreen.dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';

class SimpleJoiningFeeScreen extends StatelessWidget {
  final Map<String, dynamic> userData;
  final String? ptype;

  const SimpleJoiningFeeScreen({
    super.key,
    required this.userData,
    this.ptype,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          // Header
          Expanded(
            flex: 2,
            child: Container(
              color: linercolor,
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.celebration,
                      size: 80,
                      color: Colors.white,
                    ),
                    SizedBox(height: 20),
                    Text(
                      "Welcome Aboard!".tr,
                      style: TextStyle(
                        fontSize: 28,
                        color: Colors.white,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    SizedBox(height: 10),
                    Text(
                      "Your account has been created successfully".tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.white70,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Content
          Expanded(
            flex: 3,
            child: Container(
              padding: EdgeInsets.all(30),
              decoration: BoxDecoration(
                color: notifier.lightBgColor,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(30),
                  topRight: Radius.circular(30),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    "Complete Your Profile".tr,
                    style: TextStyle(
                      fontSize: 24,
                      fontFamily: 'Gilroy_Bold',
                      color: notifier.text,
                    ),
                  ),
                  SizedBox(height: 20),

                  Text(
                    "Pay a one-time joining fee to unlock all premium features".tr,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 16,
                      color: greaycolor,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),

                  SizedBox(height: 40),

                  // Fee Card
                  Container(
                    padding: EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: notifier.getBgColor,
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(color: linercolor),
                    ),
                    child: Column(
                      children: [
                        Text(
                          "Joining Fee".tr,
                          style: TextStyle(
                            fontSize: 18,
                            fontFamily: 'Gilroy_Bold',
                            color: notifier.text,
                          ),
                        ),
                        SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              "₹199",
                              style: TextStyle(
                                fontSize: 24,
                                fontFamily: 'Gilroy_Bold',
                                color: greaycolor,
                                decoration: TextDecoration.lineThrough,
                              ),
                            ),
                            SizedBox(width: 10),
                            Text(
                              "Free",
                              style: TextStyle(
                                fontSize: 36,
                                fontFamily: 'Gilroy_Bold',
                                color: linercolor,
                              ),
                            ),
                          ],
                        ),
                        Text(
                          "₹199 Discount",
                          style: TextStyle(
                            fontSize: 16,
                            fontFamily: 'Gilroy_Bold',
                            color: Colors.green,
                          ),
                        ),
                        SizedBox(height: 10),
                        Text(
                          "One-time payment • Lifetime benefits".tr,
                          style: TextStyle(
                            fontSize: 14,
                            color: greaycolor,
                            fontFamily: 'Gilroy_Medium',
                          ),
                        ),
                      ],
                    ),
                  ),

                  SizedBox(height: 40),

                  // Buttons
                  Column(
                    children: [
                      SizedBox(
                        width: double.infinity,
                        child: appButton(
                          tital: "Pay Now & Continue".tr,
                          onTap: () {
                            // Navigate based on ptype
                            _navigateToNextScreen();
                          },
                        ),
                      ),
                      SizedBox(height: 15),
                      TextButton(
                        onPressed: () {
                          _navigateToNextScreen();
                        },
                        child: Text(
                          "Pay Later".tr,
                          style: TextStyle(
                            fontSize: 16,
                            color: greaycolor,
                            fontFamily: 'Gilroy_Medium',
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _navigateToNextScreen() {
    if (ptype == "payment") {
      Get.offAll(() => const Bottombar());
    } else if (ptype == "BuyAnything") {
      // Handle BuyAnything case
    } else {
      Get.off(() => Bottombar());
    }
  }
}
