// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'free_booking_status_card.dart';

class PremiumPlansScreen extends StatefulWidget {
  const PremiumPlansScreen({super.key});

  @override
  State<PremiumPlansScreen> createState() => _PremiumPlansScreenState();
}

class _PremiumPlansScreenState extends State<PremiumPlansScreen> {
  bool _isLoadingPlans = true;
  bool _isPurchasing = false;
  List<Map<String, dynamic>> _plans = [];
  Map<String, dynamic>? _activePlan;
  int? _selectedPlanIndex;
  String _currency = '₹';
  late ColorNotifier notifier;

  RazorPayClass razorPayClass = RazorPayClass();
  String? razorpayOrderId;
  Map<String, dynamic>? pendingPlanToPurchase;
  double pendingAmountPaid = 0.0;
  int pendingUsedPoints = 0;
  String _razorpayKey = "rzp_test_Rr8n8p41taq6fM";

  @override
  void initState() {
    super.initState();
    _fetchPaymentGateway();
    _fetchPlans();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: _handlePaymentSuccess,
      handlePaymentError: _handlePaymentError,
      handleExternalWallet: _handleExternalWallet,
    );
  }

  Future<void> _fetchPaymentGateway() async {
    try {
      final val = await ApiWrapper.dataGetNode(Config.nodePaymentGateways);
      if (val != null && (val['ResponseCode'] == "200") && (val['Result'] == "true" || val['Result'] == true)) {
        final list = val['paymentdata'] ?? val['data'];
        if (list is List) {
          for (var item in list) {
            if (item['title']?.toString().toLowerCase().contains('razorpay') == true) {
              final keyAttr = item['attributes']?.toString().trim();
              if (keyAttr != null && keyAttr.startsWith('rzp_')) {
                _razorpayKey = keyAttr;
                debugPrint("PremiumPlans: fetched Razorpay Key from gateway → $_razorpayKey");
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      debugPrint("PremiumPlans: error fetching payment gateway → $e");
    }
  }

  @override
  void dispose() {
    razorPayClass.desposRazorPay();
    super.dispose();
  }

  // ── Fetch Plans ─────────────────────────────────────────────────────────
  Future<void> _fetchPlans() async {
    setState(() => _isLoadingPlans = true);
    try {
      final uid = getdata.read("Uid")?.toString() ?? "";
      final response = await ApiWrapper.dataPostNode(
        Config.nodePremiumPlans,
        {"uid": uid},
      );
      debugPrint("PremiumPlans: fetchPlans → $response");

      if (response != null && (response['ResponseCode'] == "200" || response['Result'] == "true" || response['Result'] == true)) {
        final rawPlans = response['Plans'];
        if (rawPlans is List) {
          setState(() {
            _plans = List<Map<String, dynamic>>.from(rawPlans);
            _activePlan = response['ActivePlan'];
            _currency = response['Currency']?.toString() ?? '₹';
          });
        }
      } else {
        tostmsg(response?['ResponseMsg']?.toString() ?? "Failed to load plans");
      }
    } catch (e) {
      debugPrint("PremiumPlans: fetchPlans error → $e");
      tostmsg("Something went wrong");
    } finally {
      setState(() => _isLoadingPlans = false);
    }
  }

  void _handlePaymentSuccess(PaymentSuccessResponse response) {
    debugPrint("======== Payment Success Handler Triggered ========");
    debugPrint("Payment ID: ${response.paymentId}");
    if (pendingPlanToPurchase != null) {
      _finalizePlanPurchase(
        pendingPlanToPurchase!,
        response.paymentId ?? "",
        pendingAmountPaid,
        usedPoints: pendingUsedPoints,
        razorpaySignature: response.signature ?? "",
      );
    }
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    setState(() => _isPurchasing = false);
    debugPrint("======== Payment Failed ========");
    if (response.code == 1) {
      tostmsg("Payment cancelled");
    } else {
      tostmsg("Payment failed: ${response.message ?? 'Unknown error'}");
    }
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    setState(() => _isPurchasing = false);
    tostmsg("External Wallet Selected: ${response.walletName}");
  }

  // ── Show Payment Bottom Sheet ───────────────────────────────────────────
  void _showPaymentBottomSheet(Map<String, dynamic> plan) {
    final purchaseInfo = plan['purchase_info'] as Map<String, dynamic>? ?? {};
    final priceInfo = plan['price_info'] as Map<String, dynamic>? ?? {};
    
    final double planPrice = double.tryParse(priceInfo['price']?.toString() ?? '0') ?? 0;
    int pointsAvailable = int.tryParse(purchaseInfo['points_available']?.toString() ?? '0') ?? 0;
    // Admin caps how much of the price points may cover - never let the stepper go past it.
    int maxUsablePoints = int.tryParse(purchaseInfo['points_usable']?.toString() ?? '') ?? pointsAvailable;
    double pointValue = double.tryParse(purchaseInfo['point_value']?.toString() ?? '1') ?? 1;
    
    int usedPoints = 0;
    
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: notifier.getBgColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            double discountFromPoints = (usedPoints * pointValue).toDouble();
            double finalAmountToPay = planPrice - discountFromPoints;
            if (finalAmountToPay < 0) finalAmountToPay = 0;

            return Padding(
              padding: EdgeInsets.only(
                left: 16, right: 16, top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        "Payment Details".tr,
                        style: TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 18,
                          color: notifier.text,
                        ),
                      ),
                      InkWell(
                        onTap: () => Navigator.pop(context),
                        child: Icon(Icons.close, color: notifier.text),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  
                  // Plan Info
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        plan['plan_name']?.toString() ?? 'Plan',
                        style: TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 16, color: notifier.text),
                      ),
                      Text(
                        "$_currency${planPrice.toStringAsFixed(0)}",
                        style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16, color: notifier.text),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Points Section
                  if (pointsAvailable > 0) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.orange.withOpacity(0.3)),
                      ),
                      child: Column(
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                "Available Points: $pointsAvailable".tr,
                                style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 14, color: Colors.orange),
                              ),
                              Text(
                                "(1 Point = $_currency$pointValue)".tr,
                                style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12, color: Colors.orange),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                "Use Points".tr,
                                style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 15, color: notifier.text),
                              ),
                              Row(
                                children: [
                                  InkWell(
                                    onTap: () {
                                      if (usedPoints > 0) {
                                        setSheetState(() => usedPoints -= 10);
                                        if (usedPoints < 0) usedPoints = 0;
                                      }
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.all(4),
                                      decoration: BoxDecoration(
                                        color: Colors.orange,
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: const Icon(Icons.remove, color: Colors.white, size: 16),
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 12),
                                    child: Text(
                                      "$usedPoints",
                                      style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16, color: notifier.text),
                                    ),
                                  ),
                                  InkWell(
                                    onTap: () {
                                      if (usedPoints < maxUsablePoints && finalAmountToPay > 0) {
                                        setSheetState(() => usedPoints += 10);
                                        if (usedPoints > maxUsablePoints) usedPoints = maxUsablePoints;
                                      }
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.all(4),
                                      decoration: BoxDecoration(
                                        color: Colors.orange,
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: const Icon(Icons.add, color: Colors.white, size: 16),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          if (usedPoints > 0) ...[
                            const SizedBox(height: 8),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text("Points Value".tr, style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 13, color: Colors.green)),
                                Text("- $_currency${discountFromPoints.toStringAsFixed(0)}", style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 13, color: Colors.green)),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],

                  Divider(color: notifier.bordecolor),
                  const SizedBox(height: 12),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        "Amount to Pay".tr,
                        style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 18, color: notifier.text),
                      ),
                      Text(
                        "$_currency${finalAmountToPay.toStringAsFixed(0)}",
                        style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 22, color: linercolor),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),

                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        _purchasePlanWithAmount(plan, finalAmountToPay, usedPoints);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: linercolor,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text(
                        finalAmountToPay <= 0 ? "Activate Plan".tr : "Pay $_currency${finalAmountToPay.toStringAsFixed(0)}".tr,
                        style: const TextStyle(fontSize: 16, color: Colors.white, fontFamily: 'Gilroy_Bold'),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  // ── Purchase Plan ────────────────────────────────────────────────────────
  Future<void> _purchasePlanWithAmount(Map<String, dynamic> plan, double amountToPay, int usedPoints) async {
    if (amountToPay <= 0) {
      _finalizePlanPurchase(plan, "wallet_full_points", amountToPay, usedPoints: usedPoints);
      return;
    }

    setState(() => _isPurchasing = true);
    pendingPlanToPurchase = plan;
    pendingAmountPaid = amountToPay;
    pendingUsedPoints = usedPoints;

    final userLogin = getdata.read("UserLogin");
    final userMobile = (userLogin is Map ? userLogin["mobile"]?.toString() : null) ??
        getdata.read("mobile")?.toString() ??
        "";
    final userName = (userLogin is Map ? userLogin["name"]?.toString() : null) ??
        getdata.read("name")?.toString() ??
        "User";

    var dataOrder = {
      "mobile": userMobile,
      "amount": amountToPay.toString(),
    };
    
    try {
      final val = await ApiWrapper.dataPostNode(Config.nodeCreateOrder, dataOrder);
      debugPrint("PremiumPlans: createOrder response → $val");

      if (val != null && (val['Result'] == "true" || val['Result'] == true || val['ResponseCode'] == "200")) {
        razorpayOrderId = val["OrderId"]?.toString();
        
        if (razorpayOrderId == null || razorpayOrderId!.isEmpty) {
          setState(() => _isPurchasing = false);
          tostmsg(val["ResponseMsg"]?.toString() ?? "Order ID not received from server");
          return;
        }

        int amountInPaise = (amountToPay * 100).toInt();
        debugPrint("PremiumPlans: opening checkout with key: $_razorpayKey, orderId: $razorpayOrderId, amount: $amountInPaise");

        razorPayClass.openCheckout(
          key: _razorpayKey,
          amount: amountInPaise.toString(),
          orderId: razorpayOrderId!,
          number: userMobile,
          name: userName,
          description: plan['plan_name']?.toString() ?? "Premium Plan",
          currency: "INR",
        );
      } else {
        setState(() => _isPurchasing = false);
        tostmsg(val?["ResponseMsg"]?.toString() ?? "Failed to create payment order");
      }
    } catch (e) {
      setState(() => _isPurchasing = false);
      debugPrint("PremiumPlans: createOrder error → $e");
      tostmsg("Payment gateway error: $e");
    }
  }

  Future<void> _finalizePlanPurchase(Map<String, dynamic> plan, String paymentId, double amountPaid, {int usedPoints = 0, String razorpaySignature = ""}) async {
    final uid = getdata.read("Uid")?.toString() ?? "";
    final planId = plan['plan_id']?.toString() ?? plan['id']?.toString() ?? "";

    setState(() => _isPurchasing = true);
    try {
      final response = await ApiWrapper.dataPostNode(
        Config.nodePremiumPlansPurchase,
        {
          "uid": uid,
          "plan_id": planId,
          "use_points": usedPoints > 0,
          "points_to_use": usedPoints,
          // Real money was actually charged only when amountPaid > 0 - the
          // backend now verifies this against Razorpay itself instead of
          // trusting amount_paid (see customerPlanService.js), so the
          // order/signature must travel with the payment id.
          "payment_txn_id": paymentId,
          "payment_method": amountPaid <= 0 ? "wallet" : "Razorpay",
          "razorpay_order_id": amountPaid > 0 ? (razorpayOrderId ?? "") : "",
          "razorpay_signature": amountPaid > 0 ? razorpaySignature : "",
        },
      );
      debugPrint("PremiumPlans: finalizePlanPurchase response → $response");
      
      if (response != null && (response['ResponseCode'] == "200" || response['Result'] == "true" || response['Result'] == true)) {
        tostmsg(response['ResponseMsg']?.toString() ?? "Plan purchased successfully!");
        _fetchPlans();
      } else {
        tostmsg(response?['ResponseMsg']?.toString() ?? "Purchase failed");
      }
    } catch (e) {
      debugPrint("PremiumPlans: finalizePlanPurchase error → $e");
      tostmsg("Error finalizing purchase: $e");
    } finally {
      setState(() {
        _isPurchasing = false;
        pendingPlanToPurchase = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of<ColorNotifier>(context, listen: true);
    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      body: Stack(
        children: [
          Column(
            children: [
              // ── Header ──────────────────────────────────────────────────
              Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [linercolor, linercolor.withOpacity(0.85)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                padding: EdgeInsets.only(
                  top: MediaQuery.of(context).padding.top + 16,
                  bottom: 30,
                  left: 16,
                  right: 16,
                ),
                child: Column(
                  children: [
                    // Back button + title row
                    Row(
                      children: [
                        InkWell(
                          onTap: () => Get.back(),
                          borderRadius: BorderRadius.circular(30),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: Colors.white.withOpacity(0.2),
                            ),
                            child: const Icon(Icons.arrow_back,
                                color: Colors.white, size: 20),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(
                          "Premium Plans".tr,
                          style: const TextStyle(
                            color: Colors.white,
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 20,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    // Icon + subtitle
                    Container(
                      height: 68,
                      width: 68,
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.18),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.workspace_premium_rounded,
                        size: 36,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      "Upgrade & Unlock Benefits".tr,
                      style: const TextStyle(
                        fontSize: 18,
                        color: Colors.white,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "Choose a plan that suits you best".tr,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Colors.white70,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ],
                ),
              ),

              // ── Active Plan Banner ───────────────────────────────────────
              if (_activePlan != null) _buildActivePlanBanner(),

              // ── Plans List ───────────────────────────────────────────────
              Expanded(
                child: _isLoadingPlans
                    ? Center(
                        child: CircularProgressIndicator(color: linercolor))
                    : _plans.isEmpty
                        ? _buildEmptyState()
                        : SingleChildScrollView(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 16),
                            child: Column(
                              children: [
                                const FreeBookingStatusCard(),
                                ...List.generate(_plans.length, (index) {
                                  return _buildPlanCard(index);
                                }),
                                const SizedBox(height: 16),
                                // ── Purchase Button ────────────────────
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: (_selectedPlanIndex == null ||
                                            _isPurchasing)
                                        ? null
                                        : () => _showPaymentBottomSheet(
                                            _plans[_selectedPlanIndex!]),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: linercolor,
                                      disabledBackgroundColor:
                                          linercolor.withOpacity(0.4),
                                      padding: const EdgeInsets.symmetric(
                                          vertical: 16),
                                      shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(14),
                                      ),
                                    ),
                                    child: Text(
                                      _isPurchasing
                                          ? "Processing...".tr
                                          : "Purchase Plan".tr,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        color: Colors.white,
                                        fontFamily: 'Gilroy_Bold',
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 24),
                              ],
                            ),
                          ),
              ),
            ],
          ),

          // ── Global loading overlay ─────────────────────────────────────
          if (_isPurchasing)
            Container(
              color: Colors.black.withOpacity(0.3),
              child: Center(
                child: CircularProgressIndicator(color: linercolor),
              ),
            ),
        ],
      ),
    );
  }

  // ── Active Plan Banner ─────────────────────────────────────────────────
  Widget _buildActivePlanBanner() {
    final name = _activePlan!['plan_name']?.toString() ?? 'Active Plan';
    final validity = _activePlan!['validity_label']?.toString() ?? '';
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Colors.green.shade700, Colors.green.shade500],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.green.withOpacity(0.25),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          const Icon(Icons.verified_rounded, color: Colors.white, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Active Plan: $name",
                  style: const TextStyle(
                    color: Colors.white,
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 15,
                  ),
                ),
                if (validity.isNotEmpty)
                  Text(
                    validity,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 12,
                    ),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.25),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Text(
              "ACTIVE",
              style: TextStyle(
                color: Colors.white,
                fontFamily: 'Gilroy_Bold',
                fontSize: 11,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Plan Card ──────────────────────────────────────────────────────────
  Widget _buildPlanCard(int index) {
    final plan = _plans[index];
    final bool isSelected = _selectedPlanIndex == index;

    final String name = plan['plan_name']?.toString() ?? 'Plan';
    final String validityLabel =
        plan['validity_label']?.toString() ?? '';
    final String description = plan['description']?.toString() ?? '';
    final bool isPopular = plan['is_popular'] == true;
    final bool isActive = plan['is_active'] == true;

    final priceInfo = plan['price_info'] as Map<String, dynamic>? ?? {};
    final purchaseInfo = plan['purchase_info'] as Map<String, dynamic>? ?? {};
    final referAndEarn = plan['refer_and_earn'] as Map<String, dynamic>? ?? {};
    final String refNote = referAndEarn['note']?.toString() ?? '';
    
    final double pointsCoveredAmount = double.tryParse(purchaseInfo['points_covered_amount']?.toString() ?? '0') ?? 0;
    final int pointsUsable = int.tryParse(purchaseInfo['points_usable']?.toString() ?? '0') ?? 0;

    final double finalPrice =
        double.tryParse(purchaseInfo['payable_amount']?.toString() ?? priceInfo['price']?.toString() ?? '0') ?? 0;
    final double originalPrice =
        double.tryParse(priceInfo['price']?.toString() ?? '0') ?? 0;
    final String currencySymbol =
        priceInfo['currency_symbol']?.toString() ?? _currency;
    final bool hasDiscount = originalPrice > finalPrice;

    // Benefits ui_tags
    final List<String> uiTags = [];
    if (plan['ui_tags'] is List) {
      uiTags.addAll(List<String>.from(plan['ui_tags']));
    }

    return GestureDetector(
      onTap: () {
        if (!isActive) {
          setState(() => _selectedPlanIndex = index);
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isActive
                ? Colors.green
                : isSelected
                    ? linercolor
                    : notifier.bordecolor,
            width: (isSelected || isActive) ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: isSelected
                  ? linercolor.withOpacity(0.15)
                  : Colors.black.withOpacity(0.04),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [

                  const SizedBox(height: 10),

                  // ── Title Row ──────────────────────────────────────
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 17,
                                color: notifier.text,
                              ),
                            ),
                            if (validityLabel.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                validityLabel,
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 12,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      // Radio / Active indicator
                      if (isActive)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.green.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: Colors.green),
                          ),
                          child: const Text(
                            "Current",
                            style: TextStyle(
                              color: Colors.green,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 11,
                            ),
                          ),
                        )
                      else
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          height: 22,
                          width: 22,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: isSelected
                                ? linercolor
                                : Colors.transparent,
                            border: Border.all(
                              color: isSelected ? linercolor : Colors.grey,
                              width: 2,
                            ),
                          ),
                          child: isSelected
                              ? const Icon(Icons.check,
                                  color: Colors.white, size: 14)
                              : null,
                        ),
                    ],
                  ),

                  const SizedBox(height: 12),

                  // ── Price Row ──────────────────────────────────────
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        "$currencySymbol${finalPrice.toStringAsFixed(0)}",
                        style: TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 28,
                          color: linercolor,
                        ),
                      ),
                      if (hasDiscount) ...[
                        const SizedBox(width: 8),
                        Text(
                          "$currencySymbol${originalPrice.toStringAsFixed(0)}",
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 15,
                            color: Colors.grey,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.green.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            "Save $currencySymbol${(originalPrice - finalPrice).toStringAsFixed(0)}",
                            style: const TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 11,
                              color: Colors.green,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),

                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      description,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 13,
                        color: Colors.grey,
                      ),
                    ),
                  ],

                  if (pointsUsable > 0) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.stars, color: Colors.orange, size: 14),
                          const SizedBox(width: 4),
                          Text(
                            "$pointsUsable Points Applied (-$currencySymbol${pointsCoveredAmount.toStringAsFixed(0)})",
                            style: const TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 12,
                              color: Colors.orange,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  // ── Benefits ──────────────────────────────────────
                  if (uiTags.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Divider(color: notifier.bordecolor),
                    const SizedBox(height: 8),
                    ...uiTags.map(
                      (tag) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          children: [
                            const Icon(Icons.check_circle_rounded,
                                color: Colors.green, size: 16),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                tag,
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 13,
                                  color: notifier.text,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],

                  if (refNote.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.blue.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.blue.withOpacity(0.2)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline, color: Colors.blue, size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              refNote,
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 11,
                                color: Colors.blue,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),

            // ── Popular Badge ────────────────────────────────────────
            if (isPopular)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Colors.orange.shade600, Colors.orange.shade400],
                    ),
                    borderRadius: const BorderRadius.only(
                      topRight: Radius.circular(18),
                      bottomLeft: Radius.circular(12),
                    ),
                  ),
                  child: const Text(
                    "🔥 Popular",
                    style: TextStyle(
                      color: Colors.white,
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 11,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  // ── Empty State ────────────────────────────────────────────────────────
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.info_outline_rounded, size: 60, color: Colors.grey),
          const SizedBox(height: 12),
          Text(
            "No plans available".tr,
            style: TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 16,
              color: notifier.text,
            ),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => Get.back(),
            child: Text(
              "Go Back".tr,
              style: TextStyle(
                fontFamily: 'Gilroy_Medium',
                color: linercolor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
