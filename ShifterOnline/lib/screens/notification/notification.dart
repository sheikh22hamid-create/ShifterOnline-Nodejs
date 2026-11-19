// ignore_for_file: deprecated_member_use

import 'package:goParcel/theme/widgets/app_top_bar.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'dart:convert';
import 'package:get/get.dart';
import 'package:goParcel/Api/AppModelApi/notifiction_api_model.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../../utils/colors.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../home/home.dart';

class Notifications extends StatefulWidget {
  const Notifications({super.key});
  @override
  State<Notifications> createState() => _NotificationsState();
}

class _NotificationsState extends State<Notifications> {
  @override
  void initState() {
    super.initState();
    getnotification();
  }

  NotifictionApiModel? notifictionApiModel;

  bool isLoding = false;

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      appBar: AppTopBar(title: "Notification".tr),
      backgroundColor: AppPalette.current.canvas,
      body: Container(
        decoration: BoxDecoration(
          color: AppPalette.current.canvas,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(22),
            topRight: Radius.circular(22),
          ),
        ),
        child: isLoding
          ? notifictionApiModel!.notificationData!.isEmpty
              ? Center(
                  child: Text(
                    "No Notification".tr,
                      style: TextStyle(
                      color: AppPalette.current.ink,
                      fontSize: 18,
                      fontFamily: "Gilroy_Bold",
                    ),
                  ),
                )
              : ListView.separated(
                  padding: EdgeInsets.all(15),
                  itemCount: notifictionApiModel!.notificationData!.length,
                  shrinkWrap: true,
                  physics: BouncingScrollPhysics(),
                  itemBuilder: (context, index) {
                    DateTime notificationDate = DateTime.parse("${notifictionApiModel!.notificationData![index].datetime}");
                    return Container(
                      padding: EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppPalette.current.surface,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Container(
                            height: 60,
                            width: 60,
                            padding: EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: AppPalette.current.canvas,
                            ),
                            child: Image.asset(
                              "assets/msgnotification.png",
                              color: AppPalette.current.brand,
                            ),
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  "${notifictionApiModel!.notificationData![index].title}",
                                  style: TextStyle(
                                    color: AppPalette.current.ink,
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 16,
                                  ),
                                ),
                                SizedBox(height: 5),
                                Text(
                                  "${notifictionApiModel!.notificationData![index].description}",
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: AppPalette.current.inkMuted.withOpacity(0.8),
                                    fontFamily: 'Gilroy_Medium',
                                    fontSize: 13,
                                  ),
                                ),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    Text(
                                      DateFormat('EEE, d MMM, yyyy, hh:mm a').format(notificationDate),
                                      style: TextStyle(
                                        color: AppPalette.current.brand,
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  }, separatorBuilder: (BuildContext context, int index)  => SizedBox(height: 10),
                )
              : Center(
                  child: CupertinoActivityIndicator(
                    radius: 18,
                    color: AppPalette.current.brand,
                  ),
                ), 
      ),
    );
  }

  Future getnotification() async {
    var uid = getdata.read("Uid") ?? "";
    var data = {"uid": uid};
    try {
      var url = Uri.parse('${Config.nodeBaseUrl}/${Config.nodeNotifications}');
      var request = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(data),
      );
      var response = jsonDecode(request.body);

      debugPrint("=========== Notification url ============= $url");
      debugPrint("=========== Notification body ============ $data");
      debugPrint("========= Notification response ========== ${request.body}");

      if (request.statusCode == 200) {
        if (response["Result"] == "true") {
          notifictionApiModel = notifictionApiModelFromJson(request.body);
          if (notifictionApiModel!.result == "true") {
            setState(() {
              isLoding = true;
            });
            return response;
          } else {
            tostmsg("${notifictionApiModel!.responseMsg}");
          }
        } else {
          tostmsg("${response["ResponseMsg"]}"); 
        }
        return response["NotificationData"];
      } else {
        tostmsg("Something Went Wrong!");
      }
    } catch (e) {
      debugPrint("Exeption----- $e");
    }
  }
}
