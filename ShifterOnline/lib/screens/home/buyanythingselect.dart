// ignore_for_file: deprecated_member_use, use_build_context_synchronously, prefer_typing_uninitialized_variables

import 'dart:convert';
import 'dart:math';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:goParcel/Api/AppModelApi/payment_gatwey_api_model.dart';
import 'package:goParcel/Payment/pay_stack_payment.dart';
import 'package:goParcel/Payment/paypal/src/screens/paypal_screen.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:goParcel/Payment/web_view.dart';
import 'package:goParcel/screens/home/selectastore.dart';
import 'package:flutter_svg/svg.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../AppDataBase/BuyAnything.dart';
import '../../Payment/InputFormater.dart';
import '../../Payment/Payment_card.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../home/home.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:sqflite/sqlite_api.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';
import 'package:sqflite/sqflite.dart' as sql;

import '../authscreen/signin.dart';
import '../myorder/myordertabs/completed_order.dart';
import 'CouponList.dart';
import 'orderSuccess.dart';
import 'traking.dart';

class ItemListDelet {
  static Future<Database> database() async {
    final dbPath = await sql.getDatabasesPath();
    return sql.openDatabase(path.join(dbPath, 'byanything.db'), version: 1);
  }
}

class BuyAnythingSelect extends StatefulWidget {
  final String? type;
  const BuyAnythingSelect({super.key, this.type});
  @override
  State<BuyAnythingSelect> createState() => _BuyAnythingSelectState();
}

class _BuyAnythingSelectState extends State<BuyAnythingSelect> with SingleTickerProviderStateMixin {

  // ----------- toolTip ---------------
  final GlobalKey _buttonKey = GlobalKey();
  OverlayEntry? _overlayEntry;
  bool _tooltipVisible = false;
  // ------------------------------------

  List addressList = [];
  bool itemValue = false;
  bool itemcount = false;
  bool itemcount1 = false;
  bool isLogin = false;

  var count;

  final List<TextEditingController> _controllers = [];
  final sql = Additemlist();
  String selectID = "2022-07-14 11:38:58.331924";
  var selectdCell = [];
  var users;
  int _groupValue = 0;
  String dropaddress = "";

  String customerName = "";
  String customerMobileNumber = "";

  String? daddress = "";
  String? dcNumber = "";
  String? daddresstype = "Home";
  String? taskaddress = "Task Details".tr;
  String? taskselectitem;
  String? tasktype = "Task Details".tr;
  String? taskDetail;
  String? selectidpay = "3";
  String? paymenttital;
  String? addressID = "0";
  String? hno;
  String? couponcode = "Apply Now";
  String? applycode = "applied";
  String? dlandmark;

  var iconImage1 = "";
  var lat1;
  var lon1;
  var lat2;
  var lon2;

//!--------- new caluculation variable ----------
   
  double bkms = 0;
  double abkms = 0;
  double bprice = 0;
  double abprice = 0;
  double additionalKmCharge = 0;
  double deliveryfees = 0;
  double totalDeliveryfees = 0;
  double dcharge = 0;
  double exmilecharge = 0;
  double totaldistance = 0.0;

// ----------------------------------------------


//!--- Coupon id amount ---
  String? cid = "0";
  String? camount = "0";
  String? totalfees = "0";
  bool addressbutton = false;

  dynamic totaltime;
  
  RazorPayClass razorPayClass = RazorPayClass();

  bool isPaymentLoding = false;

  int itemLimit = 0;

  @override
  void initState() {
    _hideTooltip();
    debugPrint("==============dsffd== $_controllers");
    getdata.remove("SelectStore");
    initStatData();
    super.initState();
  }

  initStatData() {
    debugPrint("================ $deliveryfees");
    itemLimit = int.parse("${priceData["itemlimit"]}");
    debugPrint("======== itemlimit ======== $itemLimit");

    isLogin = getdata.read("firstLogin") ?? false;
    setState(() {});
    _paymentCard.type = CardType.Others;
    numberController.addListener(_getCardTypeFrmNumber);
    paymenrgatway();
    checkAddress();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: handlePaymentSuccess,
      handlePaymentError: handlePaymentError,
      handleExternalWallet: handleExternalWallet,
    );
  }

  void handlePaymentSuccess(PaymentSuccessResponse response) {
    buyNoworder(response.paymentId);
    debugPrint("++++++++++++++++++++++++ Payment success :");
  }

  void handlePaymentError(PaymentFailureResponse response) {
    isPaymentLoding = false;
    setState(() {});
    debugPrint("++++++++++++++++++++++++ Payment failed : $response");
  }

  void handleExternalWallet(ExternalWalletResponse response) {
    isPaymentLoding = false;
    setState(() {});
  }

  //! String reversed value
  String reverse0(String s) {
    return s.split('').reversed.join('');
  }

  sqlDBDelete() async {
    final db = await ItemListDelet.database();
    await db.rawQuery('DELETE FROM itemlist');
    sql.saveitemlist(id: DateTime.now().toString(), title: "", count: "1");
    sql.fetchitemlist();
    setState(() {});
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    bkms = 0;
    abkms = 0;
    bprice = 0;
    abprice = 0;
    additionalKmCharge = 0;
    totalDeliveryfees = 0;
    deliveryfees = 0;
    dcharge = 0;
    exmilecharge = 0;

    setState(() {});

    // Calculate distance using Haversine formula
    if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
      double latDiff = (lat1 - lat2).abs();
      double lonDiff = (lon1 - lon2).abs();

      if ((lat1 == lat2 && lon1 == lon2) || (latDiff < 0.0001 && lonDiff < 0.0001)) {
        totaldistance = 1.0;
      } else {
        var p = 0.017453292519943295;
        var a = 0.5 -
            cos((lat2 - lat1) * p) / 2 +
            cos(lat1 * p) * cos(lat2 * p) * (1 - cos((lon2 - lon1) * p)) / 2;
        double airDistance = 12742 * asin(sqrt(a));
        double estimatedRoadDist = airDistance * 1.25;
        if (estimatedRoadDist.isNaN || estimatedRoadDist.isInfinite || estimatedRoadDist < 0.1) {
          totaldistance = 1.0;
        } else {
          totaldistance = double.parse(estimatedRoadDist.toStringAsFixed(2));
          if (totaldistance <= 0) totaldistance = 1.0;
        }
      }
    } else {
      totaldistance = 1.0;
    }
   
    setState(() {});

    if (totaldistance <= num.parse("${priceData["bkms"]}")) {
     
      setState(() {});
      deliveryfees = bprice.roundToDouble();
     
     
      
    } else {
      debugPrint("================== Log 2 =================== ");
      setState(() {});
      abprice = double.parse("${priceData["abprice"]}");
      debugPrint("==========================> abprice :- $abprice");
    
      debugPrint("===============> additionalKmCharge :- $additionalKmCharge");
      var kmrate = bprice + additionalKmCharge;
  
      dcharge = kmrate;
     

      if (totaldistance > num.parse(priceData["kilo_limit"].toString()) || priceData["is_wether_bad"] == "1") {
        debugPrint("================== Log 2 A=================== ");
        debugPrint("===========> priceData[mile_charge] :- ${priceData["mile_charge"]}");
        debugPrint("=====================> deliveryfees :- $deliveryfees");
        exmilecharge = deliveryfees + double.parse("${priceData["mile_charge"]}") / 100;
        debugPrint("=====================> exmilecharge :- $exmilecharge");
        
         
      } else {
        debugPrint("================== Log 2 B=================== ");
        exmilecharge = 0;
      }
      
    }
    totalDeliveryfees = deliveryfees;
    debugPrint("================> totalDeliveryfees :- $totalDeliveryfees");
    setState(() {});
    return totaldistance;
  }

  @override
  Widget build(BuildContext context) {
    Future.delayed(Duration(seconds: 0), () => setState(() {}));
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      resizeToAvoidBottomInset: false,
      appBar: AppBar(
        title: Text(
          "Buy anything".tr,
          style: TextStyle(
            color: whitecolor,
            fontFamily: "Gilroy_Bold",
          ),
        ),
        centerTitle: true,
        elevation: 0,
        backgroundColor: linercolor,
      ),
      backgroundColor: linercolor,
      //! ---------- Open payment Sheet -------------
      //! user id check
      bottomNavigationBar: Container(
        padding: EdgeInsets.only(
          left: 10,
          right: 10,
          bottom: MediaQuery.of(context).viewInsets.bottom + 
                  MediaQuery.of(context).padding.bottom + 10
        ),
        decoration: BoxDecoration(color: notifier.lightBgColor),
        child: users != null && users.length > 1
          ? appButton1(
              tital: "${"PAY".tr} $currency${deliveryfees.toStringAsFixed(2)} ${"& PLACE YOUR ORDER NOW".tr}",
              onTap: () {
                debugPrint("-------------- name ${getdata.read("SelectStore")["name"]}");
                if (isLogin) {
                  setState(() {
                    paymenttital = "";
                    _groupValue = 0;
                    isPaymentLoding = false;
                  });
                  paymentSheet();
                } else {
                  Get.to(SignIn(paymenttype: "payment"))!.then((value) {
                     initStatData();
                  });
                }
              },
            )
          : SizedBox(height: 0,width: 0),
      ), 
      body: Container(
        height: Get.height,
        padding: EdgeInsets.only(top: 2),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Stack(
          children: [
            SingleChildScrollView(
              physics: BouncingScrollPhysics(),
              padding: EdgeInsets.all(15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Select any store and".tr,
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 18,
                    ),
                  ),
                  SizedBox(height: 8),
                  Text(
                    "Buy Anything".tr,
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 15,
                    ),
                  ),
                  SizedBox(height: 20),
                  //! --------------- Selected Store -------------------
                  InkWell(
                    onTap: () {
                      Get.to(() => SelectAStore())!.then((value) {
                        lat1 = getdata.read("SelectStore")["geometry"]["location"]["lat"];
                        lon1 = getdata.read("SelectStore")["geometry"]["location"]["lng"];
                        debugPrint("=========== select Store lat1 ========= $lat1");
                        debugPrint("=========== select Store lon1 ========= $lon1");
                        if ((lat1 != null && lat2 != null && lon1 != null && lon2 != null)) {
                          calculateDistance(lat1, lon1, lat2, lon2);
                        }
                      });
                    },
                    child: removetextfield(),
                  ),
                  SizedBox(height: 10),
                  Text(
                    "Make a list of items you need".tr,
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 18,
                    ),
                  ),
                  SizedBox(height: 10),
                  FutureBuilder(
                    future: sql.fetchitemlist(),
                    builder: (ctx, AsyncSnapshot snap) {
                      if (snap.hasData) {
                        users = snap.data;
                        return users.length == 0
                            ? Column(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  SizedBox(height: 100),
                                  Center(
                                    child: Text(
                                      "No Data".tr,
                                      style: TextStyle(
                                        color: notifier.text,
                                        fontFamily: "Gilroy_Bold",
                                      ),
                                    ),
                                  ),
                                ],
                              )
                            : ListView.separated(
                                padding: EdgeInsets.only(bottom: Get.height * 0.02),
                                itemCount: users.length,
                                shrinkWrap: true,
                                physics: NeverScrollableScrollPhysics(),
                                itemBuilder: (ctx, i) {
                                  _controllers.add(TextEditingController());
                                  return textfild(
                                    controller: _controllers[i],
                                    onChanged: (val) {
                                      debugPrint("==============dsffd== $_controllers");
                                      selectID = users[i].id;
                                      setState(() {});
                                      selectID == users[i].id
                                          ? sql.updatetitle(id: users[i].id, title: val)
                                          : SizedBox();
                                    },
                                    hintText: "Add an Item".tr,
                                    fillColor: notifier.getBgColor,
                                    suffixIcon: Container(
                                      margin: EdgeInsets.only(right: 10),
                                      width: selectdCell.contains(users[i].id) ? 80 : 30,
                                      child: Row(
                                        mainAxisAlignment: MainAxisAlignment.end,
                                        children: [
                                          selectdCell.contains(users[i].id)
                                            ? Row(
                                                children: [
                                                  itembutton(
                                                    boxColor: notifier.isDark ? greaycolor :  greaycolor.withOpacity(0.4),
                                                    icon: Icons.remove,
                                                    iconColor: notifier.getBgColor,
                                                    onTap: () {
                                                      setState(() {});
                                                      selectID = users[i].id;
                                                      if (users[i].count != "1") {
                                                        selectID == users[i].id
                                                            ? setState(() {
                                                                var count = int.parse(users[i].count) - 1;
                                                                sql.updateitemList(
                                                                  id: users[i].id,
                                                                  count: count.toString(),
                                                                );
                                                              })
                                                            : SizedBox();
                                                      } else {
                                                        setState(() {});
                                                        _controllers.remove(_controllers[i]);
                                                        selectdCell.remove(users[i].id);
                                                        sql.deleteitemlist(users[i].id);
                                                        sql.fetchitemlist();
                                                      }
                                                    },
                                                  ),
                                                  SizedBox(width: 10),
                                                  Text(
                                                    users[i].count,
                                                    style: TextStyle(
                                                      color: notifier.darklinercolor,
                                                      fontFamily: 'Gilroy_Bold',
                                                      fontSize: 15,
                                                    ),
                                                  ),
                                                  SizedBox(width: 10),
                                                ],
                                              )
                                            : SizedBox(),
                                        !selectdCell.contains(users[i].id)
                                          ? itembutton(
                                              boxColor: linercolor,
                                              icon: Icons.add,
                                              iconColor: whitecolor,
                                              onTap: () {
                                                getdata.read("SelectStore") != null
                                                    ? _controllers[i].text != ""
                                                        ? setState(() {
                                                            selectdCell.add(users[i].id);
                                                            sql.saveitemlist(
                                                              id: DateTime.now().toString(),
                                                              title: "",
                                                              count: "1",
                                                            );
                                                          })
                                                        : tostmsg("Enter your item name".tr)
                                                    : tostmsg("select store".tr);
                                                sql.fetchitemlist();
                                              },
                                            )
                                          : itembutton(
                                            boxColor: linercolor,
                                            icon: Icons.add,
                                            iconColor: whitecolor,
                                            onTap: () {
                                              selectID = users[i].id;
                                              setState(() {});
                                              selectID == users[i].id
                                                  ? setState(() {
                                                      count = int.parse(users[i].count) + 1;
                                                      if (itemLimit >= count) {
                                                        sql.updateitemList(
                                                          id: users[i].id,
                                                          count: count.toString(),
                                                        );
                                                      } else {
                                                        tostmsg("Maximum limit reached");
                                                      }
                                                    })
                                                  : SizedBox();
                                            },
                                          ),
                                        ],
                                      ),
                                    ),
                                    prefixIcon: Padding(
                                      padding: const EdgeInsets.all(13),
                                      child: Image.asset(
                                        "assets/note.png",
                                        color: notifier.darklinercolor,
                                        height: 25,
                                      ),
                                    ),
                                  );
                                }, separatorBuilder: (BuildContext context, int index) { 
                                 return SizedBox(height: 10);
                                },
                              );
                      } else {
                        return Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            SizedBox(height: 200),
                            Center(child: CircularProgressIndicator(color: notifier.darklinercolor)),
                          ],
                        );
                      }
                    },
                  ),
                  users != null && users.length > 1
                      ? Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          //! ---------------- Apply Coupon code ---------------
                          Text(
                            "Apply Coupon".tr,
                            style: TextStyle(
                              color: notifier.text,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 18,
                            ),
                          ),
                          SizedBox(height: 10),
                          applycoupon(
                            title: couponcode,
                            subtitle: couponcode == "Apply Now"
                                ? ""
                                : applycode,
                            suffix: couponcode == "Apply Now"
                                ? InkWell(
                                    onTap: () {
                                      if (isLogin) {
                                        totalfees = deliveryfees.toStringAsFixed(2);
                                        Get.to(CouponListPage(bill: deliveryfees.toStringAsFixed(2)))!.then((value) {
                                          if (value != null) {
                                            cid = value["id"];
                                            camount = value["c_value"];
                                            couponcode = value["coupon_code"];
                                            couponcode = value["coupon_code"];
                                            deliveryfees = (deliveryfees - double.parse(value["c_value"].toString())).roundToDouble();
                                          }
                                        });
                                      } else {
                                        Get.to(SignIn(paymenttype: "BuyAnything"))!.then((value) {
                                           initStatData();
                                        });
                                      }
                                    },
                                    child: Image.asset(
                                      "assets/arrowcircleright.png",
                                      height: 24,
                                      color: notifier.darklinercolor,
                                    ),
                                  )
                                : InkWell(
                                    onTap: () {
                                      setState(() {});
                                      cid = '0';
                                      couponcode = "Apply Now";
                                      deliveryfees = (deliveryfees + double.parse("$camount")).roundToDouble();
                                    },
                                    child: Container(
                                      height: 20,
                                      width: 20,
                                      decoration: BoxDecoration(
                                        color: greaycolor,
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: const Center(
                                        child: Icon(
                                          Icons.close,
                                          color: Colors.white,
                                          size: 16,
                                        ),
                                      ),
                                    ),
                                  ),
                          ),
                          SizedBox(height: 10),
                          Text(
                            "Delivery Address".tr,
                            style: TextStyle(
                              color: notifier.text,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 18,
                            ),
                          ),
                          SizedBox(height: 10),
                            addressList.isNotEmpty
                              ? InkWell(
                                  onTap: () {
                                    //! ----------- Select diliver Address ---------
                                    bottomsheets().then((value) {
                                      couponcode = "Apply Now";
                                      FocusScope.of(context).requestFocus(FocusNode());
                                      setState(() {});
                                    });
                                  },
                                  child: Container(
                                    padding: EdgeInsets.all(10),
                                    decoration: BoxDecoration(
                                      color: notifier.getBgColor,
                                      borderRadius: BorderRadius.circular(15),
                                    ),
                                    child: Column(
                                      children: [
                                        Row(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Container(
                                              height: 70,
                                              width: 70,
                                              padding: EdgeInsets.all(15),
                                              decoration: BoxDecoration(
                                                color: notifier.getimag,
                                                borderRadius: BorderRadius.circular(15),
                                              ),
                                              child: Image.asset(
                                                iconImage1,
                                                color: notifier.darklinercolor,
                                              ),
                                            ),
                                            SizedBox(width: 10),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    daddresstype!,
                                                    style: TextStyle(
                                                      color: notifier.text,
                                                      fontFamily: 'Gilroy_Bold',
                                                      fontSize: 18,
                                                    ),
                                                  ),
                                                  Text(
                                                    daddress == ""
                                                        ? "$hno, $dropaddress"
                                                        : "$hno, $daddress, $dropaddress",
                                                    maxLines: 3,
                                                    overflow: TextOverflow.ellipsis,
                                                    style: TextStyle(
                                                      color: greaycolor.withOpacity(0.8),
                                                      fontFamily: 'Gilroy_Medium',
                                                      fontSize: Get.width / 28,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            SvgPicture.asset(
                                              "assets/edit.svg",
                                              height: 20,
                                              color: notifier.darklinercolor,
                                            ),
                                          ],
                                        ),
                                        SizedBox(height: 8),
                                        addressCustomerdetails(
                                          name: customerName,
                                          number: customerMobileNumber,
                                        ),
                                      ],
                                    ),
                                  ),
                                )
                              : InkWell(
                                  onTap: () {
                                    Get.to(() => Traking(addressAdd: "0"))!.then((value) {
                                      if (value != null && value != "back") {
                                        addressID = getdata.read("DropeAddress")[0]["id"];
                                        lat2 = getdata.read("DropeAddress")[0]["lat_map"];
                                        lon2 = getdata.read("DropeAddress")[0]["long_map"];
                                        hno = getdata.read("DropeAddress")[0]["hno"];
                                        daddress = getdata.read("DropeAddress")[0]["landmark"];
                                        dropaddress = getdata.read("DropeAddress")[0]["address"];
                                        daddresstype = getdata.read("DropeAddress")[0]["type"];
                                        customerName = getdata.read("DropeAddress")[0]["c_name"];
                                        customerMobileNumber = getdata.read("DropeAddress")[0]["c_number"];
                                        setState(() {});
                                        switch (getdata.read("DropeAddress")[0]["type"]) {
                                          case "Home":
                                            iconImage1 = "assets/selecthome.png";
                                            break;
                                          case "Office":
                                            iconImage1 = "assets/selectoffice.png";
                                            break;
                                          case "Other":
                                            iconImage1 = "assets/selectothers.png";
                                            break;
                                          default:
                                        }
                                        calculateDistance(lat1, lon1, lat2, lon2);
                                        checkAddress();
                                        setState(() {});
                                      }
                                    });
                                    setState(() {});
                                  },
                                  child: dropaddress != ""
                                   ? Container(
                                    padding: EdgeInsets.all(10),
                                    decoration: BoxDecoration(
                                      color: notifier.getBgColor,
                                      borderRadius: BorderRadius.circular(15),
                                    ),
                                    child: Column(
                                      children: [
                                        Row(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Container(
                                              height: 70,
                                              width: 70,
                                              padding: EdgeInsets.all(15),
                                              decoration: BoxDecoration(
                                                color: notifier.getimag,
                                                borderRadius: BorderRadius.circular(15),
                                              ),
                                              child: Image.asset(
                                                iconImage1,
                                                color: notifier.darklinercolor,
                                              ),
                                            ),
                                            SizedBox(width: 10),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    daddresstype!,
                                                    style: TextStyle(
                                                      color: notifier.text,
                                                      fontFamily: 'Gilroy_Bold',
                                                      fontSize: 18,
                                                    ),
                                                  ),
                                                  Text(
                                                    daddress == ""
                                                        ? "$hno, $dropaddress"
                                                        : "$hno, $daddress, $dropaddress",
                                                    maxLines: 3,
                                                    overflow: TextOverflow.ellipsis,
                                                    style: TextStyle(
                                                      color: greaycolor.withOpacity(0.8),
                                                      fontFamily: 'Gilroy_Medium',
                                                      fontSize: Get.width / 28,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            SvgPicture.asset(
                                              "assets/edit.svg",
                                              height: 20,
                                              color: notifier.darklinercolor,
                                            ),
                                          ],
                                        ),
                                        SizedBox(height: 8),
                                        addressCustomerdetails(
                                          name: customerName,
                                          number: customerMobileNumber,
                                        ),
                                      ],
                                    ),
                                  )
                                  : bottomsheetaddlocation(bordercolor: linercolor),
                                ),
                          SizedBox(height: 10),
                          Text(
                            "Store Bill".tr,
                            style: TextStyle(
                              color: notifier.text,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 18,
                            ),
                          ),
                          SizedBox(height: 10),
                          //!------- Coupon price ---------
                          couponcode != "Apply Now"
                              ? Column(
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        InkWell(
                                          key: _buttonKey,
                                          onTap: () => _toggleTooltip(),
                                          child: Row(
                                            children: [
                                              InkWell(
                                                child: Text(
                                                  "Delivery Fees".tr,
                                                  style: TextStyle(
                                                    color: greaycolor.withOpacity(0.8),
                                                    fontFamily: 'Gilroy_Medium',
                                                    fontSize: 15,
                                                  ),
                                                ),
                                              ),
                                              SizedBox(width: 5),
                                              SvgPicture.asset(
                                                "assets/info-circle.svg",
                                                color: greaycolor.withOpacity(0.8),
                                                height: 18,
                                              ),
                                            ],
                                          ),
                                        ),
                                        Text(
                                          "$currency${totalfees ?? 0}",
                                          style: TextStyle(
                                            color: blackcolor,
                                            fontFamily: 'Gilroy_Bold',
                                            fontSize: 15,
                                          ),
                                        ),
                                      ],
                                    ),
                                    SizedBox(height: 10),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Text(
                                          "Coupon discount".tr,
                                          style: TextStyle(
                                            color: greaycolor.withOpacity(0.8),
                                            fontFamily: 'Gilroy_Medium',
                                            fontSize: 15,
                                          ),
                                        ),
                                        Spacer(),
                                        Text(
                                          "- $currency${camount ?? 0}",
                                          style: TextStyle(
                                            color: greencolor,
                                            fontFamily: 'Gilroy_Bold',
                                            fontSize: 15,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                )
                              : SizedBox(),
                          couponcode == "Apply Now"
                            ? SizedBox()
                            : Divider(color: greaycolor),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    couponcode != "Apply Now"
                                    ? Text(
                                        "To Pay".tr,
                                        style: TextStyle(
                                          color: greaycolor.withOpacity(0.8),
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 15,
                                        ),
                                      )
                                    : InkWell(
                                        key: _buttonKey,
                                        onTap: () => _toggleTooltip(),
                                        child: Row(
                                          children: [
                                            InkWell(
                                              child: Text(
                                                "To Pay".tr,
                                                style: TextStyle(
                                                  color: greaycolor.withOpacity(0.8),
                                                  fontFamily: 'Gilroy_Medium',
                                                  fontSize: 15,
                                                ),
                                              ),
                                            ),
                                            SizedBox(width: 5),
                                            SvgPicture.asset(
                                              "assets/info-circle.svg",
                                              color: greaycolor.withOpacity(0.8),
                                              height: 18,
                                            ),
                                          ],
                                        ),
                                      ),
                                    Text(
                                      "$currency${deliveryfees.toStringAsFixed(2)}",
                                      style: TextStyle(
                                        color: blackcolor,
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 15,
                                      ),
                                    ),
                                  ],
                                ),
                                SizedBox(height: 10),
                                Container(
                                  padding: EdgeInsets.all(10),
                                  width: Get.width,
                                  decoration: BoxDecoration(
                                    color: greencolor.withOpacity(0.2),
                                    borderRadius: BorderRadius.all(
                                      Radius.circular(18),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                    children: [
                                      Image.asset(
                                        "assets/tickcircle.png",
                                        height: 25,
                                      ),
                                      SizedBox(width: 10),
                                      Expanded(
                                        child: Text(
                                          "Pay store bill once you confirm the item sent by delivery partner".tr,
                                          style: TextStyle(
                                            color: Color(0xff00D261),
                                            fontFamily: 'Gilroy_Medium',
                                            fontSize: 15,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            )
                      : Column(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Container(
                              padding: EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: orangecolor.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(15),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.info_rounded,
                                    color: Color(0xffE68C00),
                                  ),
                                  SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      "${"Delivery Fee Starting at".tr} $currency${priceData["bprice"]} ${"for first".tr} ${priceData["bkms"]} ${"kms".tr}",
                                      maxLines: 2,
                                      style: TextStyle(
                                        color: Color(0xffE68C00),
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 15,
                                      ),
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

            isPaymentLoding
              ? Center(child: CircularProgressIndicator(color: linercolor))
              : SizedBox(),
          ],
        ),
      ),
    );
  }

  itembutton({Function()? onTap, Color? boxColor, iconColor, IconData? icon}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        height: 20,
        width: 20,
        decoration: BoxDecoration(
          color: boxColor,
          borderRadius: BorderRadius.circular(5),
        ),
        child: Center(
          child: Icon(
            icon,
            color: iconColor,
            size: 16,
          ),
        ),
      ),
    );
  }

  Widget removetextfield() {
    return Container(
      width: Get.width,
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Image.asset(
            "assets/order.png",
            height: 30,
            color: notifier.darklinercolor,
          ),
          SizedBox(width: 10),
          getdata.read("SelectStore") == null
              ? Expanded(
                  child: Text(
                    "Select a store for items you need".tr,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: greaycolor,
                      fontFamily: 'Gilroy_Bold',
                    ),
                  ),
                )
              : Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        getdata.read("SelectStore")["name"],
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                        ),
                      ),
                      Text(
                        getdata.read("SelectStore")["vicinity"],
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: greaycolor,
                          fontFamily: 'Gilroy_Medium',
                        ),
                      ),
                    ],
                  ),
              ),
          getdata.read("SelectStore") == null
              ? Image.asset(
                  "assets/arrowcircleright.png",
                  height: 30,
                  color: notifier.darklinercolor,
                )
              : InkWell(
                  onTap: () {
                    setState(() {});
                    _controllers.clear();
                    sqlDBDelete();
                    getdata.remove("SelectStore");
                  },
                  child: Container(
                    height: 20,
                    width: 20,
                    decoration: BoxDecoration(
                      color: notifier.darklinercolor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Center(
                      child: Icon(
                        Icons.close,
                        color: notifier.getBgColor,
                        size: 16,
                      ),
                    ),
                  ),
                ),
        ],
      ),
    );
  }

//! Address Sheet selected
  Future bottomsheets() {
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
      enableDrag: false,
      context: context,
      builder: (context) {
        return WillPopScope(
          onWillPop: () async {
            return false;
          },
          child: Container(
            constraints: BoxConstraints(
              maxHeight: Get.height / 1.3,
            ),
            child: StatefulBuilder(
              builder: (BuildContext context, StateSetter setState) {
                  return Padding(
                    padding: EdgeInsets.only(top: 15, left: 15, right: 15),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        InkWell(
                          onTap: () {
                            Navigator.pop(context);
                            Get.to(() => Traking(addressAdd: "0"))!.then((value) {
                              if (value != null && value != "back") {
                                checkAddress();
                                calculateDistance(lat1, lon1, lat2, lon2);
                              }
                            });
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                            decoration: BoxDecoration(
                              color: notifier.getBgColor,
                              borderRadius: BorderRadius.circular(15),
                            ),
                            child: Row(
                              children: [
                                SvgPicture.asset(
                                  "assets/plus-circle.svg",
                                  height: 25,
                                  color: notifier.darklinercolor,
                                ),
                                SizedBox(width: 15),
                                Text(
                                  "Add New Address".tr,
                                  style: TextStyle(
                                    color: notifier.text,
                                    fontSize: 18,
                                    fontFamily: 'Gilroy_Bold',
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        SizedBox(height: 15),
                        Text(
                          "Select location".tr,
                          style: TextStyle(
                            fontSize: 20,
                            fontFamily: 'Gilroy_Bold',
                            color: notifier.text,
                          ),
                        ),
                        SizedBox(height: 10),
                        Flexible(
                          child: ListView.separated(
                            shrinkWrap: true,
                            itemCount: addressList.length,
                            physics: BouncingScrollPhysics(),
                            itemBuilder: (ctx, i) {
                              String? iconImage;
                              //! switch case Add
                              switch (addressList[i]["type"]) {
                                case "Home":
                                  iconImage = "assets/selecthome.png";
                                  break;
                                case "Office":
                                  iconImage = "assets/selectoffice.png";
                                  break;
                                case "Other":
                                  iconImage = "assets/selectothers.png";
                                  break;
                                default:
                              }
                              return addressID ==  addressList[i]["id"]
                              ? SizedBox()
                              : InkWell(
                                onTap: () {
                                  itemValue = false;
                                  addressID = addressList[i]["id"];
                                  lat2 = double.parse(addressList[i]["lat_map"].toString());
                                  lon2 = double.parse(addressList[i]["long_map"].toString());
                                  daddresstype = addressList[i]["type"];
                                  hno = addressList[i]["hno"];
                                  dropaddress = addressList[i]["address"];
                                  daddress = addressList[i]["landmark"];
                                  customerName = addressList[i]["c_name"];
                                  customerMobileNumber = addressList[i]["c_number"];
                                  setState(() {});
                                  switch (addressList[i]["type"]) {
                                    case "Home":
                                      iconImage1 = "assets/selecthome.png";
                                      break;
                                    case "Office":
                                      iconImage1 = "assets/selectoffice.png";
                                      break;
                                    case "Other":
                                      iconImage1 = "assets/selectothers.png";
                                      break;
                                    default:
                                  }
                                  calculateDistance(lat1, lon1, lat2, lon2);
                                  Get.back();
                                },
                                child: Container(
                                  padding: EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    border: Border.all(
                                      color: addressID == addressList[i]["id"]
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
                                          child: Image.asset(
                                            iconImage ?? "",
                                            height: Get.height / 26,
                                            color: notifier.darklinercolor,
                                          ),
                                        ),
                                      ),
                                      SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          mainAxisAlignment: MainAxisAlignment.center,
                                          children: [
                                            Text(
                                              addressList[i]["type"],
                                              style: TextStyle(
                                                fontSize: 17,
                                                fontFamily: 'Gilroy_Bold',
                                                color: notifier.text,
                                              ),
                                            ),
                                            SizedBox(
                                              child: Text(
                                                addressList[i]["landmark"] == ""
                                                  ? "${addressList[i]["hno"]}, ${addressList[i]["address"]}"
                                                  : "${addressList[i]["hno"]}, ${addressList[i]["landmark"]}, ${addressList[i]["address"]}",
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
                                        fillColor: WidgetStateProperty.resolveWith<Color>((states) => notifier.darklinercolor),
                                        activeColor: notifier.darklinercolor,
                                        value:  addressID == addressList[i]["id"]
                                          ? true
                                          : false,
                                        groupValue: true,
                                        onChanged: (value) {
                                          setState(() {});
                                          Get.back();
                                        },
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            }, separatorBuilder: (BuildContext context, int index) { 
                              return addressID ==  addressList[index]["id"]
                              ? SizedBox()
                              : SizedBox(height: 10);
                            },
                          ),
                        ),
                        SizedBox(height: 10),
                      ],
                    ),
                  );
              },
            ),
          ),
        );
      },
    );
  }

  Widget bottomsheetaddlocation({Color? bordercolor}) {
    return StatefulBuilder(
      builder: (BuildContext context, StateSetter setState) {
        return Container(
          padding: EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: whitecolor,
            borderRadius: BorderRadius.circular(15),
          ),
          child: Row(
            children: [
              SvgPicture.asset(
                "assets/plus-circle.svg",
                height: 25,
                color: linercolor,
              ),
              SizedBox(width: 10),
              Text(
                "Add New Address".tr,
                style: TextStyle(
                  color: blackcolor,
                  fontSize: 18,
                  fontFamily: 'Gilroy_Bold',
                ),
              )
            ],
          ),
        );
      },
    );
  }

  Future paymentSheet() {
    int paymentindex = 0;
    notifier = Provider.of(context, listen: false);
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
            floatingActionButton:isPaymentLoding
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
              : InkWell(
              onTap: () {
                save("Lat1", lat1);
                save("lon1", lon1);
                save("Lat2", lat2);
                save("lon2", lon2);
                if (paymenttital != "" && paymenttital != null) {
                  if (isPaymentLoding == false) {
                    setState(() {
                      isPaymentLoding = true;
                    });
                    if (paymenttital == "Razorpay") {
                      debugPrint("Razorpay");
                      debugPrint("--------- key ---------- ${paymentGatwayApiModel!.data![0].attributes}");
                      debugPrint("-------- amount -------- $deliveryfees");
                      debugPrint("-------- number -------- ${getdata.read("UserLogin")["mobile"]}");
                      debugPrint("--------- name --------- ${getdata.read("UserLogin")["name"]}");
                      Get.back();
                      razorPayClass.openCheckout(
                        key: "rzp_test_Rr8n8p41taq6fM", // Test Razorpay key ID
                        amount: deliveryfees.toStringAsFixed(2),
                        number: '${getdata.read("UserLogin")["mobile"]}',
                        name: '${getdata.read("UserLogin")["name"]}',
                      );
                    } else if (paymenttital == "Paypal") {
                      debugPrint("paypal");
                      List ids = paymentGatwayApiModel!.data![paymentindex].attributes.toString().split(",");
                      debugPrint('++++++++++ ids :------ $ids');
                      Get.back();
                      paypalPayment(
                        context: context,
                        amt: "$deliveryfees",
                        clientId: ids[0],
                        secretKey: ids[1],
                        function: (e) {
                          debugPrint("----------- transactionId ---------- ${e["paymentId"]}");
                          buyNoworder("${e["paymentId"]}");
                        }
                      ).then((value) {
                        isPaymentLoding = false;
                        setState(() {});
                      });
                    } else if (paymenttital == "Stripe") {
                      debugPrint("Stripe");
                      Get.back();
                      stripePayment();
                    } else if (paymenttital == "FlutterWave") {
                      debugPrint("FlutterWave");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.flutterwave}amt=$deliveryfees&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "Paytm") {
                      debugPrint("Paytm");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.paytm}amt=$deliveryfees&uid=${getdata.read("Uid")}&mobile=${getdata.read("UserLogin")["mobile"]}&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "SenangPay") {
                      debugPrint("SenangPay");
                      final notificationId = UniqueKey().hashCode;
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.senangPay}detail=Movers&amount=$deliveryfees&order_id=$notificationId&name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}",
                        status1: "msg",
                        status2: "Payment_was_successful",
                        tId: "transaction_id"
                      );
                    } else if (paymenttital == "PayStack") {
                      debugPrint("PayStack");
                      payStackPaymentApi(
                        email: "${getdata.read("UserLogin")["email"]}",
                        amount: "$deliveryfees",
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
                        initialUrl: "${Config.imageURLPath + Config.merpago}amt=$deliveryfees",
                        status1: "status",
                        status2: "successful",
                        tId: "",
                      );
                    } else if (paymenttital == "Payfast") {
                      debugPrint("Payfast");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.payFast}amt=$deliveryfees",
                        status1: "status",
                        status2: "success",
                        tId: "payment_id"
                      );
                    } else if (paymenttital == "Midtrans") {
                      debugPrint("Midtrans");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.midtans}name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}&amt=$deliveryfees",
                        status1: "status_code",
                        status2: "200",
                        tId: "order_id"
                      );
                    } else if (paymenttital == "2checkout") {
                      debugPrint("2checkout");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.checkout2}amt=$deliveryfees",
                        status1: "status",
                        status2: "successful",
                        tId: ""
                      );
                    } else if (paymenttital == "Khalti Payment") {
                      debugPrint("Khalti Payment");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.khalti}amt=$deliveryfees",
                        status1: "status",
                        status2: "Completed",
                        tId: "transaction_id"
                      );
                    }
                  }
                } else {
                  tostmsg("Select Payment Method".tr);
                }
              },
              child: Container(
                height: 50,
                width: Get.width,
                decoration: BoxDecoration(
                  color: linercolor,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(
                  child: Text(
                    "${"PAY NOW".tr} | $currency${deliveryfees.toStringAsFixed(2)}",
                    style: TextStyle(
                      color: whitecolor,
                      fontSize: Get.height / 50,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                ),
              ),
            ),
            body: StatefulBuilder(
              builder: (context, setState) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Select Payment Method".tr,
                      style: TextStyle(
                        fontSize: 20,
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
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
                                debugPrint("============== _groupValue ============ $_groupValue");
                                debugPrint("============== paymentindex ========= $paymentindex");
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
                                        child: Image.network(
                                          "${Config.imageURLPath}${paymentGatwayApiModel!.data![index].img}",
                                        ),
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
              }
            ),
          ),
        );
      },
    );
  }

//!--------------------------- payment Widget --------------------
  final _formKey = GlobalKey<FormState>();
  var numberController = TextEditingController();
  final _paymentCard = PaymentCard();
  var _autoValidateMode = AutovalidateMode.disabled;
  bool isloading = false;

  final _card = PaymentCard();
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
                padding: EdgeInsets.all(15),
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
                            keyboardType: TextInputType.number,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(19),
                              CardNumberInputFormatter()
                            ],
                            controller: numberController,
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
                            prefixIcon: SizedBox(
                              height: 10,
                              child: Padding(
                                padding: EdgeInsets.symmetric(
                                  vertical: 14,
                                  horizontal: 6,
                                ),
                                child: CardUtils.getCardIcon(
                                  _paymentCard.type,
                                ),
                              ),
                            ),
                            validator: CardUtils.validateCardNum,
                            hintText: "What number is written on card?".tr,
                            labelText: "Number".tr,
                          ),
                          SizedBox(height: 10),
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
                                  validator: CardUtils.validateCVV,
                                  keyboardType: TextInputType.number,
                                  onSaved: (value) {
                                    _paymentCard.cvv = int.parse(value!);
                                  },
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
                                  hintText: "MM/YY".tr,
                                  labelText: "Expiry Date".tr,
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
    numberController.removeListener(_getCardTypeFrmNumber);
    numberController.dispose();
    _hideTooltip();
    super.dispose();
  }

  void _getCardTypeFrmNumber() {
    String input = CardUtils.getCleanedNumber(numberController.text);
    CardType cardType = CardUtils.getCardTypeFrmNumber(input);
    setState(() {
      _paymentCard.type = cardType;
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
            _showInSnackBar("Please fix the errors in red before submitting.".tr);
          } else {
            var username = getdata.read("UserLogin")["name"];
            var email = getdata.read("UserLogin")["email"];
            _paymentCard.name = username;
            _paymentCard.email = email;
            _paymentCard.amount = deliveryfees.toString();
            form.save();
            debugPrint('------- name ------- ${_paymentCard.name}');
            debugPrint('------- email ------- ${_paymentCard.email}');
            debugPrint('------- amount ------- ${_paymentCard.amount}');
            debugPrint('------- month ------- ${_paymentCard.month}');
            debugPrint('------- year ------- ${_paymentCard.year}');
            webViewPaymentMethod(
              initialUrl: "${Config.imageURLPath + Config.stripe}name=${_paymentCard.name}&email=${_paymentCard.email}&cardno=${_paymentCard.number}&cvc=${_paymentCard.cvv}&amt=$deliveryfees&mm=${_paymentCard.month}&yyyy=${_paymentCard.year}",
              status1: "status",
              status2: "success",
              tId: "Transaction_id",
            );
            _showInSnackBar("Payment card is valid".tr);
          }
        },
        color: linercolor,
        child: Text(
          "${"PAY".tr} $currency$deliveryfees",
          style: TextStyle(
            fontSize: 17,
            color: whitecolor,
          ),
        ),
      ),
    );
  }

  void _showInSnackBar(String value) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(value),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  PaymentGatwayApiModel? paymentGatwayApiModel;

  paymenrgatway() {
    ApiWrapper.dataGet(Config.paymentgateway)!.then((val) {
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

  checkAddress() {
    var uid = getdata.read("Uid") ?? "";
    var data = {"uid": uid};
    debugPrint(data.toString());
    ApiWrapper.dataPost(Config.address, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
          addressList = val["AddressList"];
          addressID = val["AddressList"][0]["id"];
          dropaddress = val["AddressList"][0]["address"];
          daddresstype = val["AddressList"][0]["type"];
          hno = val["AddressList"][0]["hno"];
          daddress = val["AddressList"][0]["landmark"];
          lat2 = double.parse(val["AddressList"][0]["lat_map"].toString());
          lon2 = double.parse(val["AddressList"][0]["long_map"].toString());
          customerName = val["AddressList"][0]["c_name"];
          customerMobileNumber = val["AddressList"][0]["c_number"];
          switch (val["AddressList"][0]["type"]) {
            case "Home":
              iconImage1 = "assets/selecthome.png";
              break;
            case "Office":
              iconImage1 = "assets/selectoffice.png";
              break;
            case "Other":
              iconImage1 = "assets/selectothers.png";
              break;
            default:
          }
          setState(() {});
        }
      }
    });
  }

  buyNoworder(otid) {
    var uid = getdata.read("Uid") ?? "";
    var dropAddress = daddress == ""
        ? "$hno, " "$dropaddress"
        : "$hno, " "$daddress, " "$dropaddress";
    var body = {
      "uid": uid,
      "p_method_id": _groupValue,
      "title": getdata.read("SelectStore")["name"],
      "pick_address": getdata.read("SelectStore")["vicinity"],
      "d_charge": dcharge.toStringAsFixed(2),
      "pick_type": "Store",
      "drop_type": daddresstype,
      "cou_id": cid,
      "cou_amt": camount,
      "transaction_id": otid.toString(),
      "extra_mile_charge": exmilecharge.toStringAsFixed(2),
      "drop_address": dropAddress,
      "drop_lat": "$lat2",
      "drop_long": "$lon2",
      "pick_lat": "$lat1",
      "pick_long": "$lon1",
      "total_dcharge": deliveryfees.toStringAsFixed(2),
      "drop_name": getdata.read("UserLogin")["name"],
      "drop_mobile": customerMobileNumber,
      "distance": totaldistance.toString(),
      "time_duration": "$totaltime",
      "ProductData": [
        for (var i = 0; i < users.length; i++)
          if (users[i].title != "")
            {"item_title": users[i].title, "quantity": users[i].count}
      ]
    };
    debugPrint("buy order api Call  Data------------------------- : ${body.toString()}");
    ApiWrapper.dataPost(Config.buyOrder, body)!.then(
      (val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            save("OrderID", val["order_id"]);
            Get.off(() => const TrakingOrder(type: "Buy"));
            isPaymentLoding = false;
            setState(() {});
            ApiWrapper.showToastMessage(val["ResponseMsg"]);
          }
        }
      },
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

            // Check the status parameter instead of Result
            final status = uri.queryParameters[status1];
            debugPrint(" /*/*/*/*/*/*/*/*/*/*/*/*/*/ Status ---- $status");
            if (status == null) {
              debugPrint("No status parameter found.");
            } else {
              debugPrint("Status parameter: $status");
              if (status == status2) {
                debugPrint("Purchase successful.");
                buyNoworder("${uri.queryParameters[tId]}");
                return NavigationDecision.prevent;
              } else {
                debugPrint("Purchase failed with status: $status.");
                Navigator.pop(context);
                tostmsg(status);
                isPaymentLoding = false;
                setState(() {});
                return NavigationDecision.prevent;
              }
            }
            isPaymentLoding = false;
            setState(() {});
            return NavigationDecision.navigate;
          },
        ),
      ),
    );
  }


  void _toggleTooltip() {
    if (_tooltipVisible) {
      _hideTooltip();
    } else {
      _showTooltip();
    }
  }

  void _showTooltip() {
    final RenderBox renderBox = _buttonKey.currentContext!.findRenderObject() as RenderBox;
    final Offset position = renderBox.localToGlobal(Offset.zero);

    _overlayEntry = OverlayEntry(
      builder: (context) => Stack(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: _hideTooltip, // Tap outside to close
            child: Container(
              color: Colors.transparent,
            ),
          ),
          Positioned(
            left: position.dx,
            top: exmilecharge == 0 && additionalKmCharge == 0 
              ? position.dy - 105
              : exmilecharge == 0 ? position.dy - 125 : position.dy - 145,
            child: Material(
              color: Colors.transparent,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 300,
                    padding: EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Color(0xFF1E1E1E),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              "Delivery Partner Fee",
                              style: TextStyle(
                                color: whitecolor,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 15,
                              ),
                            ),
                            Text(
                              " $currency${totalDeliveryfees.toStringAsFixed(2)}",
                              style: TextStyle(
                                color: Colors.white,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 10),
                        Text(
                          "Standard fee (${totaldistance.toStringAsFixed(2)} Km.)",
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            color: whitecolor,
                            fontSize: 14,
                          ),
                        ),
                        SizedBox(height: 8),
                        tooltipComanText(text1: "First ${bkms}Km. rate : ", text2: "$currency${bprice.toStringAsFixed(2)}"),
                        if (additionalKmCharge > 0) ...[
                          SizedBox(height: 5),
                          tooltipComanText(text1: "Additional  ${abkms.toStringAsFixed(2)}Km. rate : ", text2: "$currency${additionalKmCharge.toStringAsFixed(2)}"),
                        ],
                        if (exmilecharge > 0) ... [
                          SizedBox(height: 5),
                          tooltipComanText(text1: "Extra charges weather/distance (${priceData["mile_charge"]}%) : ", text2: "$currency${exmilecharge.toStringAsFixed(2)}"),
                        ],
                      ],
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.only(left: 20),
                    child: CustomPaint(
                      painter: DownwardTrianglePainter(),
                      child: SizedBox(width: 15, height: 10),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );

    Overlay.of(context).insert(_overlayEntry!);
    _tooltipVisible = true;
  }

  void _hideTooltip() {
    _overlayEntry?.remove();
    _overlayEntry = null;
    _tooltipVisible = false;
  }

}

class DownwardTrianglePainter extends CustomPainter {
  final Color color;
  DownwardTrianglePainter({this.color = const Color(0xFF1E1E1E)});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;
    final path = Path();
    path.moveTo(0, 0);
    path.lineTo(size.width, 0);
    path.lineTo(size.width / 2, size.height);
    path.close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
