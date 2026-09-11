// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:developer';

import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/auth_firebase.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/main.dart';

import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:flutter/material.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:onesignal_flutter/onesignal_flutter.dart';
import 'package:otp_autofill/otp_autofill.dart';
import 'package:pinput/pinput.dart';
import 'package:provider/provider.dart';
import 'package:sms_autofill/sms_autofill.dart';

class Verification extends StatefulWidget {
  final String mobile;
  final String ccode;
  final String? otp;
  final String? ptype;
  final String? type;
  final String? name;
  final String? email;
  final String? password;
  final String? cityId;
  final String? refferalCode;
  const Verification({
    super.key,
    required this.mobile,
    required this.ccode,
    this.otp,
    this.ptype,
    this.type,
    this.name,
    this.email,
    this.password,
    this.cityId,
    this.refferalCode,
  });

  @override
  State<Verification> createState() => _VerificationState();
}

class _VerificationState extends State<Verification> with CodeAutoFill {
  String? appSignature;
  String? otpCode;
  final _formKey = GlobalKey<FormState>();
  String? otpval;
  String? getotp;
  Timer? _timer;
  int _start = 15;
  bool resendotp = false;
  final scaffoldKey = GlobalKey();
  late OTPTextEditController controller;
  late OTPInteractor _otpInteractor;

  bool isLoding = false;
  
  void listenOTP() async {
    debugPrint('listen for code');
    SmsAutoFill().listenForCode;
  }

  @override
  void codeUpdated() {
    setState(() {
      otpCode = code;
    });
  }

  @override
  void initState() {
    debugPrint("========= mobile ======== ${widget.mobile}");
    debugPrint("========== name ========= ${widget.name}");
    debugPrint("========== ccode ======== ${widget.ccode}");
    debugPrint("========== email ======== ${widget.email}");
    debugPrint("======== password ======= ${widget.password}");
    debugPrint("========== type ========= ${widget.type}");
    debugPrint("========== ptype ======== ${widget.ptype}");
    debugPrint("=========== otp ========= ${widget.otp}");
    debugPrint("========= city_id ======= ${widget.cityId}");
    super.initState();
    otpgetsms();
    getotp = widget.otp;
    setState(() {});
    debugPrint("============= get otp ========== $getotp");
    startTimer();
  }

  otpgetsms() async {
    setState(() {});
    listenOTP();
    _otpInteractor = OTPInteractor();
    _otpInteractor
        .getAppSignature()
        .then((value) => debugPrint('signature - $value'));

    controller = OTPTextEditController(
      codeLength: 6,
      onCodeReceive: (code) => debugPrint('Your Application receive code - $code'),
      otpInteractor: _otpInteractor,
    )..startListenUserConsent(
        (code) {
          final exp = RegExp(r'(\d{6})');
          return exp.stringMatch(code ?? '') ?? '';
        },
        strategies: [
          SampleStrategy(),
        ],
      );
    setState(() {});
  }

  smsTypeApi() {
    controller.clear();
    setState(() {});
    ApiWrapper.dataGet(Config.smaType)!.then((val) {
      debugPrint("============ sms type =========== $val");
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
          if (val["SMS_TYPE"] == "Msg91") {
            msgOtpApi();
          } else if (val["SMS_TYPE"] == "Twilio") {
            twilioOtpApi();
          }
        }
      }
    });
  }

  msgOtpApi(){
    var body = {"mobile": widget.ccode + widget.mobile};
    if (widget.ccode.isNotEmpty && widget.mobile.isNotEmpty) {
      ApiWrapper.dataPost(Config.msgOtp, body).then((val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            getotp = val['otp'].toString();
            _start = 15;
            otpgetsms();
            startTimer();
            resendotp = false;
            setState(() {});
            debugPrint("=========== get otp ========= $getotp");
          } else {
            log(val.toString());
            tostmsg(val["ResponseMsg"].toString());
          }
        } else {}
      });
    }
  }

  twilioOtpApi(){
    var body = {"mobile": widget.ccode + widget.mobile};
    if (widget.ccode.isNotEmpty && widget.mobile.isNotEmpty) {
      ApiWrapper.dataPost(Config.twilioOtp, body).then((val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            getotp = val['otp'].toString();
            _start = 15;
            otpgetsms();
            startTimer();
            resendotp = false;
            setState(() {});
            debugPrint("============= get otp ========== $getotp");
          } else {
            log(val.toString());
            tostmsg(val["ResponseMsg"].toString());
          }
        } else {}
      });
    }
  }

  @override
  Future<void> dispose() async {
    await controller.stopListen();
    _timer!.cancel();
    super.dispose();
  }

  void startTimer() {
    const oneSec = Duration(seconds: 1);
    _timer = Timer.periodic(
      oneSec,
      (Timer timer) {
        if (_start == 0) {
          setState(() {
            resendotp = true;
            timer.cancel();
          });
        } else {
          setState(() {});
          _start--;
        }
      },
    );
  }

  String durationToString(int minutes) {
    var d = Duration(minutes: minutes);
    List<String> parts = d.toString().split(':');
    return '${parts[0].padLeft(2, '0')}:${parts[1].padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    Future.delayed(Duration(seconds: 1), () {
      setState(() {});
    });
    notifier = Provider.of(context, listen: true);
    return WillPopScope(
      onWillPop: () async => false,
      child: Scaffold(
      backgroundColor: linercolor,
        body: Padding(
          padding: EdgeInsets.only(top: Get.height / 13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
               Padding(
                padding: EdgeInsets.symmetric(horizontal: 15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    InkWell(
                      onTap: () {
                        Get.back();
                      },
                      child: Container(
                        padding: EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: whitecolor,
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.arrow_back,
                          color: whitecolor,
                        ),
                      ),
                    ),
                    SizedBox(height: 30),
                    Text(
                      "Verification Code".tr,
                      style: TextStyle(
                        color: whitecolor,
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 22,
                      ),
                    ),
                    SizedBox(height: 30),
                  ],
                ),
              ),
              
              Expanded(
                child: Container(
                  width: Get.width,
                  padding: EdgeInsets.all(15),
                  decoration: BoxDecoration(
                    color: notifier.lightBgColor,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(24),
                      topRight: Radius.circular(24),
                    ),
                  ),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "We have sent the code verification to".tr,
                          style: TextStyle(
                            color: notifier.text,
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 15,
                          ),
                        ),
                        Row(
                          children: [
                            Text(
                              "your number".tr,
                              style: TextStyle(
                                color: notifier.text.withOpacity(0.8),
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 15,
                              ),
                            ),
                            SizedBox(width: 10),
                            Text(
                              //"${widget.ccode} ${widget.mobile}",
                              "${widget.mobile}",
                              style: TextStyle(
                                color: notifier.text,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 17,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 30),

                        animatedBorders(),
                  
                        SizedBox(height: 30),
                        !resendotp
                            ? Center(
                                child: Text(
                                  durationToString(_start).toString(),
                                  style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16),
                                ),
                              )
                            : Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    "Didn't receive the code? ".tr,
                                    style: TextStyle(
                                      color: greaycolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 17,
                                    ),
                                  ),
                                  InkWell(
                                    onTap: () {
                                      controller.clear();
                                      // getOtpApi();
                                      smsTypeApi();
                                    },
                                    child: Text(
                                      "Resend".tr,
                                      style: TextStyle(
                                        color: notifier.darklinercolor,
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 17,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                        Spacer(),
                        //! ------ App Button -----
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
                      : SizedBox(
                          width: Get.width,
                          child: appButton(
                            tital: "CONTINUE".tr,
                            onTap: () async {
                              FocusScope.of(context).requestFocus(FocusNode());
                    
                              debugPrint("=========== getotp ============ $getotp");
                              debugPrint("=========== controller ============ ${controller.text}");
                              if (_formKey.currentState!.validate()) {
                                isLoding = true;
                                setState(() {});
                                var verifyBody = {
                                  "mobile": widget.mobile,
                                //  "ccode": widget.ccode,
                                  "otp": controller.text
                                };

                                debugPrint("======== VERIFY OTP REQUEST ========");
                                debugPrint("URL: ${Config.verifyOtp}");
                                debugPrint("Body: $verifyBody");

                                ApiWrapper.dataPost(Config.verifyOtp, verifyBody).then((val) {
                                  debugPrint("======== VERIFY OTP RESPONSE ========");
                                  debugPrint("Response: $val");
                                  if ((val != null) && (val.isNotEmpty) && (val['ResponseCode'] == "200") && (val['Result'] == "true")) {
                                    if (widget.type == "forgetPassword") {
                                      debugPrint("=========== forgetPassword ============");
                                      forgorPasswordBottomsheet(context, mobile: widget.mobile).then((value) {
                                        isLoding = false;
                                        setState(() {});
                                      },);
                                    } else {
                                      debugPrint("=============== singUp ================");
                                      singUpApi(
                                        context,
                                        name: widget.name ?? "",
                                        email: widget.email ?? "",
                                        ccode: widget.ccode,
                                        mobile: widget.mobile,
                                        password: widget.password ?? "",
                                        ptype: widget.ptype,
                                        cityId: widget.cityId ?? '',
                                        refferalCode: widget.refferalCode ?? '',
                                      ).then((value) {
                                        isLoding = false;
                                        setState(() {});
                                      });
                                    }
                                  } else {
                                    tostmsg(val != null && val["ResponseMsg"] != null ? val["ResponseMsg"] : "The OTP entered is incorrect".tr);
                                    isLoding = false;
                                    setState(() {});
                                  }
                                });
                              }
                            },
                          ),
                        ),
                        SizedBox(height: MediaQuery.of(context).padding.bottom + 10),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget animatedBorders() {
    final defaultPinTheme = PinTheme(
      width: 50,
      height: 50,
      textStyle: TextStyle(
        fontSize: 20,
        color: notifier.text,
        fontWeight: FontWeight.w600,
      ),
      decoration: BoxDecoration(
        border: Border.all(color: notifier.bordecolor),
        borderRadius: BorderRadius.circular(10),
      ),
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      child: Center(
        child: Pinput(
          length: 6,
          controller: controller,
          defaultPinTheme: defaultPinTheme,
          focusedPinTheme: defaultPinTheme.copyDecorationWith(
            border: Border.all(color: linercolor),
          ),
        ),
      ),
    );
  }
}

class SampleStrategy extends OTPStrategy {
  @override
  Future<String> listenForCode() {
    return Future.delayed(
      const Duration(seconds: 20),
      () => 'Your Code is ',
    );
  }
}

FirebaseAuthService authService = FirebaseAuthService();

Future singUpApi(
  context,{
  required String name,
  required String email,
  required String mobile,
  required String ccode,
  required String password,
  String? ptype,
  String cityId = '',
  String refferalCode = '',
}) async {
    // Ensure FCM token is available
    if (fcmToken.isEmpty) {
      try {
        final token = await FirebaseMessaging.instance.getToken();
        if (token != null) {
          fcmToken = token;
        }
      } catch (e) {
        debugPrint("Error getting FCM token: $e");
      }
    }

    String deviceId = await getDeviceId();

    var data = {
      "fname": name,
      "email": email,
      "mobile": mobile,
      "ccode": ccode,
      "password": password,
      "city_id": cityId,
      "refferal_code": refferalCode,
      "fcm_token": fcmToken.isNotEmpty ? fcmToken : "",
      "device_id": deviceId,
    };
    debugPrint("SIGNUP request payload => $data");
    ApiWrapper.dataPost(Config.reguser, data).then((value) {
      log(value.toString(), name: "Register Api ");
      save("UserLogin", value["UserLogin"]);
      if ((value != null) && (value.isNotEmpty)) {
        if ((value['ResponseCode'] == "200") && (value['Result'] == "true")) {
          save("firstLogin", true);
          save("Uid", value["UserLogin"]["id"].toString());
          NodeSocketManager.instance.connectCustomer(int.tryParse(value["UserLogin"]["id"].toString()) ?? 0);
          save("UserLogin", value["UserLogin"]);
          initPlatformState();
          var sendTags = {'userid': '${value["UserLogin"]["id"]}'};
          OneSignal.User.addTags(sendTags);
          authService.singUpAndStore(name: getdata.read("UserLogin")["name"], uid: getdata.read("UserLogin")["id"], proPicPath: getdata.read("UserLogin")["r_img"] ?? "");
          successfullBottomSheets(
            context,
            tital: "Registered Successfully".tr,
            subtitle: "Congratulation! your account already has been created. Please login to get amazing experience.".tr,
            buttonText: "GOTO HOME".tr,
            ontap: () {
              debugPrint(ptype);
              if (ptype == "payment") {
                Get.offAll(() => const Bottombar());
              } else if (ptype == "BuyAnything") {
              } else {
                Get.back();
                Get.off(() => Bottombar());
              }
            },
          );
        }
      }
      ApiWrapper.showToastMessage(value["ResponseMsg"].toString());
    });
  }
