// lib/screens/wallet/WalletPage.dart

import 'dart:convert';

import 'package:goParcel/Api/AppModelApi/payment_gatwey_api_model.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/referral_points_screen.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../../Api/Api_wrapper.dart';
import '../../../Api/config.dart';
import '../../../utils/colors.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'widgets/wallet_widgets.dart';
import '../../theme/widgets/scroll_away_header.dart';
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
  String walletPoints = "0";
  List walletHistory = [];
  bool isLoading = true;
  bool isHistoryLoading = true;
  bool isPaymentLoading = false;
  DateTime? filterFromDate;
  DateTime? filterToDate;
  String filterTxnType = "";

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
  _getPaymentGateway() {
    ApiWrapper.dataGetNode(Config.nodePaymentGateways).then((val) {
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
    var data = {
      "mobile": mobile,
      "wallet_type": "user",
      "from_date": filterFromDate != null ? DateFormat('yyyy-MM-dd').format(filterFromDate!) : "",
      "to_date": filterToDate != null ? DateFormat('yyyy-MM-dd').format(filterToDate!) : "",
      "txn_type": filterTxnType,
    };

    ApiWrapper.dataPostNode(Config.nodeWalletHistory, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if (val['Result'] == true || val['Result'] == "true") {
          walletBalance = double.tryParse(val["wallet_balance"]?.toString() ?? "0.0") ?? 0.0;
          walletPoints = val["wallet_points"]?.toString() ?? val["points"]?.toString() ?? "0";
          walletHistory = val["data"] ?? [];
        } else {
          walletHistory = [];
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
    final maxTopup = double.tryParse(GetStorage().read("wallet_max_topup")?.toString() ?? "") ?? 50000;
    if (amount > maxTopup) {
      tostmsg("Maximum amount limit is ₹${maxTopup.toStringAsFixed(0)} per transaction");
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

    ApiWrapper.dataPostNode(Config.nodeCreateOrder, data).then((val) {
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
           String razorpayKey = Config.razorpayKeyId;
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
      "wallet_type": "user",
      "amount": _amountController.text,
      "razorpay_order_id": razorpayOrderId ?? "",
      "razorpay_payment_id": razorpayPaymentId,
      "razorpay_signature": razorpaySignature,
    };

    debugPrint("======== Preparing Add Wallet API Call ========");
    debugPrint("API URL: ${Config.nodeWalletAdd}");
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

    ApiWrapper.dataPostNode(Config.nodeWalletAdd, dataAddWallet).then((val) {
      isPaymentLoading = false;
      setState(() {});

      if ((val != null) && (val.isNotEmpty)) {
        debugPrint("======== Add Wallet Response ======== $val");
        if (val['Result'] == true || val['Result'] == "true") {
          // Node's addWallet returns "msg" (not "ResponseMsg") - check both.
          tostmsg(val["msg"] ?? val["ResponseMsg"] ?? "Money added successfully");
          _amountController.clear();
          _remarkController.clear();
          razorpayOrderId = null;
          _getWalletHistory(); // Refresh data
        } else {
          tostmsg(val["msg"] ?? val["ResponseMsg"] ?? "Failed to add money to wallet");
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
      "wallet_type": "user",
      "amount": _amountController.text,
      "remark": _remarkController.text.isEmpty ? "Withdraw by user" : _remarkController.text
    };

    ApiWrapper.dataPostNode(Config.nodeWalletWithdraw, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if (val['Result'] == true || val['Result'] == "true") {
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

  /// All / Credit / Debit chips: the same transaction-type filter the filter dialog sets (dates untouched).
  void _setTxnType(String type) {
    setState(() => filterTxnType = type);
    _getWalletHistory();
  }

  _showAddMoneyDialog() {
    _amountController.clear();
    _remarkController.clear();

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final entered = double.tryParse(_amountController.text.trim()) ?? 0.0;
            final pgCharge = entered * 0.025;
            final netCredit = entered > 0 ? (entered - pgCharge) : 0.0;

            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: Text("Add Money to Ledger".tr, style: const TextStyle(fontFamily: 'Gilroy_Bold')),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: _amountController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => setDialogState(() {}),
                      decoration: InputDecoration(
                        labelText: "Amount (₹)".tr,
                        hintText: "Enter amount (Max ₹50,000)",
                        prefixIcon: const Icon(Icons.currency_rupee_rounded, size: 20),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _remarkController,
                      decoration: InputDecoration(
                        labelText: "Remark (Optional)".tr,
                        hintText: "Enter remark",
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                    if (entered > 0) ...[
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xffF8FAFC),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xffE2E8F0)),
                        ),
                        child: Column(
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text("Recharge Amount:".tr, style: const TextStyle(fontSize: 12.5, fontFamily: 'Gilroy_Medium', color: Color(0xff64748B))),
                                Text("₹${entered.toStringAsFixed(2)}", style: const TextStyle(fontSize: 13, fontFamily: 'Gilroy_Bold')),
                              ],
                            ),
                            const SizedBox(height: 5),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text("Platform convenience fees (2.5%):".tr, style: const TextStyle(fontSize: 12.5, fontFamily: 'Gilroy_Medium', color: Color(0xffDC2626))),
                                Text("-₹${pgCharge.toStringAsFixed(2)}", style: const TextStyle(fontSize: 13, fontFamily: 'Gilroy_Bold', color: Color(0xffDC2626))),
                              ],
                            ),
                            const Divider(height: 14),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text("Net Added to Ledger:".tr, style: const TextStyle(fontSize: 13, fontFamily: 'Gilroy_Bold')),
                                Text("₹${netCredit.toStringAsFixed(2)}", style: const TextStyle(fontSize: 14, fontFamily: 'Gilroy_Bold', color: Color(0xff16A34A))),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        "* 2.5% Platform convenience fees will be deducted and recorded in your ledger.",
                        style: TextStyle(fontSize: 11, color: Colors.grey.shade600, fontFamily: 'Gilroy_Regular'),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "You are still saving! Compare your total cost with other platforms.".tr,
                        style: const TextStyle(fontSize: 11, color: Color(0xff16A34A), fontFamily: 'Gilroy_Medium'),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Get.back(),
                  child: Text("Cancel".tr, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium')),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: linercolor,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: isPaymentLoading ? null : _addMoneyToWallet,
                  child: isPaymentLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : Text("Proceed to Pay".tr, style: const TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold')),
                ),
              ],
            );
          },
        );
      },
    );
  }

  // Show Filter Dialog
  _showFilterDialog() {
    String tempTxnType = filterTxnType;
    DateTime? tempFromDate = filterFromDate;
    DateTime? tempToDate = filterToDate;

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              title: Text("Filter History".tr),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Transaction Type".tr),
                  SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: tempTxnType,
                    decoration: InputDecoration(
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    ),
                    items: [
                      DropdownMenuItem(value: "", child: Text("All".tr)),
                      DropdownMenuItem(value: "credit", child: Text("Credit".tr)),
                      DropdownMenuItem(value: "debit", child: Text("Debit".tr)),
                    ],
                    onChanged: (val) {
                      setDialogState(() {
                        tempTxnType = val ?? "";
                      });
                    },
                  ),
                  SizedBox(height: 16),
                  Text("Date Range".tr),
                  SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          onTap: () async {
                            var date = await showDatePicker(
                              context: context,
                              initialDate: tempFromDate ?? DateTime.now(),
                              firstDate: DateTime(2000),
                              lastDate: DateTime.now().add(Duration(days: 365)),
                            );
                            if (date != null) {
                              setDialogState(() {
                                tempFromDate = date;
                              });
                            }
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.grey),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Center(
                              child: Text(
                                tempFromDate != null 
                                  ? DateFormat("dd/MM/yyyy").format(tempFromDate!) 
                                  : "From Date".tr,
                                style: TextStyle(fontSize: 12),
                              ),
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 10),
                      Expanded(
                        child: InkWell(
                          onTap: () async {
                            var date = await showDatePicker(
                              context: context,
                              initialDate: tempToDate ?? DateTime.now(),
                              firstDate: DateTime(2000),
                              lastDate: DateTime.now().add(Duration(days: 365)),
                            );
                            if (date != null) {
                              setDialogState(() {
                                tempToDate = date;
                              });
                            }
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.grey),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Center(
                              child: Text(
                                tempToDate != null 
                                  ? DateFormat("dd/MM/yyyy").format(tempToDate!) 
                                  : "To Date".tr,
                                style: TextStyle(fontSize: 12),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    setDialogState(() {
                      tempTxnType = "";
                      tempFromDate = null;
                      tempToDate = null;
                    });
                  },
                   child: Text("Clear".tr)
                ),
                TextButton(
                  onPressed: () {
                    Get.back();
                  },
                  child: Text("Cancel".tr),
                ),
                ElevatedButton(
                  onPressed: () {
                    setState(() {
                      filterTxnType = tempTxnType;
                      filterFromDate = tempFromDate;
                      filterToDate = tempToDate;
                    });
                    Get.back();
                    _getWalletHistory();
                  },
                  child: Text("Apply".tr),
                )
              ],
            );
          }
        );
      }
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
    final p = AppPalette.current;
    final filtered = filterTxnType.isNotEmpty || filterFromDate != null || filterToDate != null;
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: p.surface,
        centerTitle: false,
        title: Text("Wallet".tr, style: AppText.title(p.ink)),
      ),
      body: isLoading
          ? ListView(
              padding: const EdgeInsets.all(16),
              children: const [
                AppSkeleton(height: 200, radius: 20),
                SizedBox(height: 16),
                AppSkeleton(height: 64),
                SizedBox(height: 10),
                AppSkeleton(height: 64),
              ],
            )
          // Cards + history header scroll away above the list, so small phones keep room for transactions.
          : ScrollAwayHeader(
              header: [
                // Balance + Reward Points cards (Porter "Payments" layout)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      WalletBalanceCard(balance: walletBalance, onAddMoney: _showAddMoneyDialog),
                      const SizedBox(height: 12),
                      RewardPointsCard(
                        points: walletPoints,
                        onTap: () => Get.to(() => const ReferralPointsScreen()),
                      ),
                    ],
                  ),
                ),

                // Transaction History Header
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
                  child: Row(
                    children: [
                      Text("Transaction History".tr, style: AppText.section(p.ink)),
                      const Spacer(),
                      IconButton(
                        tooltip: 'Filter'.tr,
                        onPressed: _showFilterDialog,
                        icon: Icon(filtered ? Icons.filter_alt : Icons.filter_alt_outlined,
                            color: filtered ? p.brand : p.ink),
                      ),
                      IconButton(
                        tooltip: 'Refresh'.tr,
                        onPressed: _getWalletHistory,
                        icon: Icon(Icons.refresh, color: p.ink),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: TxnTypeChips(selected: filterTxnType, onSelected: _setTxnType),
                  ),
                ),

              ],
              // Transaction History List
              body: isHistoryLoading
                      ? ListView(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          children: const [
                            AppSkeleton(height: 64),
                            SizedBox(height: 8),
                            AppSkeleton(height: 64),
                            SizedBox(height: 8),
                            AppSkeleton(height: 64),
                          ],
                        )
                      : walletHistory.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Container(
                                    width: 72,
                                    height: 72,
                                    decoration: BoxDecoration(
                                        color: p.surface, shape: BoxShape.circle, border: Border.all(color: p.line)),
                                    child: Icon(Icons.history, size: 32, color: p.inkSubtle),
                                  ),
                                  const SizedBox(height: 12),
                                  Text("No transactions yet".tr, style: AppText.bodyStrong(p.ink)),
                                ],
                              ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              itemCount: walletHistory.length,
                              physics: const BouncingScrollPhysics(),
                              itemBuilder: (context, index) {
                                var transaction = walletHistory[index];
                                final credit = transaction["type"] == "credit";
                                final fg = credit ? p.successText : p.danger;
                                return Container(
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: p.surface,
                                    borderRadius: BorderRadius.circular(AppRadius.card),
                                    border: Border.all(color: p.line),
                                  ),
                                  child: Row(
                                    children: [
                                      Container(
                                        width: 38,
                                        height: 38,
                                        decoration: BoxDecoration(
                                          color: credit ? p.successTint : p.dangerTint,
                                          shape: BoxShape.circle,
                                        ),
                                        child: Icon(credit ? Icons.arrow_downward : Icons.arrow_upward, color: fg, size: 18),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text("${transaction["remark"] ?? "Transaction"}",
                                                style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                                            const SizedBox(height: 3),
                                            Text(
                                              DateFormat("MMM dd, yyyy - hh:mm a")
                                                  .format(DateTime.parse(transaction["created_at"])),
                                              style: AppText.caption(p.inkSubtle),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.end,
                                        children: [
                                          Text("${credit ? '+' : '−'} ₹${transaction["amount"]}",
                                              style: AppText.bodyStrong(fg).copyWith(fontSize: 15)),
                                          Text((credit ? "Credit" : "Debit").tr, style: AppText.caption(fg)),
                                        ],
                                      ),
                                    ],
                                  ),
                                );
                              },
                              separatorBuilder: (BuildContext context, int index) => const SizedBox(height: 8),
                            ),
            ),
    );
  }
}
