// SelectPlanScreen.dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

class SelectPlanScreen extends StatefulWidget {
  final Map<String, dynamic> userData;
  final String? ptype;

  const SelectPlanScreen({
    super.key,
    required this.userData,
    this.ptype,
  });

  @override
  State<SelectPlanScreen> createState() => _SelectPlanScreenState();
}

class _SelectPlanScreenState extends State<SelectPlanScreen> {
  // Plans state
  bool _isLoadingPlans = true;
  List<Map<String, dynamic>> _plans = [];
  int? _selectedPlanIndex;

  // Payment state
  bool _isPaymentLoading = false;
  String? _razorpayOrderId;
  int? _currentPlanId;
  String? _currentPlanAmount;

  // Razorpay
  final RazorPayClass _razorPayClass = RazorPayClass();
  static const String _razorpayKey = "rzp_test_Rr8n8p41taq6fM";

  @override
  void initState() {
    super.initState();
    _fetchPlans();
    _razorPayClass.initiateRazorPay(
      handlePaymentSuccess: _handlePaymentSuccess,
      handlePaymentError: _handlePaymentError,
      handleExternalWallet: _handleExternalWallet,
    );
  }

  @override
  void dispose() {
    _razorPayClass.desposRazorPay();
    super.dispose();
  }

  // ── API: fetch plan list ─────────────────────────────────────────────────
  Future<void> _fetchPlans() async {
    setState(() => _isLoadingPlans = true);
    try {
      final response = await ApiWrapper.dataPost(
        Config.getPlan,
        {"type": "user"},
      );
      if (response != null && response['Result'] == true) {
        final raw = response['plans'];
        if (raw is List) {
          setState(() {
            _plans = List<Map<String, dynamic>>.from(raw)
                .where((p) => p['screen_show']?.toString() == '1')
                .toList();
          });
        }
      }
    } catch (e) {
      debugPrint("SelectPlan: fetchPlans error → $e");
    } finally {
      setState(() => _isLoadingPlans = false);
    }
  }

  // ── API: create plan order and open Razorpay ─────────────────────────────
  Future<void> _createPlanOrder(Map<String, dynamic> plan) async {
    final userId = getdata.read("UserLogin")?["id"]?.toString() ??
        getdata.read("Uid")?.toString() ??
        "1";
    final planId = int.tryParse(plan['id']?.toString() ?? '0') ?? 0;

    setState(() => _isPaymentLoading = true);

    try {
      final response = await ApiWrapper.dataPost(
        Config.createPlanOrder,
        {
          "plan_id": planId,
          "user_id": int.tryParse(userId) ?? 1,
          "type": "user",
        },
      );

      debugPrint("SelectPlan: createPlanOrder response → $response");

      if (response == null) {
        setState(() => _isPaymentLoading = false);
        tostmsg("Network error, please try again");
        return;
      }

      if (response['Result'] == true) {
        _razorpayOrderId = response['razorpay_order_id']?.toString();
        _currentPlanId = planId;
        _currentPlanAmount = response['amount']?.toString();

        final title = response['title']?.toString() ?? "Plan Payment";
        final description = response['description']?.toString() ?? "";
        final amount = double.tryParse(_currentPlanAmount ?? '0') ?? 0.0;
        final amountInPaise = (amount * 100).toInt();

        final userName = getdata.read("UserLogin")?["name"]?.toString() ??
            widget.userData['name']?.toString() ??
            "User";
        final userMobile = getdata.read("UserLogin")?["mobile"]?.toString() ??
            widget.userData['mobile']?.toString() ??
            "";

        _razorPayClass.openCheckout(
          key: _razorpayKey,
          amount: amountInPaise.toString(),
          orderId: _razorpayOrderId ?? '',
          name: userName,
          number: userMobile,
          description: description.isNotEmpty ? description : title,
          currency: "INR",
        );
      } else {
        setState(() => _isPaymentLoading = false);
        tostmsg(response['msg']?.toString() ?? "Failed to create order");
      }
    } catch (e) {
      setState(() => _isPaymentLoading = false);
      debugPrint("SelectPlan: createPlanOrder error → $e");
      tostmsg("Something went wrong: $e");
    }
  }

  // ── Razorpay callbacks ───────────────────────────────────────────────────
  void _handlePaymentSuccess(PaymentSuccessResponse response) {
    debugPrint("SelectPlan: payment success → ${response.paymentId}");
    _verifyPlanPayment(
      razorpayPaymentId: response.paymentId ?? "",
      razorpayOrderId: response.orderId ?? _razorpayOrderId ?? "",
      razorpaySignature: response.signature ?? "",
    );
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    setState(() => _isPaymentLoading = false);
    debugPrint("SelectPlan: payment error → ${response.message}");
    if (response.code == 1) {
      tostmsg("Payment cancelled");
    } else {
      tostmsg("Payment failed: ${response.message}");
    }
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    setState(() => _isPaymentLoading = false);
    tostmsg("External wallet selected: ${response.walletName}");
  }

  // ── API: verify payment ──────────────────────────────────────────────────
  Future<void> _verifyPlanPayment({
    required String razorpayPaymentId,
    required String razorpayOrderId,
    required String razorpaySignature,
  }) async {
    final userId = getdata.read("UserLogin")?["id"]?.toString() ??
        getdata.read("Uid")?.toString() ??
        "1";

    final body = {
      "user_id": int.tryParse(userId) ?? 1,
      "plan_id": _currentPlanId ?? 0,
      "type": "user",
      "razorpay_payment_id": razorpayPaymentId,
      "razorpay_order_id": razorpayOrderId,
      "razorpay_signature": razorpaySignature,
    };

    debugPrint("SelectPlan: verifyPayment payload → $body");

    try {
      final response = await ApiWrapper.dataPost(Config.planSuccess, body);
      debugPrint("SelectPlan: verifyPayment response → $response");

      setState(() => _isPaymentLoading = false);

      if (response != null &&
          (response['Result'] == true || response['Result'] == "true")) {
        tostmsg(response['msg']?.toString() ?? "Plan activated successfully!");
        _navigateToNextScreen();
      } else {
        tostmsg(response?['msg']?.toString() ?? "Payment verification failed");
      }
    } catch (e) {
      setState(() => _isPaymentLoading = false);
      debugPrint("SelectPlan: verifyPayment error → $e");
      tostmsg("Verification error: $e");
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  void _navigateToNextScreen() {
    if (widget.ptype == "payment") {
      Get.offAll(() => const Bottombar());
    } else if (widget.ptype == "BuyAnything") {
      // Handle BuyAnything case
    } else {
      Get.off(() => Bottombar());
    }
  }

  // ── Build ────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    notifier = Provider.of<ColorNotifier>(context, listen: true);
    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      body: Stack(
        children: [
          Column(
            children: [
              // ── Header ──────────────────────────────────────────────
              Container(
                color: linercolor,
                padding: EdgeInsets.only(
                  top: MediaQuery.of(context).padding.top + 20,
                  bottom: 30,
                ),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        height: 72,
                        width: 72,
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.15),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.workspace_premium_rounded,
                          size: 40,
                          color: Colors.white,
                        ),
                      ),
                      SizedBox(height: 14),
                      Text(
                        "Choose Your Plan".tr,
                        style: TextStyle(
                          fontSize: 24,
                          color: Colors.white,
                          fontFamily: 'Gilroy_Bold',
                        ),
                      ),
                      SizedBox(height: 6),
                      Text(
                        "Unlock premium benefits with a plan".tr,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.white70,
                          fontFamily: 'Gilroy_Medium',
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // ── Plan List ────────────────────────────────────────────
              Expanded(
                child: _isLoadingPlans
                    ? Center(
                        child: CircularProgressIndicator(color: linercolor))
                    : _plans.isEmpty
                        ? _buildEmptyState()
                        : SingleChildScrollView(
                            padding: EdgeInsets.symmetric(
                                horizontal: 16, vertical: 20),
                            child: Column(
                              children: [
                                ...List.generate(_plans.length, (index) {
                                  return _buildPlanCard(index);
                                }),
                                SizedBox(height: 20),

                                // ── Pay Now Button ─────────────────
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: (_selectedPlanIndex == null ||
                                            _isPaymentLoading)
                                        ? null
                                        : () => _createPlanOrder(
                                            _plans[_selectedPlanIndex!]),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: linercolor,
                                      disabledBackgroundColor:
                                          linercolor.withOpacity(0.4),
                                      padding: EdgeInsets.symmetric(
                                          vertical: 16),
                                      shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(14),
                                      ),
                                    ),
                                    child: Text(
                                      _isPaymentLoading
                                          ? "Processing...".tr
                                          : "Pay Now & Continue".tr,
                                      style: TextStyle(
                                        fontSize: 16,
                                        color: Colors.white,
                                        fontFamily: 'Gilroy_Bold',
                                      ),
                                    ),
                                  ),
                                ),
                                SizedBox(height: 12),

                                // ── Pay Later Button ───────────────
                                TextButton(
                                  onPressed: _isPaymentLoading
                                      ? null
                                      : _navigateToNextScreen,
                                  child: Text(
                                    "Pay Later".tr,
                                    style: TextStyle(
                                      fontSize: 15,
                                      color: greaycolor,
                                      fontFamily: 'Gilroy_Medium',
                                      decoration: TextDecoration.underline,
                                    ),
                                  ),
                                ),
                                SizedBox(height: 20),
                              ],
                            ),
                          ),
              ),
            ],
          ),

          // ── Global loading overlay ─────────────────────────────────
          if (_isPaymentLoading)
            Container(
              color: Colors.black.withOpacity(0.3),
              child: Center(
                child:
                    CircularProgressIndicator(color: linercolor),
              ),
            ),
        ],
      ),
    );
  }

  // ── Plan Card Widget ─────────────────────────────────────────────────────
  Widget _buildPlanCard(int index) {
    final plan = _plans[index];
    final bool isSelected = _selectedPlanIndex == index;

    final String title = plan['title']?.toString() ?? 'Plan';
    final String subtitle = plan['subtitle']?.toString() ?? '';
    final String description = plan['description']?.toString() ?? '';
    final String price = plan['price']?.toString() ?? '0';
    final String discountPrice = plan['discount_price']?.toString() ?? price;

    final List<String> benefits = [
      plan['benefit_1']?.toString() ?? '',
      plan['benefit_2']?.toString() ?? '',
      plan['benefit_3']?.toString() ?? '',
      plan['benefit_4']?.toString() ?? '',
    ].where((b) => b.isNotEmpty).toList();

    final bool hasDiscount = discountPrice != price &&
        double.tryParse(discountPrice) != null &&
        double.tryParse(price) != null &&
        double.parse(discountPrice) < double.parse(price);

    return GestureDetector(
      onTap: () => setState(() => _selectedPlanIndex = index),
      child: AnimatedContainer(
        duration: Duration(milliseconds: 250),
        margin: EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isSelected ? linercolor : notifier.bordecolor,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: isSelected
                  ? linercolor.withOpacity(0.15)
                  : Colors.black.withOpacity(0.04),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title row
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 17,
                            color: notifier.text,
                          ),
                        ),
                        if (subtitle.isNotEmpty) ...[
                          SizedBox(height: 2),
                          Text(
                            subtitle,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 13,
                              color: greaycolor,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Radio indicator
                  AnimatedContainer(
                    duration: Duration(milliseconds: 200),
                    height: 22,
                    width: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isSelected ? linercolor : Colors.transparent,
                      border: Border.all(
                        color: isSelected ? linercolor : greaycolor,
                        width: 2,
                      ),
                    ),
                    child: isSelected
                        ? Icon(Icons.check, color: Colors.white, size: 14)
                        : null,
                  ),
                ],
              ),

              SizedBox(height: 12),

              // Price row
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    "₹$discountPrice",
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 28,
                      color: linercolor,
                    ),
                  ),
                  if (hasDiscount) ...[
                    SizedBox(width: 8),
                    Text(
                      "₹$price",
                      style: TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 16,
                        color: greaycolor,
                        decoration: TextDecoration.lineThrough,
                      ),
                    ),
                    SizedBox(width: 8),
                    Container(
                      padding:
                          EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.green.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        "Save ₹${(double.parse(price) - double.parse(discountPrice)).toStringAsFixed(0)}",
                        style: TextStyle(
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
                SizedBox(height: 4),
                Text(
                  description,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 13,
                    color: greaycolor,
                  ),
                ),
              ],

              // Benefits
              if (benefits.isNotEmpty) ...[
                SizedBox(height: 12),
                Divider(color: notifier.bordecolor),
                SizedBox(height: 8),
                ...benefits.map(
                  (benefit) => Padding(
                    padding: EdgeInsets.only(bottom: 6),
                    child: Row(
                      children: [
                        Icon(Icons.check_circle_rounded,
                            color: Colors.green, size: 16),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            benefit,
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
            ],
          ),
        ),
      ),
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  Widget _buildEmptyState() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.info_outline_rounded, size: 60, color: greaycolor),
        SizedBox(height: 12),
        Text(
          "No plans available".tr,
          style: TextStyle(
            fontFamily: 'Gilroy_Bold',
            fontSize: 16,
            color: notifier.text,
          ),
        ),
        SizedBox(height: 8),
        TextButton(
          onPressed: _navigateToNextScreen,
          child: Text(
            "Continue without a plan".tr,
            style: TextStyle(
              fontFamily: 'Gilroy_Medium',
              color: linercolor,
            ),
          ),
        ),
      ],
    );
  }
}
