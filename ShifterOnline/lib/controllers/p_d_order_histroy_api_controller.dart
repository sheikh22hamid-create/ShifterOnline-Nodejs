import 'dart:convert';

import 'package:goParcel/Api/AppModelApi/order_history_api_model.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';

class PDOrderHistroyApiController extends GetxController implements GetxService {
  OrderHistoryApiModel? recentlyOrderApiModel;
  OrderHistoryApiModel? completedOrderApiModel;
  OrderHistoryApiModel? favoriteOrderApiModel;

  bool isLoding = false;

  Future orderHistroyApi({required String uid, required String type}) async {
    Map body = {
      "uid": uid,
      "type": type,
    };

    try {
      final data = await ApiWrapper.dataPostNode(Config.nodeOrderHistory, body);
      debugPrint("=========== order response ============ $data");

      if (data is Map) {
        final model = orderHistoryApiModelFromJson(jsonEncode(data));
        if (type == "recent") {
          recentlyOrderApiModel = model;
        } else if (type == "past") {
          completedOrderApiModel = model;
        } else if (type == "favorite") {
          favoriteOrderApiModel = model;
        }
        isLoding = true;
        update();
        return data;
      }
    } catch (e) {
      debugPrint("============ order history ============ $e");
    }
  }

  /// Toggles the favourite flag on a completed order, then refreshes the
  /// Completed and Favorite lists so both tabs reflect it. Returns the new
  /// favourite state, or null if the call failed.
  Future<bool?> toggleFavoriteOrder({required String uid, required String orderId}) async {
    try {
      final data = await ApiWrapper.dataPostNode(Config.nodeFavoriteOrderToggle, {"user_id": uid, "order_id": orderId});
      if (data is Map && data["Result"] == true) {
        await orderHistroyApi(uid: uid, type: "past");
        await orderHistroyApi(uid: uid, type: "favorite");
        return data["favorite"] == true;
      }
      if (data is Map && data["msg"] != null) ApiWrapper.showToastMessage(data["msg"].toString());
    } catch (e) {
      debugPrint("============ toggle favorite order ============ $e");
    }
    return null;
  }
}
