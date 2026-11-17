import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/authscreen/signin.dart';
import 'package:goParcel/utils/colors.dart';

class Onboarding extends StatefulWidget {
  const Onboarding({super.key});

  @override
  State<Onboarding> createState() => _OnboardingState();
}

class _OnboardingState extends State<Onboarding> {

  PageController pageController = PageController();
  int activePage = 0;
  
  List titleText = [
    "Hassle-Free Item Pickup & Drop",
    "Shop & Deliver at Your Convenience",
    "Plan, Save & Get It Delivered",
  ];

  List discriptionText = [
    "Get your items picked up and delivered seamlessly, whether it's a document, package, or personal",
    "Need something from a store? Let us buy it for you and deliver it straight to your doorstep",
    "Organize your future purchases or daily essentials in one place. Save your wishlist and order them whenever you need!",
  ];

  List<Color> bgColor = [
    linercolor,
    greencolor,
    orangecolor,
  ];

  List onboarding = [
    "assets/onboarding1.png",
    "assets/onboarding2.png",
    "assets/onboarding3.png",
  ];

  List lineImage = [
    "assets/Line1.png",
    "assets/Line2.png",
    "assets/Line3.png",
  ];

  List buttonText = ["Login", "Get started"];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: bgColor[activePage],
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: Get.height / 50),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Padding(
                padding: EdgeInsets.symmetric(horizontal: Get.width / 30),
                child: Row(
                  children: [
                    for(int i = 0; i < titleText.length; i++)...[
                      Expanded(
                        child: AnimatedContainer(
                          duration: const Duration(seconds: 1),
                          curve: Curves.easeOutExpo,
                          height: 5,
                          margin: EdgeInsets.only(left: i == 0 ? 0: 10),
                          decoration: BoxDecoration(
                            color: activePage == i ? whitecolor : greaycolor,
                            borderRadius: BorderRadius.circular(20)
                          ),
                        ),
                      ),
                      if (i < titleText.length - 1) const SizedBox(width: 2),
                    ],
                  ],
                ),
              ),
              SizedBox(height: Get.height / 30),
              Expanded(
                child: PageView.builder(
                  physics: BouncingScrollPhysics(),
                  itemCount: onboarding.length,
                  controller: pageController,
                  onPageChanged: (value) {
                    activePage = value;
                    setState(() {});
                  },
                  itemBuilder: (context, index) {
                    return Stack(
                      alignment: Alignment.center,
                      clipBehavior: Clip.none,
                      children: [
                        Column(
                          children: [
                            SizedBox(
                              width: Get.width / 1.3,
                              child: Text(
                                titleText[activePage],
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: whitecolor,
                                  fontSize: Get.height / 30,
                                  fontFamily: 'Gilroy_Bold',
                                ),
                              ),
                            ),
                            Image.asset(
                              onboarding[index],
                              fit: BoxFit.cover,
                              height: Get.height / 1.8,
                            ),
                            SizedBox(height: Get.height / 40),
                            SizedBox(
                              width: Get.width / 1.2,
                              child: Text(
                                discriptionText[activePage],
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: whitecolor,
                                  fontSize: 18,
                                ),
                              ),
                            ),
                          ],
                        ),
                        Positioned(
                          bottom: index == 0 
                                    ? Get.height / 10 
                                    : index == 1 
                                      ? Get.height / 5 - 2
                                      : Get.height / 5.4 + 2,
                          left: 0,
                          right: 0,
                          child: Image.asset(
                            lineImage[index],
                            fit: BoxFit.cover,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
              Padding(
                 padding: EdgeInsets.symmetric(horizontal: Get.width / 30),
                child: Row(
                  children: [
                    for(int i = 0; i < buttonText.length; i++)...[
                      Expanded(
                        child: InkWell(
                          // Login and Get started share one entry: Sign In
                          // routes new users to profile details after OTP.
                          onTap: () => Get.to(() => SignIn(paymenttype: "onboarding")),
                          child: Container(
                            padding: EdgeInsets.all(13),
                            decoration: BoxDecoration(
                              color: i == 1 ? whitecolor : Colors.transparent,
                              border: Border.all(color: i == 1 ? whitecolor : lightgrey),
                              borderRadius: BorderRadius.circular(60),
                            ),
                            child: Center(
                              child: Text(
                                buttonText[i],
                                style: TextStyle(
                                  color: i == 1 ? blackcolor : whitecolor,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: Get.height / 50
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      if (i < titleText.length - 1) const SizedBox(width: 10),
                    ],
                  ],
                ),
              ),
              SizedBox(height: Get.height / 60),
            ],
          ),
        ),
      ),
    );
  }
}