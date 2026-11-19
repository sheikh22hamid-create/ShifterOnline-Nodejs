// ignore_for_file: prefer_typing_uninitialized_variables, avoid_print, deprecated_member_use

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/AppDataBase/WitchList.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as path;
import 'package:http/http.dart' as http;
import 'package:sqflite/sqflite.dart' as sql;

import 'home.dart';

class ItemListDelet {
  static Future<Database> database() async {
    final dbPath = await sql.getDatabasesPath();
    return sql.openDatabase(path.join(dbPath, 'WL.db'), version: 1);
  }
}

class MakeWishList extends StatefulWidget {
  const MakeWishList({super.key});

  @override
  State<MakeWishList> createState() => _MakeWishListState();
}

class _MakeWishListState extends State<MakeWishList> {
  final sql = Addmakelist();

  final List<TextEditingController> _controllers = [];
  var users;
  String selectID = "2022-07-14 11:38:58.331924";
  var selectdCell = [];
  bool isLoading = false;

  var getDataList = [];

  @override
  void initState() {
    super.initState();
    sql.savemakelist(id: "1", title: '', quantity: "1");
    makeListget();
  }

  @override
  Widget build(BuildContext context) {
    Future.delayed(const Duration(seconds: 1), () {
      setState(() {});
    });
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      resizeToAvoidBottomInset: false,
      backgroundColor: linercolor,
      appBar: appbar(tital: "Make a List".tr),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: Container(
        margin: EdgeInsets.all(16),
        width: Get.width,
        child: appButton(
          tital: "SAVE".tr,
          onTap: () async {
            var screendata = [
              for (var i = 0; i < users.length; i++)
                if (_controllers[i].text != "")
                  {
                    "id": "${users[i].id}",
                    "title": _controllers[i].text,
                    "quantity": users[i].quantity,
                  },
            ];
            if (jsonEncode(getDataList) != jsonEncode(screendata)) {
              makeListinsert();
            } else {
              tostmsg("Make a List Already Save".tr);
            }
          },
        ),
      ),
      body: Column(
        children: [
          Container(
            padding: EdgeInsets.symmetric(horizontal: 15, vertical: 20),
            width: Get.width,
            decoration: const BoxDecoration(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Make a wish list".tr,
                  style: TextStyle(
                    color: whitecolor,
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 20,
                  ),
                ),
                SizedBox(height: 10),
                Text(
                  "Keep it saved for your next purchase".tr,
                  style: TextStyle(
                    color: whitecolor,
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Container(
              width: Get.width,
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              decoration: BoxDecoration(
                color: notifier.lightBgColor,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(24),
                  topRight: Radius.circular(24),
                ),
              ),
              child: SingleChildScrollView(
                padding: EdgeInsets.all(15),
                physics: BouncingScrollPhysics(),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.start,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Make a list of items you need".tr,
                      style: TextStyle(
                        color: notifier.text,
                        fontSize: 16,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    SizedBox(height: 10),
                    FutureBuilder(
                      future: sql.fetchmakelist(),
                      builder: (ctx, AsyncSnapshot snap) {
                        if (snap.hasData) {
                          users = snap.data;
                          return snap.data.length == 0
                              ? SizedBox(
                                  height: Get.height / 1.5,
                                  width: Get.width,
                                  child: Center(child: loading(size: 60)),
                                )
                              : ListView.separated(
                                  padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
                                  itemCount: users.length,
                                  physics: NeverScrollableScrollPhysics(),
                                  shrinkWrap: true,
                                  itemBuilder: (ctx, i) {
                                    _controllers.add(TextEditingController(text: users[i].title));
                                    return needlist(users, i);
                                  },
                                  separatorBuilder: (BuildContext context, int index) => SizedBox(height: 10),
                                );
                        } else {
                          return SizedBox(
                            height: Get.height / 1.5,
                            width: Get.width,
                            child: Center(child: loading(size: 60)),
                          );
                        }
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget needlist(user, i) {
    return textfild(
      controller: _controllers[i],
      hintText: "Add an Item".tr,
      fillColor: notifier.getBgColor,
      onChanged: (val) {
        setState(() {});
        selectID == user[i].id
            ? sql.updatetitlemake(
                id: user[i].id,
                title: val,
                quantity: user[i].quantity,
              )
            : SizedBox();
        sql.fetchmakelist();
      },
      prefixIcon: Padding(
        padding: EdgeInsets.all(10.0),
        child: Image.asset(
          "assets/note.png",
          height: 15,
          color: notifier.darklinercolor,
        ),
      ),
      suffixIcon: Container(
        decoration: BoxDecoration(),
        width: !selectdCell.contains(user[i].id)
            ? Get.width / 20
            : Get.width / 4.5,
        child: Center(
          child: !selectdCell.contains(user[i].id)
              //! addnew item
              ? itembutton(
                  boxColor: linercolor,
                  icon: Icons.add,
                  iconColor: whitecolor,
                  onTap: () {
                    _controllers[i].text != ""
                        ? setState(() {
                            selectdCell.add(user[i].id);
                            var lengthitem = user.length + 1;
                            sql.savemakelist(
                              id: lengthitem.toString(),
                              title: "",
                              quantity: "1",
                            );
                            _controllers[i + 1].clear();
                          })
                        : tostmsg("Enter your item name".tr);
                  },
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    itembutton(
                      boxColor: greaycolor.withOpacity(0.4),
                      icon: Icons.remove,
                      iconColor: notifier.getBgColor,
                      onTap: () {
                        selectID = user[i].id;
                        if (user[i].quantity != "1") {
                          selectID == user[i].id
                              ? setState(() {
                                  var count = int.parse(user[i].quantity) - 1;
                                  sql.updatetitlemake(
                                    id: user[i].id,
                                    title: user[i].title,
                                    quantity: count.toString(),
                                  );
                                })
                              : const SizedBox();
                        } else {
                          setState(() {});
                          _controllers.remove(_controllers[i]);
                          selectdCell.remove(user[i].id);
                          sql.deletemakelist(user[i].id);
                          sql.fetchmakelist();
                          setState(() {});
                        }
                      },
                    ),
                    SizedBox(width: Get.width / 100),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: Text(
                        user[i].quantity,
                        style: TextStyle(
                          color: notifier.darklinercolor,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: Get.height / 60,
                        ),
                      ),
                    ),
                    SizedBox(width: Get.width / 100),
                    itembutton(
                      boxColor: linercolor,
                      icon: Icons.add,
                      iconColor: whitecolor,
                      onTap: () {
                        selectID = user[i].id;
                        setState(() {});
                        selectID == user[i].id
                            ? setState(() {
                                var count = int.parse(user[i].quantity) + 1;
                                sql.updatetitlemake(
                                  id: user[i].id,
                                  title: user[i].title,
                                  quantity: count.toString(),
                                );
                              })
                            : const SizedBox();
                      },
                    ),
                  ],
                ),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(
          color: linercolor,
        ),
      ),
    );
  }

  itembutton({Function()? onTap, Color? boxColor, iconColor, IconData? icon}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        height: Get.height / 40,
        width: Get.width / 20,
        decoration: BoxDecoration(
          color: boxColor,
          borderRadius: BorderRadius.circular(5),
        ),
        child: Center(
          child: Icon(
            icon,
            color: iconColor,
            size: Get.height / 50,
          ),
        ),
      ),
    );
  }

  Future makeListget() async {
    isLoading = true;
    var uid = getdata.read("Uid") ?? "";
    var data = {"uid": uid, "type": "select"};
    final db = await ItemListDelet.database();
    await db.rawQuery('DELETE FROM makelist');
    try {
      var url = Uri.parse(Config.baseurl + Config.makeList);
      var request = await http.post(url, headers: ApiWrapper.headers, body: jsonEncode(data));
      var response = jsonDecode(request.body);
      debugPrint("--------- makeList url ----------- $url");
      debugPrint("--------- makeList data ---------- $data");
      debugPrint("------- makeList response -------- ${request.body}");
      if (response["ResponseCode"] == "200") {
        response["ListData"].forEach((e) {
          selectdCell.add(e["id"]);
          sql.savemakelist(
            id: e["id"],
            title: e["title"],
            quantity: e["quantity"],
          );
        });
        sql.savemakelist(
          id: (response["ListData"].length + 1).toString(),
          title: '',
          quantity: "1",
        );
        setState(() {});
        sql.fetchmakelist().then((value) {
          for (var i = 0; i < value.length - 1; i++) {
            getDataList.add({
              "id": "${value[i].id}",
              "title": "${value[i].title}",
              "quantity": "${value[i].quantity}",
            });
          }
          debugPrint("------- datass ------ $getDataList");
        });
      }
    } catch (e) {
      debugPrint("Exeption----- $e");
    }
  }

  Future makeListinsert() async {
    var uid = getdata.read("Uid") ?? "";
    var data = {
      "uid": uid,
      "type": "insert",
      "listdata": [
        for (var i = 0; i < users.length; i++)
          if (_controllers[i].text != "")
            {
              "title": _controllers[i].text,
              "quantity": users[i].quantity,
            },
      ]
    };
    try {
      var url = Uri.parse(Config.baseurl + Config.makeList);
      var request = await http.post(
        url,
        headers: ApiWrapper.headers,
        body: jsonEncode(data),
      );
      var response = jsonDecode(request.body);
      if (response["ResponseCode"] == "200") {
        debugPrint("response-----$response");
        Get.back();
        ApiWrapper.showToastMessage(response["ResponseMsg"]);
      } else {
        ApiWrapper.showToastMessage(response["ResponseMsg"]);
        return [];
      }
    } catch (e) {
      debugPrint("Exeption----- $e");
    }
  }
}