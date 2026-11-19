import 'dart:convert';
import 'dart:developer';

import 'package:dotted_line/dotted_line.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/AppModelApi/payment_gatwey_api_model.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/Payment/InputFormater.dart';
import 'package:goParcel/Payment/Payment_card.dart';
import 'package:goParcel/Payment/pay_stack_payment.dart';
import 'package:goParcel/Payment/paypal/src/screens/paypal_screen.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:goParcel/Payment/web_view.dart';
import 'package:goParcel/screens/home/chatscreen.dart';
import 'package:goParcel/screens/home/trackingview.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/screens/profile/faq.dart';
import 'package:goParcel/utils/Calculation.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_phone_direct_caller/flutter_phone_direct_caller.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'home.dart';
import 'trakingStore.dart';

//!  ---------- Option list view --------

class OptionTraking extends StatefulWidget {
  final String? type;
  const OptionTraking({super.key, this.type});

  @override
  State<OptionTraking> createState() => _OptionTrakingState();
}

class _OptionTrakingState extends State<OptionTraking> {

  var buyMapinfo;
  dynamic grandTotal = "0";
  int _groupValue = 0;
  String? paymenttital;
  final _formKey = GlobalKey<FormState>();
  var numController = TextEditingController();
  final _paymentCard = PaymentCard();
  var _autoValidateMode = AutovalidateMode.disabled;
  bool isloading = false;
  bool payshow = false;
  final _card = PaymentCard();
  bool isLoading = false;

  bool isPaymentLoding = false;

  RazorPayClass razorPayClass = RazorPayClass();

  @override
  void initState() {
    super.initState();
    _paymentCard.type = CardType.Others;
    numController.addListener(_getCardTypeFrmNumber);
    buyMapinfoget();
    paymenrgatway();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: handlePaymentSuccess,
      handlePaymentError: handlePaymentError,
      handleExternalWallet: handleExternalWallet,
    );
  }

  void handlePaymentSuccess(PaymentSuccessResponse response) {
    // transactionId = response.paymentId.toString();
    billPayApi("${response.paymentId}");
    debugPrint("++++++++++++++++++++++++ Payment success :");
  }

  void handlePaymentError(PaymentFailureResponse response) {
    debugPrint("++++++++++++++++++++++++ Payment failed : $response");
  }

  void handleExternalWallet(ExternalWalletResponse response) {}

  @override
  Widget build(BuildContext context) {
    Future.delayed(Duration(seconds: 0), () {
      if (mounted) {
        setState(() {
          buyMapinfo;
        }); 
      }
    });
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        centerTitle: true,
        elevation: 0,
        backgroundColor: linercolor,
        title: Text(
          "${"Order".tr} #${getdata.read("OrderID") ?? "0"}",
          style: TextStyle(
            color: whitecolor,
            fontFamily: "Gilroy_Bold",
          ),
        ),
        actions: [
          Row(
            children: [
              InkWell(
                onTap: buyMapinfoget,
                child: !isLoading
                    ? Image.asset(
                        "assets/refresh.png",
                        height: 20,
                        color: whitecolor,
                      )
                    : loading(),
              ),
              SizedBox(width: 10),
              InkWell(
                onTap: () {
                  Get.to(() => TrackingWay());
                },
                child: Icon(Icons.more_vert, color: whitecolor),
              ),
              SizedBox(width: 10),
            ],
          )
        ],
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: Container(
        decoration: BoxDecoration(),
        padding: EdgeInsets.all(10),
        width: Get.width,
        child: buyMapinfo != null
            ? buyMapinfo["order_step"] == 5
                ? appButton(
                    tital: "TRACK THE ORDER".tr,
                    onTap: () {
                      Get.back();
                    },
                  )
                : SizedBox()
            : SizedBox(),
      ),
      body: Container(
        height: Get.height,
        width: Get.width,
        padding: EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: buyMapinfo != null
            ? SingleChildScrollView(
                child: Column(
                  children: [
                    //!  ---------- Option list view --------
                    SizedBox(
                      height: 280,
                      child: ListView.separated(
                        padding: EdgeInsets.zero,
                        shrinkWrap: true,
                        scrollDirection: Axis.horizontal,
                        itemCount: buyMapinfo["item_list"].length,
                        itemBuilder: (context, i) {
                          return optionview(buyMapinfo["item_list"], i);
                        },
                        separatorBuilder: (BuildContext context, int index) => SizedBox(width: 10),
                      ),
                    ),
                    SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                buyMapinfo["rest_msg"],
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 18,
                                ),
                              ),
                              Text(
                                buyMapinfo["rider_msg"],
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: greaycolor.withOpacity(0.8),
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 15,
                                ),
                              ),
                            ],
                          ),
                        ),
                        InkWell(
                          onTap: () {
                            Get.to(() => Faq());
                          },
                          child: Image.asset(
                            "assets/faq.png",
                            height: 30,
                            color: notifier.darklinercolor,
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 10),
                    Container(
                      padding: EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: notifier.getBgColor,
                        borderRadius: BorderRadius.circular(15),
                      ),
                      child: Row(
                        children: [
                          Container(
                            height: 50,
                            width: 50,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(50),
                              color: Colors.grey.shade200,
                              image: Config.isValidImageUrl(buyMapinfo["rider_img"])
                                  ? DecorationImage(
                                      image: NetworkImage(
                                        Config.resolveImageUrl(buyMapinfo["rider_img"]),
                                      ),
                                      fit: BoxFit.fill,
                                    )
                                  : null,
                            ),
                            child: !Config.isValidImageUrl(buyMapinfo["rider_img"])
                                ? Icon(Icons.person, color: Colors.grey.shade600, size: 28)
                                : null,
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              buyMapinfo["rider_name"],
                              style: TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 18,
                                color: notifier.text,
                              ),
                            ),
                          ),
                          InkWell(
                            onTap: () async {
                              await FlutterPhoneDirectCaller.callNumber(buyMapinfo["rider_mobile"]);
                            },
                            child: Container(
                              height: 50,
                              width: 50,
                              padding: EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: notifier.lightBgColor,
                                shape: BoxShape.circle,
                              ),
                              child: Image.asset(
                                "assets/fillcall.png",
                                color: linercolor,
                              ),
                            ),
                          ),
                          SizedBox(width: 10),
                          InkWell(
                            onTap: () async {
                              Get.back();
                              Get.to(
                                Chat(
                                  receiverId: buyMapinfo["rider_id"],
                                  receiverMobile: buyMapinfo["rider_mobile"],
                                  receiverImage: buyMapinfo["rider_img"],
                                  receiverName: buyMapinfo["rider_name"],
                                ),
                              );
                              debugPrint("============= receiverId ========== ${buyMapinfo["rider_id"]}");
                            },
                            child: Container(
                              padding: EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: notifier.lightBgColor,
                              ),
                              child: Center(
                                child: Image.asset(
                                  "assets/msgnotification.png",
                                  height: 25,
                                  color: linercolor,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: 10),
                    //! Bill Details
                    buyMapinfo["order_step"] != 5
                        ? Container(
                            padding: EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: notifier.getBgColor,
                              borderRadius: BorderRadius.circular(15),
                            ),
                            child: Column(
                              children: [
                                packagedetails(
                                  packagename: "Package Details".tr,
                                  items: "${buyMapinfo["total_item"]} Item",
                                  colors: greaycolor,
                                ),
                                packagedetails(
                                  packagename: "Delivery Fees",
                                  items: "${buyMapinfo["pay_already"] ?? "0"}$currency",
                                  colors: greaycolor,
                                ),
                                buyMapinfo["service_bill"] != "0"
                                    ? packagedetails(
                                        packagename: "Store Bill".tr,
                                        items: "${buyMapinfo["service_bill"]}$currency",
                                        titleColor: greaycolor.withOpacity(0.9),
                                        colors: notifier.text,
                                      )
                                    : const SizedBox(),
                                buyMapinfo["service_charge"] != "0"
                                    ? packagedetails(
                                        packagename: "Service Charge".tr,
                                        items: "${buyMapinfo["service_charge"]}$currency",
                                        titleColor: greaycolor.withOpacity(0.9),
                                        colors: notifier.text,
                                      )
                                    : const SizedBox(),
                                grandTotal != "0.00"
                                    ? packagedetails(
                                        packagename: "Grand Total".tr,
                                        items: "$grandTotal$currency",
                                        titleColor: notifier.text,
                                        colors: notifier.text,
                                      )
                                    : const SizedBox(),
                                packagedetails(
                                  packagename: "Paid Already".tr,
                                  items: "${buyMapinfo["pay_already"]}$currency",
                                  colors: greaycolor,
                                ),
                                buyMapinfo["order_step"] == 6
                                    ? SizedBox(height: 10)
                                    : SizedBox(),
                                buyMapinfo["order_step"] == 6
                                    ? InkWell(
                                        onTap: () {
                                          setState(() {
                                            paymenttital = "";
                                            _groupValue = 0;
                                            isPaymentLoding = false;
                                          });
                                          paymentSheet();
                                        },
                                        child: Container(
                                          margin: EdgeInsets.symmetric(horizontal: 10),
                                          padding: EdgeInsets.symmetric(vertical: 10),
                                          decoration: BoxDecoration(
                                            color: greencolor,
                                            borderRadius: BorderRadius.circular(12),
                                          ),
                                          child: Center(
                                            child: Text(
                                              "${"PAY".tr} $currency$grandTotal",
                                              style: TextStyle(
                                                color: whitecolor,
                                                fontSize: 18,
                                                fontFamily: 'Gilroy_Medium',
                                              ),
                                            ),
                                          ),
                                        ),
                                      )
                                    : SizedBox(),
                              ],
                            ),
                          )
                        : Container(
                            width: Get.width,
                            padding: EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: linercolor,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      crossAxisAlignment: CrossAxisAlignment.center,
                                      children: [
                                        Image.asset(
                                          "assets/radio.png",
                                          height: 28,
                                          color: orangecolor,
                                        ),
                                        SizedBox(height: 3),
                                        DottedLine(
                                          dashGapLength: 5,
                                          lineThickness: 2,
                                          dashColor: whitecolor.withOpacity(0.8),
                                          dashGapColor: Colors.transparent,
                                          direction: Axis.vertical,
                                          lineLength: 45,
                                        ),
                                        Image.asset(
                                          "assets/location_drop.png",
                                          height: 28,
                                          color: whitecolor,
                                        ),
                                      ],
                                    ),
                                    SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            buyMapinfo["pick_type"],
                                            style: TextStyle(
                                              color: whitecolor,
                                              fontFamily: 'Gilroy_Bold',
                                              fontSize: 16,
                                            ),
                                          ),
                                          buyMapinfo == null
                                              ? SizedBox()
                                              : Text(
                                                  buyMapinfo["customer_paddress"] ?? buyMapinfo["store_paddress"],
                                                  maxLines: 2,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    color: whitecolor.withOpacity(0.8),
                                                    fontFamily: 'Gilroy_Medium',
                                                    fontSize: 14,
                                                  ),
                                                ),
                                          SizedBox(height: 15),
                                          Text(
                                            // "Pickup loction",
                                            buyMapinfo["drop_type"],
                                            style: TextStyle(
                                              color: whitecolor,
                                              fontFamily: 'Gilroy_Bold',
                                              fontSize: 16,
                                            ),
                                          ),
                                          buyMapinfo == null
                                              ? SizedBox()
                                              : Text(
                                                  buyMapinfo["customer_daddress"] ?? "",
                                                  maxLines: 2,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    color: whitecolor.withOpacity(0.8),
                                                    fontFamily: 'Gilroy_Medium',
                                                    fontSize: 14,
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
                  ],
                ),
              )
            : SizedBox(),
      ),
    );
  }

//! ---------  optionView List  --------
  optionview(item, i) {
    return Container(
      width: Get.width / 2.3,
      padding: EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Stack(
            children: [
              Container(
                height: Get.height / 5.6,
                width: Get.width / 2.2,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(15),
                  color: Colors.grey.shade100,
                  image: (item[i]["item_img"] != null &&
                          (item[i]["item_img"] as List).isNotEmpty &&
                          Config.isValidImageUrl(item[i]["item_img"][0]?.toString()))
                      ? DecorationImage(
                          image: NetworkImage(
                            Config.resolveImageUrl(item[i]["item_img"][0]?.toString()),
                          ),
                          fit: BoxFit.cover,
                        )
                      : null,
                ),
                child: (item[i]["item_img"] == null ||
                        (item[i]["item_img"] as List).isEmpty ||
                        !Config.isValidImageUrl(item[i]["item_img"][0]?.toString()))
                    ? Center(child: Icon(Icons.shopping_bag_outlined, color: Colors.grey.shade400, size: 36))
                    : null,
              ),
              Positioned(
                right: 0,
                child: Container(
                  height: 25,
                  width: 26,
                  decoration: BoxDecoration(
                    color: linercolor,
                    borderRadius: const BorderRadius.only(
                      topRight: Radius.circular(14),
                      bottomLeft: Radius.circular(10),
                    ),
                  ),
                  child: Center(
                    child: Text(
                      item[i]["item_img"].length.toString(),
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Item".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: 'Gilroy_Bold',
                ),
              ),
              Text(
                "Qty".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: 'Gilroy_Bold',
                ),
              ),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                item[i]["item_title"],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  color: greaycolor.withOpacity(0.8),
                ),
              ),
              Text(
                item[i]["quantity"],
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  color: greaycolor.withOpacity(0.8),
                ),
              ),
            ],
          ),
          item[i]["item_total"] != null
              ? Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      "Total".tr,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    Text(
                      "${item[i]["item_total"] ?? "0"}$currency",
                      style: TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        color: greaycolor.withOpacity(0.8),
                      ),
                    ),
                  ],
                )
              : SizedBox(),
          SizedBox(height: 5),
          //! ------------- cancell order -------------------

          item[i]["item_confirm"] != "2"
              ? InkWell(
                  onTap: () {
                    Get.to(
                      () => TrakingView(
                        itemlength: buyMapinfo["item_list"].length.toString(),
                        imageList: item[i]["item_img"],
                        itemID: item[i]["item_id"],
                        type: item[i]["item_confirm"],
                      ),
                    )!.then((value) {
                      setState(() {});
                      buyMapinfoget();
                    });
                  },
                  child: Container(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: item[i]["item_confirm"] != "0"
                          ? greencolor
                          : linercolor,
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Center(
                      child: Text(
                        item[i]["item_confirm"] != "0"
                            ? "Option Confirm".tr
                            : "View Option".tr,
                        style: TextStyle(
                          fontSize: Get.height / 50,
                          color: whitecolor,
                          fontFamily: 'Gilroy_Medium',
                        ),
                      ),
                    ),
                  ),
                )
              : InkWell(
                  //!  --------------  Item Canceled  -------------
                  onTap: () {
                    var contain = buyMapinfo["item_list"].where((element) => element["item_confirm"] == "2");
                    if (contain.length == buyMapinfo["item_list"].length) {
                      dialogShow(item[i]["item_id"]);
                    } else {
                      itemConfirm(item[i]["item_id"]);
                    }
                  },
                  child: Container(
                    height: Get.height * 0.045,
                    width: Get.width / 2.8,
                    decoration: BoxDecoration(
                      color: orangecolor,
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Center(
                      child: Text(
                        "Item Cancle".tr,
                        style: TextStyle(
                          fontSize: Get.height / 50,
                          color: whitecolor,
                          fontFamily: 'Gilroy_Medium',
                        ),
                      ),
                    ),
                  ),
                ),
        ],
      ),
    );
  }

//! ------------ item Order Canceled -------------

  buyCancelItem() {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {"uid": uid, "order_id": orderid};
    ApiWrapper.dataPostNode(Config.nodeBuyCancel, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "BuyMapinfo : ");
          // Get.off(() => const StoreRecent());
          Get.back();
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
        }
      }
    });
  }

//! ------------ item Canceled -------------

  void itemConfirm(itemID) {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {
      "uid": uid,
      "itmeid": itemID,
      "order_id": orderid,
      "status": "3"
    };
    ApiWrapper.dataPostNode(Config.nodeConfirmItem, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "Item Confirm : ");
          buyMapinfoget();
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
        }
      }
    });
  }

  dialogShow(itemID) {
    showDialog(
      barrierDismissible: false,
      context: context,
      builder: (context) {
        return CupertinoAlertDialog(
          content: Text(
            "This will lead to cancellation of the order (cancellation charges may apply), Do you want to proceed ?".tr,
            style: TextStyle(
              color: blackcolor,
              fontFamily: "Gilroy_Regular",
            ),
          ),
          actions: <Widget>[
            TextButton(
                child: Text(
                  "Yes".tr,
                  style: TextStyle(
                    color: linercolor,
                    fontFamily: "Gilroy_Bold",
                  ),
                ),
                onPressed: () {
                  buyCancelItem();
                }),
            TextButton(
              child: Text(
                "No".tr,
                style: TextStyle(
                  color: linercolor,
                  fontFamily: "Gilroy_Bold",
                ),
              ),
              onPressed: () {
                Get.back();
              },
            ),
          ],
        );
      },
    );
  }

  Future paymentSheet() {
    int paymentindex = 0;
    return showModalBottomSheet(
      isScrollControlled: true,
      backgroundColor: notifier.lightBgColor,
      barrierColor: notifier.text.withOpacity(0.3),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      context: context,
      builder: (context) {
        return Container(
          padding: EdgeInsets.all(10),
          constraints: BoxConstraints(maxHeight: Get.height / 1.5),
          child: Scaffold(
            backgroundColor: notifier.lightBgColor,
            floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
            floatingActionButton: InkWell(
              onTap: () {
                // ! ------------ Order Api Call -----------
                if (paymenttital != "" && paymenttital != null) {
                  if (isPaymentLoding == false) {
                    setState(() {
                      isPaymentLoding = true;
                    });
                    if (paymenttital == "Razorpay") {
                      debugPrint("Razorpay");
                      debugPrint("--------- key ---------- ${paymentGatwayApiModel!.data![0].attributes}");
                      debugPrint("-------- amount -------- $grandTotal");
                      debugPrint("-------- number -------- ${getdata.read("UserLogin")["mobile"]}");
                      debugPrint("--------- name --------- ${getdata.read("UserLogin")["name"]}");
                      Get.back();
                      razorPayClass.openCheckout(
                        key: Config.razorpayKeyId, // Test Razorpay key ID
                        amount: "$grandTotal",
                        number: "${getdata.read("UserLogin")["mobile"]}",
                        name: "${getdata.read("UserLogin")["name"]}",
                      );
                    } else if (paymenttital == "Paypal") {
                      debugPrint("paypal");
                      List ids = paymentGatwayApiModel!.data![paymentindex].attributes.toString().split(",");
                      debugPrint('++++++++++ ids :------ $ids');
                      paypalPayment(
                        context: context,
                        amt: "$grandTotal",
                        clientId: ids[0],
                        secretKey: ids[1],
                        function: (e) {
                          debugPrint("----------- transactionId ---------- ${e["paymentId"]}");
                          billPayApi("${e["paymentId"]}");
                        },
                      );
                    } else if (paymenttital == "Stripe") {
                      debugPrint("Stripe");
                      //!------------- Stripe Payment ----------
                      Get.back();
                      stripePayment();
                    } else if (paymenttital == "FlutterWave") {
                      debugPrint("FlutterWave");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.flutterwave}amt=$grandTotal&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "Paytm") {
                      debugPrint("Paytm");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.paytm}amt=$grandTotal&uid=${getdata.read("Uid")}&mobile=${getdata.read("UserLogin")["mobile"]}&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "SenangPay") {
                      debugPrint("SenangPay");
                      final notificationId = UniqueKey().hashCode;
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.senangPay}detail=Movers&amount=$grandTotal&order_id=$notificationId&name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}",
                        status1: "msg",
                        status2: "Payment_was_successful",
                        tId: "transaction_id"
                      );
                    } else if (paymenttital == "PayStack") {
                      debugPrint("PayStack");
                      payStackPaymentApi(
                        email: "${getdata.read("UserLogin")["email"]}",
                        amount: "$grandTotal",
                      ).then((value) {
                        debugPrint("========= value ========= $value");
                        if (value["status"] == true) {
                          debugPrint("--------- authorization_url --------- ${value["data"]["authorization_url"]}");
                          webViewPaymentMethod(
                            initialUrl: "${value["data"]["authorization_url"]}",
                            status1: "status",
                            status2: "success",
                            tId: "trxref",
                          );
                        }
                      });
                    } else if (paymenttital == "MercadoPago") {
                      debugPrint("MercadoPago");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.merpago}amt=$grandTotal",
                        status1: "status",
                        status2: "successful",
                        tId: "",
                      );
                    } else if (paymenttital == "Payfast") {
                      debugPrint("Payfast");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.payFast}amt=$grandTotal",
                        status1: "status",
                        status2: "success",
                        tId: "payment_id"
                      );
                    } else if (paymenttital == "Midtrans") {
                      debugPrint("Midtrans");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.midtans}name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}&amt=$grandTotal",
                        status1: "status_code",
                        status2: "200",
                        tId: "order_id"
                      );
                    } else if (paymenttital == "2checkout") {
                      debugPrint("2checkout");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.checkout2}amt=$grandTotal",
                        status1: "status",
                        status2: "successful",
                        tId: ""
                      );
                    } else if (paymenttital == "Khalti Payment") {
                      debugPrint("Khalti Payment");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.khalti}amt=$grandTotal",
                        status1: "status",
                        status2: "Completed",
                        tId: "transaction_id"
                      );
                    }
                  }
                } else {
                  tostmsg("Select Your Payment Method");
                }
              },
              child: isPaymentLoding
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
                height: 50,
                width: Get.width,
                decoration: BoxDecoration(
                  color: linercolor,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(
                  child: Text(
                    "${"PAY NOW".tr} | $currency$grandTotal",
                    style: TextStyle(
                      color: whitecolor,
                      fontSize: Get.height / 50,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                ),
              ),
            ),
            body: StatefulBuilder(builder: (context, setState) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Select Payment Method".tr,
                    style: TextStyle(
                      fontSize: 20,
                      fontFamily: 'Gilroy_Bold',
                      color: notifier.text
                    ),
                  ),
                  SizedBox(height: 10),
                  //! --------- List view paymente ----------
                  Expanded(
                    child: ListView.separated(
                      shrinkWrap: true,
                      padding: EdgeInsets.only(bottom: 50),
                      physics: BouncingScrollPhysics(),
                      itemCount: paymentGatwayApiModel!.data!.length,
                      itemBuilder: (context, index) {
                        return paymentGatwayApiModel!.data![index].pShow == "0"
                          ? SizedBox()
                          : InkWell(
                          onTap: () {
                            setState(() {
                              paymenttital = paymentGatwayApiModel!.data![index].title;
                              paymentindex = index;
                              _groupValue = int.parse("${paymentGatwayApiModel!.data![index].id}");
                            });
                            debugPrint("============ groupValue ============ $_groupValue");
                            debugPrint("=========== paymentindex =========== $paymentindex");
                          },
                          child: Container(
                            padding: EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              border: Border.all(
                                color: _groupValue == int.parse("${paymentGatwayApiModel!.data![index].id}")
                                    ? notifier.darklinercolor
                                    : Colors.transparent,
                                width: 1,
                              ),
                              color: notifier.getBgColor,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  height: 80,
                                  width: 80,
                                  decoration: BoxDecoration(
                                    color: notifier.getimag,
                                    borderRadius: BorderRadius.circular(15),
                                  ),
                                  child: Center(
                                    child: Config.isValidImageUrl(paymentGatwayApiModel!.data![index].img)
                                        ? Image.network(
                                            Config.resolveImageUrl(paymentGatwayApiModel!.data![index].img),
                                            errorBuilder: (_, __, ___) => Icon(Icons.payment, color: linercolor),
                                          )
                                        : Icon(Icons.payment, color: linercolor),
                                  ),
                                ),
                                SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        "${paymentGatwayApiModel!.data![index].title}",
                                        style: TextStyle(
                                          fontSize: 17,
                                          fontFamily: 'Gilroy_Bold',
                                          color: notifier.text,
                                        ),
                                      ),
                                      SizedBox(
                                        child: Text(
                                          "${paymentGatwayApiModel!.data![index].subtitle}",
                                          // maxLines: 3,
                                          // overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontSize: 14,
                                            fontFamily: 'Gilroy_Medium',
                                            color: greaycolor,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Radio(
                                  activeColor: linercolor,
                                  fillColor: WidgetStateProperty.resolveWith<Color>((states) => notifier.darklinercolor),
                                  value: _groupValue == int.parse(paymentGatwayApiModel!.data![index].id!)
                                      ? true
                                      : false,
                                  groupValue: true,
                                  onChanged: (value) {
                                    setState(() {});
                                  },
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                      separatorBuilder: (BuildContext context, int index) {
                        return paymentGatwayApiModel!.data![index].pShow == "0"
                          ? SizedBox()
                          : SizedBox(height: 10);
                      },
                    ),
                  ),
                ],
              );
            }),
          ),
        );
      },
    );
  }

  Widget paynowbutton() {
    return Container(
      height: Get.height / 16,
      width: Get.width / 1.1,
      decoration: BoxDecoration(
        color: const Color(0xff04D80D),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: Text(
          "${"PAY NOW".tr} | $currency$grandTotal",
          style: TextStyle(
            color: whitecolor,
            fontSize: Get.height / 50,
            fontFamily: 'Gilroy_Medium',
          ),
        ),
      ),
    );
  }

  Widget sugestlocationtype({
    Function()? ontap,
    title,
    val,
    image,
    adress,
    radio,
    Color? borderColor,
  }) {
    return StatefulBuilder(
      builder: (BuildContext context, StateSetter setState) {
        return InkWell(
          onTap: ontap,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: Get.width / 18),
            child: Container(
              height: Get.height / 10,
              decoration: BoxDecoration(
                border: Border.all(color: borderColor!, width: 1),
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Row(
                children: [
                  SizedBox(width: Get.width / 55),
                  Container(
                    height: Get.height / 12,
                    width: Get.width / 5.5,
                    decoration: BoxDecoration(
                      color: const Color(0xffF2F4F9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Center(
                      child: Image.network(
                        image,
                        height: Get.height / 08,
                      ),
                    ),
                  ),
                  SizedBox(width: Get.width / 30),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(height: Get.height * 0.01),
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: Get.height / 55,
                          fontFamily: 'Gilroy_Bold',
                          color: blackcolor,
                        ),
                      ),
                      SizedBox(
                        width: Get.width * 0.50,
                        child: Text(
                          adress,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: Get.height / 65,
                            fontFamily: 'Gilroy_Medium',
                            color: greaycolor,
                          ),
                        ),
                      ),
                    ],
                  ),
                  Spacer(),
                  radio
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  buyMapinfoget() {
    setState(() {
      isLoading = true;
    });
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {"orderid": orderid};
    ApiWrapper.dataPostNode(Config.nodeBuyMapInfo, data).then(
      (val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            log(val["BuyMapinfo"].toString(), name: "BuyMapinfo : ");
            buyMapinfo = val["BuyMapinfo"];
            buyMapinfo["item_list"].forEach((e) {
              if (e["item_confirm"] == "1") {
                payshow = true;
                setState(() {});
              } else {
                setState(() {});
                payshow = false;
              }
            });
            grandTotal = valuePlus(buyMapinfo["service_bill"], buyMapinfo["service_charge"]);
            setState(() {
              isLoading = false;
            });
          } else {
            setState(() {
              isLoading = false;
            });
          }
        }
      },
    );
  }

  //!--------------------------- payment Widget --------------------
  stripePayment() {
    return showModalBottomSheet(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      backgroundColor: notifier.getBgColor,
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setState) {
            return SingleChildScrollView(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Padding(
                padding: const EdgeInsets.all(15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      "Add Your payment information".tr,
                      style: TextStyle(
                        fontFamily: "Gilroy_Bold",
                        fontSize: 20,
                        color: notifier.text
                      ),
                    ),
                    SizedBox(height: 20),
                    Form(
                      key: _formKey,
                      autovalidateMode: _autoValidateMode,
                      child: Column(
                        children: [
                          textfild(
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(19),
                              CardNumberInputFormatter()
                            ],
                            keyboardType: TextInputType.number,
                            controller: numController,
                            onSaved: (String? value) {
                              _paymentCard.number = CardUtils.getCleanedNumber(value!);
                              
                              CardType cardType = CardUtils.getCardTypeFrmNumber(_paymentCard.number.toString());
                              setState(() {
                                _card.name = cardType.toString();
                                _paymentCard.type = cardType;
                              });
                            },
                            onChanged: (val) {
                              CardType cardType = CardUtils.getCardTypeFrmNumber(val);
                              setState(() {
                                _card.name = cardType.toString();
                                _paymentCard.type = cardType;
                              });
                            },
                            hintText: "What number is written on card?".tr,
                            labelText: "Number".tr,
                            validator: CardUtils.validateCardNum,
                            prefixIcon: SizedBox(
                              height: 10,
                              child: Padding(
                                padding: EdgeInsets.symmetric(
                                  vertical: 14,
                                  horizontal: 6,
                                ),
                                child: CardUtils.getCardIcon(_paymentCard.type),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: textfild(
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(3),
                                  ],
                                  hintText: "Number behind the card".tr,
                                  labelText: "CVV".tr,
                                  prefixIcon: SizedBox(
                                    height: 10,
                                    child: Padding(
                                      padding: EdgeInsets.symmetric(vertical: 14),
                                      child: Image.asset(
                                        'assets/card_cvv.png',
                                        width: 6,
                                        color: linercolor,
                                      ),
                                    ),
                                  ),
                                  validator: CardUtils.validateCVV,
                                  keyboardType: TextInputType.number,
                                  onSaved: (value) {
                                    _paymentCard.cvv = int.parse(value!);
                                  },
                                ),
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: textfild(
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(4),
                                    CardMonthInputFormatter()
                                  ],
                                  hintText: "MM/YY".tr,
                                  labelText: "Expiry Date".tr,
                                  prefixIcon: SizedBox(
                                    height: 10,
                                    child: Padding(
                                      padding: EdgeInsets.symmetric(vertical: 14),
                                      child: Image.asset(
                                        'assets/calender.png',
                                        width: 10,
                                        color: linercolor,
                                      ),
                                    ),
                                  ),
                                  validator: CardUtils.validateDate,
                                  keyboardType: TextInputType.number,
                                  onSaved: (value) {
                                    List<int> expiryDate = CardUtils.getExpiryDate(value!);
                                    _paymentCard.month = expiryDate[0];
                                    _paymentCard.year = expiryDate[1];
                                  },
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 20),
                          Container(
                            alignment: Alignment.center,
                            child: _getPayButton(),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  void dispose() {
    numController.removeListener(_getCardTypeFrmNumber);
    numController.dispose();
    super.dispose();
  }

  void _getCardTypeFrmNumber() {
    String input = CardUtils.getCleanedNumber(numController.text);
    CardType cardType = CardUtils.getCardTypeFrmNumber(input);
    setState(() {
      _paymentCard.type = cardType;
    });
  }

  billPayApi(otid) {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var body = {
      "uid": uid,
      "order_id": orderid,
      "p_method_id": _groupValue,
      "trans_id": otid,
      "amt": grandTotal
    };
    ApiWrapper.dataPostNode(Config.nodePayBill, body).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        log(val.toString(), name: "Pay Bill Api =====>>>>> : ");

        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "Pay Bill Api =====>>>>> : ");
          Get.off(() => const TrakingStore(type: "OrderPage1"));
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
        }
      }
    });
  }

  PaymentGatwayApiModel? paymentGatwayApiModel;

  paymenrgatway() {
    ApiWrapper.dataGetNode(Config.nodePaymentGateways).then((val) {
      var data = jsonEncode(val);
      debugPrint("============ payment gateway =========== $val");
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
          paymentGatwayApiModel = paymentGatwayApiModelFromJson(data);
        }
      }
    });
  }

  Widget _getPayButton() {
    return SizedBox(
      width: Get.width,
      child: CupertinoButton(
        onPressed: () {
          final FormState form = _formKey.currentState!;
          if (!form.validate()) {
            setState(() {
              _autoValidateMode = AutovalidateMode.always; // Start validating on every change.
            });
            ApiWrapper.showToastMessage("Please fix the errors in red before submitting.".tr);
          } else {
            var username = getdata.read("UserLogin")["name"];
            var email = getdata.read("UserLogin")["email"];
            _paymentCard.name = username;
            _paymentCard.email = email;
            _paymentCard.amount = grandTotal;
            form.save();
            debugPrint('------- name ------- ${_paymentCard.name}');
            debugPrint('------- email ------- ${_paymentCard.email}');
            debugPrint('------- amount ------- ${_paymentCard.amount}');
            debugPrint('------- month ------- ${_paymentCard.month}');
            debugPrint('------- year ------- ${_paymentCard.year}');
            webViewPaymentMethod(
              initialUrl: "${Config.imageURLPath + Config.stripe}name=${_paymentCard.name}&email=${_paymentCard.email}&cardno=${_paymentCard.number}&cvc=${_paymentCard.cvv}&amt=${_paymentCard.amount}&mm=${_paymentCard.month}&yyyy=${_paymentCard.year}",
              status1: "status",
              status2: "success",
              tId: "Transaction_id",
            );
            ApiWrapper.showToastMessage("Payment card is valid".tr);
          }
        },
        color: linercolor,
        child: Text(
          "${"PAY".tr} $currency$grandTotal",
          style: TextStyle(
            fontSize: 17,
            color: whitecolor,
          ),
        ),
      ),
    );
  }

  webViewPaymentMethod({
    required String initialUrl,
    required String status1,
    required String status2,
    required String tId,
  }) {
    debugPrint("************* coman webview *************");
    Get.back();
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => PaymentWebVIew(
          initialUrl: initialUrl,
          navigationDelegate: (request) async {
            final uri = Uri.parse(request.url);

            debugPrint("************ URL *****:--- $initialUrl");
            debugPrint("************ Navigating to URL: ${request.url}");
            debugPrint("************ Parsed URI: $uri");
            debugPrint("************ 2435243254: ${uri.queryParameters[status1]}");
            debugPrint("************ queryParamiter: ${uri.queryParametersAll}");
            debugPrint("************ queryParamiter transaction_id: ${uri.queryParameters[tId]}");

            final status = uri.queryParameters[status1];
            debugPrint(" /*/*/*/*/*/*/*/*/*/*/*/*/*/ Status ---- $status");
            if (status == null) {
              debugPrint("No status parameter found.");
            } else {
              debugPrint("Status parameter: $status");
              if (status == status2) {
                debugPrint("Purchase successful.");
                billPayApi("${uri.queryParameters[tId]}");
                return NavigationDecision.prevent;
              } else {
                debugPrint("Purchase failed with status: $status.");
                Navigator.pop(context);
                tostmsg(status);
                return NavigationDecision.prevent;
              }
            }
            return NavigationDecision.navigate;
          },
        ),
      ),
    );
  }

}
