// To parse this JSON data, do
//
//     final orderHistoryApiModel = orderHistoryApiModelFromJson(jsonString);

import 'dart:convert';

OrderHistoryApiModel orderHistoryApiModelFromJson(String str) => OrderHistoryApiModel.fromJson(json.decode(str));

String orderHistoryApiModelToJson(OrderHistoryApiModel data) => json.encode(data.toJson());

class OrderHistoryApiModel {
    List<OrderHistory>? orderHistory;
    String? responseCode;
    String? result;
    String? responseMsg;

    OrderHistoryApiModel({
        this.orderHistory,
        this.responseCode,
        this.result,
        this.responseMsg,
    });

    factory OrderHistoryApiModel.fromJson(Map<String, dynamic> json) => OrderHistoryApiModel(
        orderHistory: json["OrderHistory"] == null ? [] : List<OrderHistory>.from(json["OrderHistory"]!.map((x) => OrderHistory.fromJson(x))),
        responseCode: json["ResponseCode"],
        result: json["Result"],
        responseMsg: json["ResponseMsg"],
    );

    Map<String, dynamic> toJson() => {
        "OrderHistory": orderHistory == null ? [] : List<dynamic>.from(orderHistory!.map((x) => x.toJson())),
        "ResponseCode": responseCode,
        "Result": result,
        "ResponseMsg": responseMsg,
    };
}

class OrderHistory {
    String? id;
    String? status;
    DateTime? orderDate;
    String? total;
    String? isRate;
    String? pickAddress;
    String? dropAddress;
    String? flowMsg;
    String? vehicleType;
    String? modelTitle;
    String? tripStartTime;
    String? tripEndTime;
    String? driverName;
    String? driverVehicleNo;
    bool isFavorite;
    String? plat;
    String? plong;
    String? dlat;
    String? dlong;
    String? pickName;
    String? pmobile;
    String? pickType;
    String? dropName;
    String? dmobile;
    String? dropType;
    List<Map<String, dynamic>> stops;

    OrderHistory({
        this.id,
        this.status,
        this.orderDate,
        this.total,
        this.isRate,
        this.pickAddress,
        this.dropAddress,
        this.flowMsg,
        this.vehicleType,
        this.modelTitle,
        this.tripStartTime,
        this.tripEndTime,
        this.driverName,
        this.driverVehicleNo,
        this.isFavorite = false,
        this.plat,
        this.plong,
        this.dlat,
        this.dlong,
        this.pickName,
        this.pmobile,
        this.pickType,
        this.dropName,
        this.dmobile,
        this.dropType,
        this.stops = const [],
    });

    factory OrderHistory.fromJson(Map<String, dynamic> json) => OrderHistory(
        id: json["id"],
        status: json["status"],
        orderDate: json["order_date"] == null ? null : DateTime.parse(json["order_date"]),
        total: json["total"],
        isRate: json["is_rate"],
        pickAddress: json["pick_address"],
        dropAddress: json["drop_address"],
        flowMsg: json["flow_msg"],
        vehicleType: json["vehicle_type"]?.toString(),
        modelTitle: json["model_title"]?.toString(),
        tripStartTime: json["trip_start_time"]?.toString(),
        tripEndTime: json["trip_end_time"]?.toString(),
        driverName: json["driver_name"]?.toString(),
        driverVehicleNo: json["driver_vehicle_no"]?.toString(),
        isFavorite: json["is_favorite"] == true,
        plat: json["plat"]?.toString(),
        plong: json["plong"]?.toString(),
        dlat: json["dlat"]?.toString(),
        dlong: json["dlong"]?.toString(),
        pickName: json["pick_name"]?.toString(),
        pmobile: json["pmobile"]?.toString(),
        pickType: json["pick_type"]?.toString(),
        dropName: json["drop_name"]?.toString(),
        dmobile: json["dmobile"]?.toString(),
        dropType: json["drop_type"]?.toString(),
        stops: json["stops"] is List
            ? (json["stops"] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
            : const [],
    );

    Map<String, dynamic> toJson() => {
        "id": id,
        "status": status,
        "order_date": orderDate?.toIso8601String(),
        "total": total,
        "is_rate": isRate,
        "pick_address": pickAddress,
        "drop_address": dropAddress,
        "flow_msg": flowMsg,
    };
}
