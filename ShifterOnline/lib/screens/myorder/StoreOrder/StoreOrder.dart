// ignore_for_file: file_names

import 'package:goParcel/controllers/buyany_order_history_api_controller.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/trakingStore.dart';
import 'package:goParcel/screens/myorder/myorder.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class StoreOrder extends StatefulWidget {
  final String? type;
  const StoreOrder({super.key, this.type});
  @override
  State<StoreOrder> createState() => _StoreOrderState();
}

class _StoreOrderState extends State<StoreOrder> with SingleTickerProviderStateMixin {

  BuyanythingOrderHistoryApiController buyanythingOrderHistoryApiController = Get.put(BuyanythingOrderHistoryApiController());

  final ScrollController scrollController = ScrollController();

  bool buyanythingLoding = false;

  TabController? controller;
   @override
  void initState() {
    super.initState();
    var uid = getdata.read("Uid") ?? "";
    buyanythingOrderHistoryApiController.buyAnythingHistoryApi(uid: uid, type: "recent").then((value) {
      buyanythingOrderHistoryApiController.buyAnythingHistoryApi(uid: uid, type: "past").then((value) {
        debugPrint("--------- value ----- $value");
        if (value["Result"] == "true") {
        }
          buyanythingLoding = true;
          setState(() {});
      });
    });
  }

  List tabBarTitle = ["Recently".tr, "Completed".tr];

  int selectTab = 0;

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: linercolor,
        centerTitle: widget.type == "Profile" ? true : false,
        title: Text(
          "Buy anything Orders".tr,
          style: TextStyle(
            color: whitecolor,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
      ),
      body: Container(
        width: Get.width,
        padding: EdgeInsets.only(top: 15, right: 15, left: 15),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 30,
              child: ListView.separated(
                itemCount: tabBarTitle.length,
                shrinkWrap: true,
                scrollDirection: Axis.horizontal,
                itemBuilder: (context, index) {
                  return InkWell(
                    onTap: () {
                      setState(() {
                        selectTab = index;
                      });
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        scrollController.jumpTo(0);
                      });
                    },
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        color: selectTab == index
                            ? linercolor
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(40),
                        border: Border.all(
                          color: selectTab == index ? linercolor : greaycolor,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          "${tabBarTitle[index]}",
                          style: TextStyle(
                            color: selectTab == index ? whitecolor : notifier.isDark ? whitecolor : greaycolor,
                            fontSize: 15,
                            fontFamily: "Gilroy_Regular",
                          ),
                        ),
                      ),
                    ),
                  );
                },
                separatorBuilder: (BuildContext context, int index) {
                  return SizedBox(width: 10);
                },
              ),
            ),
            SizedBox(height: 15),
            Expanded(
              child: GetBuilder<BuyanythingOrderHistoryApiController>(
                builder: (buyanythingOrderHistoryApiController) {
                  return buyanythingLoding
                      ? (selectTab == 1
                              ? buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.result == "false"
                              : buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.result == "false")
                          ? Column(
                              children: [
                                SizedBox(height: Get.height * 0.32),
                                Center(
                                  child: Text(
                                    selectTab == 1
                                      ? "${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.responseMsg}"
                                      : "${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.responseMsg}",
                                    style: TextStyle(
                                      color: blackcolor,
                                      fontSize: 18,
                                      fontFamily: "Gilroy_Bold",
                                    ),
                                  ),
                                ),
                              ],
                            )
                          : ListView.separated(
                              controller: scrollController,
                              shrinkWrap: true,
                              itemCount: selectTab == 1
                                ? buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory!.length
                                : buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory!.length,
                              padding: EdgeInsets.only(bottom: Get.height / 8),
                              physics: BouncingScrollPhysics(),
                              itemBuilder: (context, index) {
                                if (selectTab == 1) {
                                  return orderlistBox(
                                    context,
                                    image: "assets/fast_delivery_file.svg",
                                    title: "#${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].id}",
                                    discription: "${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].flowMsg}",
                                    ordertype: "${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].status}",
                                    pickupAddress: "${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].pickAddress}",
                                    dropAddress: "${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].dropAddress}",
                                    orderDate: DateFormat("EEE, d MMM, yyyy").format(DateTime.parse("${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].orderDate}")),
                                    onTap: () {
                                      save("OrderID", "${buyanythingOrderHistoryApiController.completedBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].id}");
                                      Get.to(() => TrackingWay(type: "Store", isback: true,));
                                    },
                                  );
                                } else {
                                  return orderlistBox(
                                    context,
                                    title: "#${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].id}",
                                    image: "assets/fast_delivery_file.svg",
                                    discription: "${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].flowMsg}",
                                    ordertype: "${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].status}",
                                    pickupAddress: "${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].pickAddress}",
                                    dropAddress: "${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].dropAddress}",
                                    orderDate: DateFormat("EEE, d MMM, yyyy").format(DateTime.parse("${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].orderDate}")),
                                    onTap: () {
                                      save("OrderID", "${buyanythingOrderHistoryApiController.recentlyBuyanythingOrderHistoryApiModel!.buyOrderHistory![index].id}");
                                      Get.to(() => TrackingWay(type: "Store", isback: true,));
                                    },
                                  );
                                }
                              },
                              separatorBuilder: (BuildContext context, int index) {
                                return SizedBox(height: 10);
                              },
                            )
                      : Center(child: CircularProgressIndicator(color: notifier.darklinercolor));
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
