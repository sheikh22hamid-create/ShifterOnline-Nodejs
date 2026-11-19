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
import 'package:flutter/services.dart' show SystemUiOverlayStyle;
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/widgets/app_buttons.dart';
import 'package:goParcel/theme/widgets/app_sheet.dart';
import 'package:goParcel/theme/widgets/app_skeleton.dart';

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
  String _razorpayKey = Config.razorpayKeyId;

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
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final p = AppPalette.current;
            double discountFromPoints = (usedPoints * pointValue).toDouble();
            double finalAmountToPay = planPrice - discountFromPoints;
            if (finalAmountToPay < 0) finalAmountToPay = 0;

            Widget stepButton(IconData icon, String label, VoidCallback onTap) => Semantics(
                  button: true,
                  label: label,
                  excludeSemantics: true,
                  child: InkResponse(
                    onTap: onTap,
                    radius: 24,
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: p.surface, shape: BoxShape.circle, border: Border.all(color: p.brand)),
                      child: Icon(icon, color: p.brandText, size: 20),
                    ),
                  ),
                );

            return AppSheet(
              padding: EdgeInsets.fromLTRB(20, 8, 20, MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).padding.bottom + 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text("Payment Details".tr, style: AppText.title(p.ink).copyWith(fontSize: 20))),
                      IconButton(
                        tooltip: 'Close'.tr,
                        onPressed: () => Navigator.pop(context),
                        icon: Icon(Icons.close_rounded, color: p.inkMuted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Plan
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: p.canvas, borderRadius: BorderRadius.circular(AppRadius.input)),
                    child: Row(
                      children: [
                        Icon(Icons.workspace_premium_rounded, color: p.brandText, size: 22),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(plan['plan_name']?.toString() ?? 'Plan',
                              style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15)),
                        ),
                        Text("$_currency${planPrice.toStringAsFixed(0)}", style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Points
                  if (pointsAvailable > 0) ...[
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(AppRadius.input)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.stars_rounded, color: p.brandText, size: 18),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text("Available Points: $pointsAvailable".tr,
                                    style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
                              ),
                              Text("(1 Point = $_currency$pointValue)".tr, style: AppText.caption(p.brandText)),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(child: Text("Use Points".tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15))),
                              stepButton(Icons.remove_rounded, 'Use fewer points'.tr, () {
                                if (usedPoints > 0) {
                                  setSheetState(() => usedPoints -= 10);
                                  if (usedPoints < 0) usedPoints = 0;
                                }
                              }),
                              SizedBox(
                                width: 56,
                                child: Text("$usedPoints",
                                    textAlign: TextAlign.center, style: AppText.section(p.ink)),
                              ),
                              stepButton(Icons.add_rounded, 'Use more points'.tr, () {
                                if (usedPoints < maxUsablePoints && finalAmountToPay > 0) {
                                  setSheetState(() => usedPoints += 10);
                                  if (usedPoints > maxUsablePoints) usedPoints = maxUsablePoints;
                                }
                              }),
                            ],
                          ),
                          if (usedPoints > 0) ...[
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                Expanded(child: Text("Points Value".tr, style: AppText.body(p.successText).copyWith(fontSize: 13.5))),
                                Text("- $_currency${discountFromPoints.toStringAsFixed(0)}",
                                    style: AppText.bodyStrong(p.successText).copyWith(fontSize: 14)),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  Divider(color: p.divider, height: 1),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(child: Text("Amount to Pay".tr, style: AppText.section(p.ink))),
                      Text("$_currency${finalAmountToPay.toStringAsFixed(0)}", style: AppText.title(p.ink).copyWith(fontSize: 26)),
                    ],
                  ),
                  const SizedBox(height: 18),
                  AppPrimaryButton(
                    label: finalAmountToPay <= 0 ? "Activate Plan".tr : "Pay $_currency${finalAmountToPay.toStringAsFixed(0)}".tr,
                    onPressed: () {
                      Navigator.pop(context);
                      _purchasePlanWithAmount(plan, finalAmountToPay, usedPoints);
                    },
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

  /// Text under the title on the orange band (same dark brown as Home's header).
  static const Color _onBandSub = Color(0xFF3A1A0B);

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of<ColorNotifier>(context, listen: true);
    final p = AppPalette.current;
    final selected = _selectedPlanIndex == null || _selectedPlanIndex! >= _plans.length ? null : _plans[_selectedPlanIndex!];
    String? selectedPrice;
    if (selected != null) {
      final priceInfo = selected['price_info'] as Map<String, dynamic>? ?? {};
      final purchaseInfo = selected['purchase_info'] as Map<String, dynamic>? ?? {};
      final price = double.tryParse(purchaseInfo['payable_amount']?.toString() ?? priceInfo['price']?.toString() ?? '');
      if (price != null) selectedPrice = '${priceInfo['currency_symbol']?.toString() ?? _currency}${price.toStringAsFixed(0)}';
    }
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: p.canvas,
        // No buy button when every plan is the customer's current one (nothing to choose).
        bottomNavigationBar: !_isLoadingPlans && _plans.any((plan) => plan['is_active'] != true)
            ? Material(
                color: p.surface,
                elevation: 8,
                child: SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                    child: AppPrimaryButton(
                      label: _isPurchasing
                          ? "Processing...".tr
                          : selected == null
                              ? "Choose a plan".tr
                              : "Purchase Plan".tr,
                      trailing: _isPurchasing ? null : selectedPrice,
                      onPressed: (selected == null || _isPurchasing) ? null : () => _showPaymentBottomSheet(selected),
                    ),
                  ),
                ),
              )
            : null,
        body: Stack(
          children: [
            Column(
              children: [
                // ── Orange band ─────────────────────────────────────────────
                Container(
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: p.brand,
                    borderRadius: const BorderRadius.vertical(bottom: Radius.circular(24)),
                  ),
                  padding: EdgeInsets.fromLTRB(16, top + 10, 16, 22),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(
                        button: true,
                        label: 'Back'.tr,
                        excludeSemantics: true,
                        child: InkResponse(
                          onTap: () => Get.back(),
                          radius: 24,
                          child: Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(color: AppPalette.light.surface, shape: BoxShape.circle),
                            child: Icon(Icons.arrow_back_rounded, color: AppPalette.light.ink, size: 22),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text("Premium Plans".tr,
                                    style: AppText.title(p.onBrand).copyWith(fontSize: 27, letterSpacing: -0.4)),
                                const SizedBox(height: 4),
                                Text("Upgrade & Unlock Benefits".tr,
                                    style: AppText.bodyStrong(_onBandSub).copyWith(fontSize: 15)),
                                Text("Choose a plan that suits you best".tr,
                                    style: AppText.body(_onBandSub).copyWith(fontSize: 13.5)),
                              ],
                            ),
                          ),
                          Container(
                            width: 64,
                            height: 64,
                            decoration: BoxDecoration(color: AppPalette.light.surface, shape: BoxShape.circle, boxShadow: AppShadow.card),
                            child: Icon(Icons.workspace_premium_rounded, size: 34, color: p.brand),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                // ── Plans ──────────────────────────────────────────────────
                Expanded(
                  child: _isLoadingPlans
                      ? ListView(padding: const EdgeInsets.all(16), children: const [
                          AppSkeleton(height: 180, radius: 16),
                          SizedBox(height: 12),
                          AppSkeleton(height: 180, radius: 16),
                        ])
                      : _plans.isEmpty
                          ? _buildEmptyState()
                          : ListView(
                              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                              children: [
                                if (_activePlan != null) _buildActivePlanBanner(),
                                const FreeBookingStatusCard(showUpsell: false),
                                ...List.generate(_plans.length, _buildPlanCard),
                              ],
                            ),
                ),
              ],
            ),

            // ── Global loading overlay ─────────────────────────────────────
            if (_isPurchasing)
              Container(
                color: Colors.black.withValues(alpha: 0.3),
                child: Center(child: CircularProgressIndicator(color: p.brand)),
              ),
          ],
        ),
      ),
    );
  }

  // ── Active Plan Banner ─────────────────────────────────────────────────
  Widget _buildActivePlanBanner() {
    final p = AppPalette.current;
    final name = _activePlan!['plan_name']?.toString() ?? 'Active Plan';
    final validity = _activePlan!['validity_label']?.toString() ?? '';
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.successTint,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: p.success.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.verified_rounded, color: p.successText, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("${'Active Plan'.tr}: $name", style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15)),
                if (validity.isNotEmpty) Text(validity, style: AppText.caption(p.inkMuted)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: p.success, borderRadius: BorderRadius.circular(20)),
            child: Text("ACTIVE".tr, style: AppText.caption(AppPalette.light.surface).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 11)),
          ),
        ],
      ),
    );
  }

  // ── Plan Card ──────────────────────────────────────────────────────────
  Widget _buildPlanCard(int index) {
    final p = AppPalette.current;
    final plan = _plans[index];
    final bool isSelected = _selectedPlanIndex == index;

    final String name = plan['plan_name']?.toString() ?? 'Plan';
    final String validityLabel = plan['validity_label']?.toString() ?? '';
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
    final double originalPrice = double.tryParse(priceInfo['price']?.toString() ?? '0') ?? 0;
    final String currencySymbol = priceInfo['currency_symbol']?.toString() ?? _currency;
    final bool hasDiscount = originalPrice > finalPrice;

    final List<String> uiTags = [];
    if (plan['ui_tags'] is List) {
      uiTags.addAll(List<String>.from(plan['ui_tags']));
    }

    final borderColor = isActive ? p.success : (isSelected ? p.brand : p.line);
    return Semantics(
      selected: isSelected,
      button: !isActive,
      child: GestureDetector(
        onTap: () {
          if (!isActive) setState(() => _selectedPlanIndex = index);
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          margin: const EdgeInsets.only(bottom: 14),
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: borderColor, width: (isSelected || isActive) ? 2 : 1),
            boxShadow: AppShadow.card,
          ),
          child: Stack(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: AppText.section(p.ink)),
                              if (validityLabel.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(validityLabel, style: AppText.caption(p.inkMuted).copyWith(fontSize: 12.5)),
                              ],
                            ],
                          ),
                        ),
                        if (isActive)
                          Container(
                            // Below the "Popular" corner tag, never under it.
                            margin: EdgeInsets.only(top: isPopular ? 18 : 0),
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(color: p.successTint, borderRadius: BorderRadius.circular(20)),
                            child: Text("Current".tr,
                                style: AppText.caption(p.successText).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 11.5)),
                          )
                        else
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            height: 24,
                            width: 24,
                            margin: EdgeInsets.only(top: isPopular ? 18 : 0),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isSelected ? p.brand : Colors.transparent,
                              border: Border.all(color: isSelected ? p.brand : p.inkSubtle, width: 2),
                            ),
                            child: isSelected ? Icon(Icons.check_rounded, color: p.onBrand, size: 16) : null,
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        Text("$currencySymbol${finalPrice.toStringAsFixed(0)}",
                            style: AppText.title(p.ink).copyWith(fontSize: 28)),
                        if (hasDiscount) ...[
                          Text(
                            "$currencySymbol${originalPrice.toStringAsFixed(0)}",
                            style: AppText.body(p.inkSubtle).copyWith(fontSize: 15, decoration: TextDecoration.lineThrough),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(color: p.successTint, borderRadius: BorderRadius.circular(6)),
                            child: Text(
                              "${'Save'.tr} $currencySymbol${(originalPrice - finalPrice).toStringAsFixed(0)}",
                              style: AppText.caption(p.successText).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 11.5),
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (description.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(description, style: AppText.body(p.inkMuted).copyWith(fontSize: 13.5, height: 1.35)),
                    ],
                    if (pointsUsable > 0) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(8)),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.stars_rounded, color: p.brandText, size: 15),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                "$pointsUsable ${'Points Applied'.tr} (-$currencySymbol${pointsCoveredAmount.toStringAsFixed(0)})",
                                style: AppText.caption(p.brandText).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 12),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    if (uiTags.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Divider(color: p.divider, height: 1),
                      const SizedBox(height: 12),
                      ...uiTags.map(
                        (tag) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.check_circle_rounded, color: p.success, size: 18),
                              const SizedBox(width: 8),
                              Expanded(child: Text(tag, style: AppText.body(p.ink).copyWith(fontSize: 13.5, height: 1.35))),
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (refNote.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: p.canvas, borderRadius: BorderRadius.circular(10)),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.info_outline_rounded, color: p.inkMuted, size: 16),
                            const SizedBox(width: 8),
                            Expanded(child: Text(refNote, style: AppText.caption(p.inkMuted).copyWith(fontSize: 12.5, height: 1.35))),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (isPopular)
                Positioned(
                  top: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      color: p.brand,
                      borderRadius: const BorderRadius.only(
                        topRight: Radius.circular(AppRadius.card - 2),
                        bottomLeft: Radius.circular(12),
                      ),
                    ),
                    child: Text("Popular".tr, style: AppText.caption(p.onBrand).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 11.5)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Empty State ────────────────────────────────────────────────────────
  Widget _buildEmptyState() {
    final p = AppPalette.current;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
              child: Icon(Icons.workspace_premium_outlined, size: 38, color: p.brandText),
            ),
            const SizedBox(height: 14),
            Text("No plans available".tr, style: AppText.section(p.ink)),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Get.back(),
              child: Text("Go Back".tr, style: AppText.bodyStrong(p.brandText)),
            ),
          ],
        ),
      ),
    );
  }
}
