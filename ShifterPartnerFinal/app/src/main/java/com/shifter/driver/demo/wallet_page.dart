// lib/screens/wallet/WalletPage.dart

import 'dart:convert';

import 'package:goParcel/Api/AppModelApi/payment_gatwey_api_model.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../../Api/Api_wrapper.dart';
import '../../../Api/config.dart';
import '../../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';

//final getdata = GetStorage();
class WalletPage extends StatefulWidget {
  const WalletPage({super.key});

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  //final getdata = GetStorage();

  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _remarkController = TextEditingController();

  double walletBalance = 0.0;
  List walletHistory = [];
  bool isLoading = true;
  bool isHistoryLoading = true;
  bool isPaymentLoading = false;

  // Razorpay
  RazorPayClass razorPayClass = RazorPayClass();
  PaymentGatwayApiModel? paymentGatwayApiModel;
  String? razorpayOrderId;

  @override
  void initState() {
    super.initState();
    _getWalletHistory();
    //_getPaymentGateway();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: _handlePaymentSuccess,
      handlePaymentError: _handlePaymentError,
      handleExternalWallet: _handleExternalWallet,
    );
  }

  @override
  void dispose() {
    razorPayClass.desposRazorPay();
    _amountController.dispose();
    _remarkController.dispose();
    super.dispose();
  }

  // Get Payment Gateway
 /* _getPaymentGateway() {
    ApiWrapper.dataGet(Config.paymentgateway)!.then((val) {
      var data = jsonEncode(val);
      debugPrint("============ payment gateway =========== $val");
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {
            paymentGatwayApiModel = paymentGatwayApiModelFromJson(data);
          });
        }
      }
    });
  }*/

  // Get Payment Gateway
// Get Payment Gateway
  _getPaymentGateway() {
    ApiWrapper.dataGet(Config.paymentgateway)!.then((val) {
      var data = jsonEncode(val);
      debugPrint("============ payment gateway =========== $val");

      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {
            paymentGatwayApiModel = paymentGatwayApiModelFromJson(data);
          });

          // DEBUG: Print all payment gateway details
          if (paymentGatwayApiModel != null && paymentGatwayApiModel!.data != null) {
            debugPrint("=== PAYMENT GATEWAYS FOUND ===");
            for (var gateway in paymentGatwayApiModel!.data!) {
              debugPrint("ID: ${gateway.id}");
              debugPrint("Title: ${gateway.title}");
              debugPrint("Active: ${gateway.pShow}");
              debugPrint("Attributes (Key): ${gateway.attributes}");
              debugPrint("---");
            }
          }
        } else {
          debugPrint("=== PAYMENT GATEWAY ERROR ===");
          debugPrint("Response Code: ${val['ResponseCode']}");
          debugPrint("Result: ${val['Result']}");
          debugPrint("Message: ${val['ResponseMsg']}");
        }
      } else {
        debugPrint("=== PAYMENT GATEWAY EMPTY RESPONSE ===");
      }
    }).catchError((error) {
      debugPrint("=== PAYMENT GATEWAY API ERROR ===");
      debugPrint("Error: $error");
    });
  }

  // Razorpay Handlers
  void _handlePaymentSuccess(PaymentSuccessResponse response) {
    debugPrint("======== Payment Success Handler Triggered ========");
    debugPrint("Payment ID: ${response.paymentId}");
    debugPrint("Signature: ${response.signature}");
    debugPrint("Order ID (Global Var): $razorpayOrderId");

    _addWalletAfterPayment(
      razorpayPaymentId: response.paymentId ?? "",
      razorpaySignature: response.signature ?? "",
    );
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    isPaymentLoading = false;
    setState(() {});
    debugPrint("======== Payment Failed ========");
    debugPrint("Code: ${response.code}");
    debugPrint("Message: ${response.message}");
    
    if (response.code == 1) {
      tostmsg("Payment cancelled by user");
    } else if (response.code == 2) {
      tostmsg("Network error, please check your connection");
    } else {
      tostmsg("Payment failed: ${response.message}");
    }
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    isPaymentLoading = false;
    setState(() {});
    debugPrint("======== External Wallet Selected ========");
    debugPrint("Wallet Name: ${response.walletName}");
    tostmsg("External wallet selected: ${response.walletName}");
  }

  // Get Wallet History
  _getWalletHistory() {
    setState(() {
      isHistoryLoading = true;
    });

    var mobile = getdata.read("UserLogin")["mobile"];
    var data = {"mobile": mobile};

    ApiWrapper.dataPost(Config.walletHistory, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          walletBalance = double.parse(val["WalletBalance"] ?? "0.0");
          walletHistory = val["History"] ?? [];
        }
      }
      setState(() {
        isLoading = false;
        isHistoryLoading = false;
      });
    });
  }

  // Add Money to Wallet - Create Order and Open Razorpay
// Add Money to Wallet - Create Order and Open Razorpay
  _addMoneyToWallet() {
    Get.back();
    if (_amountController.text.isEmpty) {
      tostmsg("Please enter amount");
      return;
    }

    double amount = double.tryParse(_amountController.text) ?? 0.0;
    if (amount <= 0) {
      tostmsg("Please enter valid amount");
      return;
    }

    /*if (paymentGatwayApiModel == null || paymentGatwayApiModel!.data == null || paymentGatwayApiModel!.data!.isEmpty) {
      tostmsg("Payment gateway not available");
      return;
    }*/

    setState(() {
      isPaymentLoading = true;
    });

    var mobile = getdata.read("UserLogin")["mobile"];
    var data = {
      "mobile": mobile,
      "amount": amount.toString(),
    };

    // Debug log 1
    debugPrint("======== Creating Order Data ======== $data");

    ApiWrapper.dataPost(Config.createOrder, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        // Debug log 2
        debugPrint("======== Order Response ======== $val");

        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          // Store order id from response
          razorpayOrderId = val["OrderId"];

          // Debug log 3
          debugPrint("======== Razorpay Order ID ======== $razorpayOrderId");

          if (razorpayOrderId == null || razorpayOrderId!.isEmpty) {
            isPaymentLoading = false;
            setState(() {});
            tostmsg("Order ID not received from server");
            return;
          }

          // Get.back(); // Close dialog - Commented out to debug Razorpay crash

          // In _addMoneyToWallet() method, update this part:

          // Get Razorpay key from payment gateway
           String razorpayKey = "rzp_test_Rr8n8p41taq6fM"; // Hardcoded Key enforced
           bool razorpayFound = true; 

           // Dynamic key logic removed as per user request
          /* if (paymentGatwayApiModel != null && paymentGatwayApiModel!.data != null) {
             // Just logging for debug purposes, not overriding key
             debugPrint("Dynamic key check skipped, using hardcoded key.");
           }*/

// Debug log 4
          debugPrint("======== Razorpay Found ======== $razorpayFound");
          debugPrint("======== Razorpay Key ======== $razorpayKey");

          if (!razorpayFound || razorpayKey.isEmpty) {
            tostmsg("Razorpay payment gateway not available");
            isPaymentLoading = false;
            setState(() {});
            return;
          }

// Validate Razorpay key format
          if (!razorpayKey.contains("rzp_")) {
            debugPrint("======== INVALID RAZORPAY KEY FORMAT ========");
            debugPrint("Expected format: rzp_test_... or rzp_live_...");
            debugPrint("Received: $razorpayKey");
            tostmsg("Invalid Razorpay configuration");
            isPaymentLoading = false;
            setState(() {});
            return;
          }

          // Get Razorpay key from payment gateway
         /* String razorpayKey = "";
          for (var gateway in paymentGatwayApiModel!.data!) {
            if (gateway.title == "Razorpay" && gateway.pShow == "1") {
              razorpayKey = gateway.attributes ?? "";
              break;
            }
          }

          // Debug log 4

          debugPrint("======== Razorpay Key ======== $razorpayKey");

          if (razorpayKey.isEmpty) {
            tostmsg("Razorpay not configured");
            isPaymentLoading = false;
            setState(() {});
            return;
          }*/

          // Convert amount to paise (Razorpay expects amount in paise)
          int amountInPaise = (amount * 100).toInt();

          // Debug log 5
          debugPrint("======== Amount in Paise ======== $amountInPaise");
          debugPrint("======== User Mobile ======== ${getdata.read("UserLogin")["mobile"]}");
          debugPrint("======== User Name ======== ${getdata.read("UserLogin")["name"]}");

          try {
            // Open Razorpay Checkout with order_id
            razorPayClass.openCheckout(
              key: razorpayKey,
              amount: amountInPaise.toString(), // Amount in paise
              orderId: razorpayOrderId!, // Uncommented to ensure signature generation
              number: getdata.read("UserLogin")["mobile"]?.toString() ?? "",
              name: getdata.read("UserLogin")["name"]?.toString() ?? "User",
              description: "Wallet Top-up",
              currency: "INR",
            );

            // Debug log 6
            debugPrint("======== Razorpay Checkout Opened ========");

          } catch (e) {
            isPaymentLoading = false;
            setState(() {});
            debugPrint("======== Razorpay Error ======== $e");
            tostmsg("Failed to open payment gateway: $e");
          }
        } else {
          isPaymentLoading = false;
          setState(() {});
          tostmsg(val["ResponseMsg"] ?? "Failed to create order");
        }
      } else {
        isPaymentLoading = false;
        setState(() {});
        tostmsg("Something went wrong");
      }
    }).catchError((error) {
      isPaymentLoading = false;
      setState(() {});
      debugPrint("======== Create Order Error ======== $error");
      tostmsg("Network error: $error");
    });
  }
  // Add Wallet After Successful Payment
  _addWalletAfterPayment({
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) {
    var mobile = getdata.read("UserLogin")["mobile"];
    var dataAddWallet = {
      "mobile": mobile,
      "amount": _amountController.text,
      "razorpay_order_id": razorpayOrderId ?? "",
      "razorpay_payment_id": razorpayPaymentId,
      "razorpay_signature": razorpaySignature,
    };

    debugPrint("======== Preparing Add Wallet API Call ========");
    debugPrint("API URL: ${Config.addWallet}");
    debugPrint("Mobile (Type: ${mobile.runtimeType}): $mobile");
    debugPrint("Amount (Type: ${_amountController.text.runtimeType}): ${_amountController.text}");
    debugPrint("Razorpay Order ID (Type: ${(razorpayOrderId ?? "").runtimeType}): ${razorpayOrderId ?? "NULL/EMPTY"}");
    debugPrint("Razorpay Payment ID (Type: ${razorpayPaymentId.runtimeType}): $razorpayPaymentId");
    debugPrint("Razorpay Signature (Type: ${razorpaySignature.runtimeType}): $razorpaySignature");
    
    // Check for empty critical values
    if (razorpayOrderId == null || razorpayOrderId!.isEmpty) {
      debugPrint("!!!!!!! WARNING: razorpayOrderId is missing !!!!!!!!");
    }
    
    debugPrint("Full Payload: $dataAddWallet");

    ApiWrapper.dataPost(Config.addWallet, dataAddWallet).then((val) {
      isPaymentLoading = false;
      setState(() {});

      if ((val != null) && (val.isNotEmpty)) {
        debugPrint("======== Add Wallet Response ======== $val");
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          tostmsg(val["ResponseMsg"] ?? "Money added successfully");
          _amountController.clear();
          _remarkController.clear();
          razorpayOrderId = null;
          _getWalletHistory(); // Refresh data
        } else {
          tostmsg(val["ResponseMsg"] ?? "Failed to add money to wallet");
        }
      } else {
        tostmsg("Something went wrong while updating wallet");
      }
    }).catchError((error) {
      isPaymentLoading = false;
      setState(() {});
      debugPrint("======== Add Wallet Error ======== $error");
      tostmsg("Network error: $error");
    });
  }

  // Rest of your code remains same...
  // Withdraw Money from Wallet
  _withdrawMoneyFromWallet() {
    if (_amountController.text.isEmpty) {
      tostmsg("Please enter amount");
      return;
    }

    double withdrawAmount = double.parse(_amountController.text);
    if (withdrawAmount > walletBalance) {
      tostmsg("Insufficient balance");
      return;
    }

    var mobile = getdata.read("UserLogin")["mobile"];
    var data = {
      "mobile": mobile,
      "amount": _amountController.text,
      "remark": _remarkController.text.isEmpty ? "Withdraw by user" : _remarkController.text
    };

    ApiWrapper.dataPost(Config.withdrawWallet, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          tostmsg(val["ResponseMsg"]);
          _amountController.clear();
          _remarkController.clear();
          _getWalletHistory(); // Refresh data
          Get.back(); // Close dialog
        } else {
          tostmsg(val["ResponseMsg"]);
        }
      }
    });
  }

  // Show Add Money Dialog
  _showAddMoneyDialog() {
    _amountController.clear();
    _remarkController.clear();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text("Add Money".tr),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _amountController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: "Amount".tr,
                hintText: "Enter amount",
                border: OutlineInputBorder(),
              ),
            ),
            SizedBox(height: 10),
            TextField(
              controller: _remarkController,
              decoration: InputDecoration(
                labelText: "Remark (Optional)".tr,
                hintText: "Enter remark",
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: Text("Cancel".tr),
          ),
          ElevatedButton(
            onPressed: isPaymentLoading ? null : _addMoneyToWallet,
            child: isPaymentLoading
                ? SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
            )
                : Text("Add Money".tr),
          ),
        ],
      ),
    );
  }

  // Show Withdraw Money Dialog
  _showWithdrawDialog() {
    _amountController.clear();
    _remarkController.clear();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text("Withdraw Money".tr),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _amountController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: "Amount".tr,
                hintText: "Enter amount",
                border: OutlineInputBorder(),
              ),
            ),
            SizedBox(height: 10),
            TextField(
              controller: _remarkController,
              decoration: InputDecoration(
                labelText: "Remark (Optional)".tr,
                hintText: "Enter remark",
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: Text("Cancel".tr),
          ),
          ElevatedButton(
            onPressed: _withdrawMoneyFromWallet,
            child: Text("Withdraw".tr),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: linercolor,
        centerTitle: true,
        title: Text(
          "Wallet".tr,
          style: TextStyle(
            color: whitecolor,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
      ),
      body: Container(
        width: Get.width,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: isLoading
            ? Center(child: CircularProgressIndicator(color: notifier.darklinercolor))
            : Column(
          children: [
            // Wallet Balance Card
            Container(
              margin: EdgeInsets.all(16),
              padding: EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [linercolor, Color(0xFF6C63FF)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: linercolor.withOpacity(0.3),
                    blurRadius: 10,
                    offset: Offset(0, 5),
                  ),
                ],
              ),
              child: Column(
                children: [
                  Text(
                    "Wallet Balance".tr,
                    style: TextStyle(
                      color: whitecolor.withOpacity(0.8),
                      fontSize: 16,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                  SizedBox(height: 10),
                  Text(
                    "₹${walletBalance.toStringAsFixed(2)}",
                    style: TextStyle(
                      color: whitecolor,
                      fontSize: 36,
                      fontFamily: 'Gilroy_Bold',
                    ),
                  ),
                  SizedBox(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _showAddMoneyDialog,
                          icon: Icon(Icons.add, size: 20),
                          label: Text("Add Money".tr),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: whitecolor,
                            foregroundColor: linercolor,
                            padding: EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                      SizedBox(width: 10),
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _showWithdrawDialog,
                          icon: Icon(Icons.remove, size: 20),
                          label: Text("Withdraw".tr),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.transparent,
                            foregroundColor: whitecolor,
                            side: BorderSide(color: whitecolor),
                            padding: EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Transaction History Header
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Text(
                    "Transaction History".tr,
                    style: TextStyle(
                      color: notifier.text,
                      fontSize: 18,
                      fontFamily: 'Gilroy_Bold',
                    ),
                  ),
                  Spacer(),
                  IconButton(
                    onPressed: _getWalletHistory,
                    icon: Icon(Icons.refresh, color: notifier.darklinercolor),
                  ),
                ],
              ),
            ),

            // Transaction History List
            Expanded(
              child: isHistoryLoading
                  ? Center(child: CircularProgressIndicator(color: notifier.darklinercolor))
                  : walletHistory.isEmpty
                  ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.history, size: 60, color: greaycolor),
                    SizedBox(height: 10),
                    Text(
                      "No transactions yet".tr,
                      style: TextStyle(
                        color: greaycolor,
                        fontSize: 16,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ],
                ),
              )
                  : ListView.separated(
                padding: EdgeInsets.symmetric(horizontal: 16),
                itemCount: walletHistory.length,
                physics: BouncingScrollPhysics(),
                itemBuilder: (context, index) {
                  var transaction = walletHistory[index];
                  return Container(
                    padding: EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: notifier.getBgColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: notifier.bordecolor),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: transaction["type"] == "credit"
                                ? Colors.green.withOpacity(0.1)
                                : Colors.red.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            transaction["type"] == "credit"
                                ? Icons.arrow_downward
                                : Icons.arrow_upward,
                            color: transaction["type"] == "credit"
                                ? Colors.green
                                : Colors.red,
                            size: 20,
                          ),
                        ),
                        SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "${transaction["remark"] ?? "Transaction"}",
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 14,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                DateFormat("MMM dd, yyyy - hh:mm a").format(
                                    DateTime.parse(transaction["created_at"])
                                ),
                                style: TextStyle(
                                  color: greaycolor,
                                  fontSize: 12,
                                  fontFamily: 'Gilroy_Medium',
                                ),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              "₹${transaction["amount"]}",
                              style: TextStyle(
                                color: transaction["type"] == "credit"
                                    ? Colors.green
                                    : Colors.red,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 16,
                              ),
                            ),
                            Text(
                              transaction["type"] == "credit" ? "Credit" : "Debit",
                              style: TextStyle(
                                color: transaction["type"] == "credit"
                                    ? Colors.green
                                    : Colors.red,
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  );
                },
                separatorBuilder: (BuildContext context, int index) {
                  return SizedBox(height: 8);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}