import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../services/settlement_api_service.dart';
import '../../utils/colors.dart';
import '../../utils/receiver_pay_options.dart';
import 'wallet_page.dart';
import 'widgets/booking_guidelines.dart';
import '../../theme/app_tokens.dart';
import 'widgets/booking_option_widgets.dart';
import '../../theme/widgets/app_top_bar.dart';
import '../../theme/widgets/pressable_scale.dart';
import '../../theme/widgets/app_info_banner.dart';
import '../../utils/booking_guarantee.dart' show guaranteeLine;
import 'widgets/review_widgets.dart';

class ConfirmOrderMap extends StatefulWidget {
  final double startLat;
  final double startLng;
  final double endLat;
  final double endLng;
  final List<Map<String, dynamic>> stops;
  final double deliveryFees;
  final double walletBalance;
  final String currency;
  final String deliveryType;
  final String? dropMobile;
  final Function(int payValue, String paymentTitle, ReceiverPaySelection receiverPay) onConfirmPayment;
  final VoidCallback onViewBreakup;

  // Display only (Porter-style Review): never used for the booking itself.
  final String? vehicleName;
  final String? vehicleImageUrl;
  final String? timeLabel;
  final Map<String, dynamic>? pickupData;
  final Map<String, dynamic>? dropData;
  final double guaranteeAmount;

  const ConfirmOrderMap({
    Key? key,
    required this.startLat,
    required this.startLng,
    required this.endLat,
    required this.endLng,
    this.stops = const [],
    required this.deliveryFees,
    required this.walletBalance,
    required this.currency,
    required this.deliveryType,
    this.dropMobile,
    required this.onConfirmPayment,
    required this.onViewBreakup,
    this.vehicleName,
    this.vehicleImageUrl,
    this.timeLabel,
    this.pickupData,
    this.dropData,
    this.guaranteeAmount = 0,
  }) : super(key: key);

  @override
  State<ConfirmOrderMap> createState() => _ConfirmOrderMapState();
}

class _ConfirmOrderMapState extends State<ConfirmOrderMap> {
  bool _isProcessing = false;
  // Scroll target for the bottom bar's "Pay with …" tap.
  final GlobalKey _paymentKey = GlobalKey();
  int _selectedPaymentMethod = 2; // 1 for Wallet, 2 for COD (Default Cash)

  bool _isLoadingPaymentSettings = true;
  int _paymentCod = 1;
  int _paymentWallet = 1;
  int _paymentOnline = 1;

  // Receiver pays (cash only). Config failure keeps it disabled so booking
  // behaves exactly as before.
  ReceiverPayConfig _receiverConfig = ReceiverPayConfig.disabled;
  bool _receiverPays = false;
  double _receiverPercent = 0;

  // Effective payValue for the selected method: cash 1, wallet -2, else 0.
  int get _effectivePayValue =>
      _selectedPaymentMethod == 2 ? 1 : (_selectedPaymentMethod == 1 ? -2 : 0);

  String? get _receiverReason => receiverPayUnavailableReason(
        config: _receiverConfig,
        payValue: _effectivePayValue,
        dropMobile: widget.dropMobile,
      );

  Future<void> _fetchReceiverPayConfig() async {
    try {
      final cfg = await SettlementApiService.getReceiverPayConfig();
      if (mounted) setState(() => _receiverConfig = cfg);
    } catch (_) {
      // Keep disabled.
    }
  }

  @override
  void initState() {
    super.initState();
    _fetchPaymentStatus();
    _fetchReceiverPayConfig();
    _fetchRestrictedItems();
    _fetchBookingGuidelines();
  }

  // Admin-managed "Important Booking Guidelines" (Booking Guidelines page).
  // Null until loaded / if the call fails, in which case the built-in
  // defaults below are shown so the section is never empty.
  List<String>? _bookingGuidelines;

  Future<void> _fetchBookingGuidelines() async {
    try {
      final response = await ApiWrapper.dataGetNode(Config.nodeBookingGuidelines);
      if (response is Map && (response['Result'] == true || response['Result'] == 'true') && response['data'] is List) {
        final texts = (response['data'] as List)
            .whereType<Map>()
            .map((e) => (e['text'] ?? '').toString().trim())
            .where((t) => t.isNotEmpty)
            .toList();
        if (mounted) setState(() => _bookingGuidelines = texts);
      }
    } catch (_) {
      // Keep the default guideline text.
    }
  }

  // Admin-managed list of items that must not be sent (Restricted Items page).
  List<String> _restrictedItems = [];

  Future<void> _fetchRestrictedItems() async {
    try {
      final response = await ApiWrapper.dataGetNode(Config.nodeRestrictedItems);
      if (response is Map && (response['Result'] == true || response['Result'] == 'true') && response['data'] is List) {
        final names = (response['data'] as List)
            .whereType<Map>()
            .map((e) => (e['name'] ?? '').toString().trim())
            .where((n) => n.isNotEmpty)
            .toList();
        if (mounted) setState(() => _restrictedItems = names);
      }
    } catch (_) {
      // Keep the default guideline text.
    }
  }

  Future<void> _fetchPaymentStatus() async {
    try {
      final response = await ApiWrapper.dataPostNode(Config.nodePaymentStatus, {});
      if (response != null && response is Map<String, dynamic>) {
        if (response["ResponseCode"] == "200" && response["setting"] != null) {
          final setting = response["setting"];
          if (mounted) {
            setState(() {
              _paymentCod = int.tryParse(setting["payment_cod"]?.toString() ?? "1") ?? 1;
              _paymentWallet = int.tryParse(setting["payment_wallet"]?.toString() ?? "1") ?? 1;
              _paymentOnline = int.tryParse(setting["payment_online"]?.toString() ?? "1") ?? 1;

              if (_paymentCod == 1) {
                _selectedPaymentMethod = 2;
              } else if (_paymentWallet == 1) {
                _selectedPaymentMethod = 1;
              } else {
                _selectedPaymentMethod = 0;
              }
              if (_selectedPaymentMethod != 2) {
                _receiverPays = false;
                _receiverPercent = 0;
              }
            });
          }
        }
      }
    } catch (e) {
      debugPrint("Error fetching payment status: $e");
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingPaymentSettings = false;
        });
      }
    }
  }

  void _handleConfirmOrder() {
    if (_isProcessing) return;

    if (_selectedPaymentMethod == 1 && _paymentWallet == 1) {
      if (widget.walletBalance >= widget.deliveryFees) {
        setState(() => _isProcessing = true);
        // Receiver pays is never combined with wallet.
        widget.onConfirmPayment(-2, "Wallet", ReceiverPaySelection.off);
        Future.delayed(const Duration(seconds: 15), () {
          if (mounted) setState(() => _isProcessing = false);
        });
      } else {
        ApiWrapper.showToastMessage("Insufficient wallet balance. Please add money or choose Cash.".tr);
      }
    } else if (_selectedPaymentMethod == 2 && _paymentCod == 1) {
      setState(() => _isProcessing = true);
      final receiverOn = _receiverPays && _receiverReason == null;
      widget.onConfirmPayment(
        1,
        "Cash",
        ReceiverPaySelection(
          enabled: receiverOn,
          percent: receiverOn ? _receiverPercent : 0,
        ),
      );
      Future.delayed(const Duration(seconds: 15), () {
        if (mounted) setState(() => _isProcessing = false);
      });
    } else {
      ApiWrapper.showToastMessage("Please select a valid payment method.".tr);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);
    final p = AppPalette.current;
    final isWalletInsufficient = widget.walletBalance < widget.deliveryFees;
    final receiverOn = _selectedPaymentMethod == 2 && _receiverPays && _receiverReason == null;
    final payLabel = (_selectedPaymentMethod == 1 ? 'Pay with Shifter Wallet' : 'Pay with Cash').tr +
        (receiverOn ? ' · ${'Receiver pays'.tr}' : '');
    final String buttonLabel = (_selectedPaymentMethod == 1 && isWalletInsufficient)
        ? "Add Money to Wallet".tr
        : (widget.vehicleName != null
            ? 'Book @v'.trParams({'v': widget.vehicleName!})
            : "Confirm & Place Order".tr);
    final guarantee = guaranteeLine(widget.guaranteeAmount);
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(
        title: "Review Booking".tr,
        onBack: () => Get.back(),
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                children: [
                  if (widget.vehicleName != null) ...[
                    ReviewVehicleCard(
                      vehicleName: widget.vehicleName!,
                      imageUrl: widget.vehicleImageUrl,
                      timeLabel: widget.timeLabel,
                      onViewAddress: () => showAddressDetailsSheet(
                        context,
                        pickup: widget.pickupData,
                        stops: widget.stops,
                        drop: widget.dropData,
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  // ── PAYMENT METHOD ─────────────────────────────────────────
                  Container(
                    key: _paymentKey,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: p.surface,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                      boxShadow: AppShadow.card,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Select Payment Method",
                          style: TextStyle(
                            fontSize: 15,
                            color: notifier.text,
                            fontFamily: 'Gilroy_Bold',
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (_isLoadingPaymentSettings)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 24),
                            child: Center(
                              child: CircularProgressIndicator(color: linercolor),
                            ),
                          )
                        else if (_paymentWallet == 0 && _paymentCod == 0)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 18),
                            child: Center(
                              child: Text(
                                "No payment methods available right now.",
                                style: TextStyle(
                                  color: greaycolor,
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          )
                        else ...[
                          // 1. Cash On Delivery Option
                          if (_paymentCod == 1)
                            _buildPaymentOptionCard(
                              isSelected: _selectedPaymentMethod == 2,
                              icon: Icons.payments_rounded,
                              title: "Cash on Delivery",
                              subtitle: "Pay cash at pickup / drop location",
                              onTap: () => setState(() => _selectedPaymentMethod = 2),
                              trailing: null,
                            ),

                          if (_paymentCod == 1 && _paymentWallet == 1)
                            const SizedBox(height: 9),

                          // 2. Shifter Wallet Option
                          if (_paymentWallet == 1)
                            _buildPaymentOptionCard(
                              isSelected: _selectedPaymentMethod == 1,
                              icon: Icons.account_balance_wallet_rounded,
                              title: "Shifter Wallet",
                              subtitle: "Available: ${widget.currency}${widget.walletBalance.toStringAsFixed(2)}",
                              onTap: () => setState(() {
                                _selectedPaymentMethod = 1;
                                // Receiver pays is cash only.
                                _receiverPays = false;
                                _receiverPercent = 0;
                              }),
                              trailing: isWalletInsufficient
                                  ? InkWell(
                                      onTap: () => Get.to(() => const WalletPage()),
                                      borderRadius: BorderRadius.circular(14),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4.5),
                                        decoration: BoxDecoration(
                                          color: linercolor.withOpacity(0.12),
                                          borderRadius: BorderRadius.circular(14),
                                          border: Border.all(color: linercolor.withOpacity(0.5)),
                                        ),
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(Icons.add_rounded, color: linercolor, size: 14),
                                            const SizedBox(width: 2),
                                            Text(
                                              "Add Money".tr,
                                              style: TextStyle(
                                                color: linercolor,
                                                fontFamily: 'Gilroy_Bold',
                                                fontSize: 11,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    )
                                  : null,
                            ),
                          if (_receiverConfig.enabled) ...[
                            const SizedBox(height: 9),
                            _buildReceiverPayCard(),
                          ],
                        ],
                      ],
                    ),
                  ),
                  if (guarantee != null) ...[
                    const SizedBox(height: 12),
                    AppInfoBanner(
                      tone: AppBannerTone.success,
                      icon: Icons.verified_user_outlined,
                      text: guarantee.tr,
                    ),
                  ],
                  const SizedBox(height: 12),
                  // ── BOOKING GUIDELINES / IMPORTANT NOTICE ─────────────
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: BookingGuidelines(
                      title: "Important Booking Guidelines".tr,
                      items: [
                        if (_bookingGuidelines == null) ...[
                          (icon: Icons.no_accounts_outlined, text: "Fare does not include loading / unloading labour charges.".tr),
                          (icon: Icons.local_parking_outlined, text: "Toll, state taxes & parking charges to be borne by customer.".tr),
                        ] else
                          for (final guideline in _bookingGuidelines!) (icon: Icons.info_outline_rounded, text: guideline),
                        (
                          icon: Icons.warning_amber_rounded,
                          text: _restrictedItems.isEmpty
                              ? "No toxic, hazardous, illegal, or explosive items permitted.".tr
                              : "${"Restricted items (not allowed):".tr} ${_restrictedItems.join(', ')}",
                        ),
                      ],
                    ),
                  ),
                  Center(
                    child: Text(
                      "By booking, you agree to our Terms of Service & Cancellation Policy",
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        color: greaycolor,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // ── PINNED BAR: pay with · total · View Breakup · Book ────────────
            ReviewBottomBar(
              payLabel: payLabel,
              onPayTap: () {
                final ctx = _paymentKey.currentContext;
                if (ctx != null) {
                  Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
                }
              },
              total: "${widget.currency}${widget.deliveryFees.toStringAsFixed(2)}",
              onViewBreakup: widget.onViewBreakup,
              buttonLabel: buttonLabel,
              processing: _isProcessing,
              onBook: (_isProcessing ||
                      (_paymentWallet == 0 && _paymentCod == 0) ||
                      _selectedPaymentMethod == 0 ||
                      (_selectedPaymentMethod == 1 && isWalletInsufficient))
                  ? (_selectedPaymentMethod == 1 && isWalletInsufficient
                      ? () => Get.to(() => const WalletPage())
                      : null)
                  : _handleConfirmOrder,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReceiverPayCard() {
    Provider.of<ColorNotifier>(context, listen: false);
    final pal = AppPalette.current;
    final reason = _receiverReason;
    final active = _receiverPays && reason == null;
    TextStyle note() => TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12, height: 1.3, color: pal.inkSubtle);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
      decoration: BoxDecoration(
        color: active ? pal.brandTint : pal.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: active ? pal.brand : pal.line, width: active ? 1.5 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: active ? pal.surface : pal.canvas, shape: BoxShape.circle),
                child: Icon(Icons.person_pin_circle_rounded, color: active ? pal.brandText : pal.inkMuted, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Receiver pays".tr,
                      style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14, color: pal.ink),
                    ),
                    if (reason != null) ...[
                      const SizedBox(height: 2),
                      Text(reason.tr, style: note()),
                    ],
                  ],
                ),
              ),
              Switch(
                value: active,
                onChanged: reason != null
                    ? null
                    : (v) => setState(() {
                          _receiverPays = v;
                          if (!v) _receiverPercent = 0;
                        }),
              ),
            ],
          ),
          if (active) ...[
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 6),
                  Text(
                    "Receiver pays the fare at drop. Your advance is refunded to your wallet when they pay.".tr,
                    style: note(),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    "Your commission (added to the receiver's total)".tr,
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 13, color: pal.ink),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: percentChoices(_receiverConfig.maxPercent).map((p) {
                      final label = p == p.roundToDouble() ? "${p.toInt()}%" : "${p.toStringAsFixed(1)}%";
                      return BookingChoicePill(
                        label: label,
                        selected: _receiverPercent == p,
                        onTap: () => setState(() => _receiverPercent = p),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 10),
                  Text("Commission applies whether the receiver pays cash or online.".tr, style: note()),
                  const SizedBox(height: 4),
                  Text("Receiver gets a WhatsApp link to pay (no app needed).".tr, style: note()),
                  const SizedBox(height: 2),
                  Text(
                    "+91 ${normalizeIndianMobile(widget.dropMobile)}",
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 13, color: pal.brandText),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPaymentOptionCard({
    required bool isSelected,
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    Widget? trailing,
  }) {
    final p = AppPalette.current;

    return Semantics(
      selected: isSelected,
      inMutuallyExclusiveGroup: true,
      child: PressableScale(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: isSelected ? p.brand : p.line, width: isSelected ? 1.5 : 1),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: isSelected ? p.surface : p.canvas,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: isSelected ? p.brand : p.inkMuted, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: AppText.caption(p.inkMuted)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (trailing != null) ...[
                trailing,
              ] else
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: p.surface,
                    border: Border.all(color: isSelected ? p.brand : p.line, width: isSelected ? 6 : 2),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
