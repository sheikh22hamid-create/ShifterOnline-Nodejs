import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import '../../Api/Api_wrapper.dart';
import '../../services/settlement_api_service.dart';
import '../../utils/Colors.dart';
import '../../utils/node_socket_manager.dart';
import '../../utils/receiver_pay_options.dart';

class CustomerSettlementSheet extends StatefulWidget {
  final int orderId;
  final int uid;
  final Map<String, dynamic> initialSettlement;
  final VoidCallback onPayOnlinePressed;
  final VoidCallback onSettled;

  const CustomerSettlementSheet({
    super.key,
    required this.orderId,
    required this.uid,
    required this.initialSettlement,
    required this.onPayOnlinePressed,
    required this.onSettled,
  });

  @override
  State<CustomerSettlementSheet> createState() => _CustomerSettlementSheetState();
}

class _CustomerSettlementSheetState extends State<CustomerSettlementSheet> {
  late Map<String, dynamic> _settlement;
  bool _choosingDriver = false;
  bool _choseDriver = false;
  bool _takingOver = false;
  bool _resending = false;
  String? _errorMessage;
  NodeSocketSubscription? _socketSub;
  Timer? _pollTimer;
  Timer? _autoCloseTimer;

  @override
  void initState() {
    super.initState();
    _settlement = Map<String, dynamic>.from(widget.initialSettlement);
    _choseDriver = _settlement['customer_choice'] == 'driver';
    _setupSocketListener();
    _startPollTimerIfNeeded();
  }

  @override
  void dispose() {
    _socketSub?.dispose();
    _pollTimer?.cancel();
    _autoCloseTimer?.cancel();
    super.dispose();
  }

  void _setupSocketListener() {
    _socketSub = NodeSocketManager.instance.addListeners(
      onSettlementUpdated: (data) {
        if (!mounted) return;
        final oId = data['order_id']?.toString();
        if (oId == widget.orderId.toString()) {
          debugPrint("⚡ [CustomerSettlementSheet] socket settlement:updated: $data");
          updateSettlement(Map<String, dynamic>.from(data));
        }
      },
    );
  }

  void _startPollTimerIfNeeded() {
    final status = _settlement['status']?.toString();
    // Receiver mode (payer == 'receiver' && status == 'pending') is covered by
    // the 'pending' check; the explicit helper keeps that intent visible.
    if (status == 'pending' || status == 'customer_owes' || _choseDriver || isReceiverPaying(_settlement)) {
      if (_pollTimer == null || !_pollTimer!.isActive) {
        _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
          if (!mounted) return;
          final res = await SettlementApiService.getState(
            uid: widget.uid,
            orderId: widget.orderId,
          );
          if (!mounted) return;
          if (res['Result'] == 'true' || res['Result'] == true) {
            final s = res['settlement'];
            if (s is Map) {
              final latestStatus = s['status']?.toString();
              if (latestStatus != _settlement['status'] ||
                  s['customer_choice'] != _settlement['customer_choice'] ||
                  (s['payer'] ?? 'customer').toString() != (_settlement['payer'] ?? 'customer').toString()) {
                debugPrint("⚡ [CustomerSettlementSheet] poll detected state change: $latestStatus");
                updateSettlement(Map<String, dynamic>.from(s));
              }
            }
          }
        });
      }
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
  }

  void updateSettlement(Map<String, dynamic> updated) {
    if (!mounted) return;
    setState(() {
      _settlement = Map<String, dynamic>.from(updated);
      _choseDriver = _settlement['customer_choice'] == 'driver';
    });
    final status = _settlement['status']?.toString();
    if (status == 'cash_received' || status == 'paid_online' || status == 'waived') {
      _pollTimer?.cancel();
      _pollTimer = null;
      widget.onSettled();
      // Automatically close after 2.5 seconds so user sees confirmation card
      _autoCloseTimer?.cancel();
      _autoCloseTimer = Timer(const Duration(milliseconds: 2500), () {
        if (mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      });
    }
  }

  Future<void> _handleChooseDriver() async {
    setState(() {
      _choosingDriver = true;
      _errorMessage = null;
    });

    final res = await SettlementApiService.chooseDriver(
      uid: widget.uid,
      orderId: widget.orderId,
    );

    if (!mounted) return;
    setState(() => _choosingDriver = false);

    if (res['Result'] == 'true' || res['Result'] == true) {
      setState(() {
        _choseDriver = true;
        if (res['settlement'] is Map) {
          _settlement = Map<String, dynamic>.from(res['settlement']);
        }
      });
      _startPollTimerIfNeeded();
    } else {
      final code = res['code']?.toString();
      final msg = SettlementApiService.friendlyErrorMessage(code, res['ResponseMsg']?.toString());
      setState(() => _errorMessage = msg);
    }
  }

  Future<void> _handleTakeOver() async {
    if (_takingOver || _resending) return;
    setState(() {
      _takingOver = true;
      _errorMessage = null;
    });
    final res = await SettlementApiService.takeOver(
      uid: widget.uid,
      orderId: widget.orderId,
    );
    if (!mounted) return;
    final ok = res['Result'] == 'true' || res['Result'] == true;
    setState(() {
      _takingOver = false;
      if (ok && res['settlement'] is Map) {
        final fresh = Map<String, dynamic>.from(res['settlement'] as Map);
        // After a successful take-over the payer is the customer, even if the
        // response omits `payer` (never keep a stale 'receiver' from the old map).
        fresh['payer'] = (fresh['payer'] ?? 'customer');
        _settlement = {..._settlement, ...fresh};
      } else if (ok) {
        _settlement = {..._settlement, 'payer': 'customer'};
      } else {
        _errorMessage = SettlementApiService.friendlyErrorMessage(
            res['code']?.toString(), res['ResponseMsg']?.toString());
      }
    });
    if (ok) {
      final mergedStatus = _settlement['status']?.toString() ?? 'pending';
      if (mergedStatus != 'pending') {
        // The advance covered the whole amount: the backend settled the order
        // during the take-over, so run the normal settled handling
        // (onSettled + auto-close) instead of waiting on the poll timer.
        updateSettlement(_settlement);
        ApiWrapper.showToastMessage("Payment complete".tr);
        return;
      }
      _startPollTimerIfNeeded();
      ApiWrapper.showToastMessage("You are now paying for this order".tr);
    }
  }

  bool _confirmingTakeOver = false;

  Future<void> _confirmTakeOver() async {
    if (_takingOver || _resending || _confirmingTakeOver) return;
    _confirmingTakeOver = true;
    bool? confirmed;
    try {
      confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text("I'll pay myself".tr,
              style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15)),
          content: Text(
              "You will pay for this order instead of the receiver. The receiver's link will stop working and you will lose the service fee."
                  .tr,
              style: const TextStyle(fontFamily: "Gilroy_Medium", fontSize: 13)),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text("Cancel".tr),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text("I'll pay myself".tr),
            ),
          ],
        ),
      );
    } finally {
      _confirmingTakeOver = false;
    }
    if (confirmed == true && mounted) {
      await _handleTakeOver();
    }
  }

  Future<void> _handleResend() async {
    if (_resending || _takingOver) return;
    setState(() {
      _resending = true;
      _errorMessage = null;
    });
    final res = await SettlementApiService.resendLink(
      uid: widget.uid,
      orderId: widget.orderId,
    );
    if (!mounted) return;
    setState(() => _resending = false);
    final ok = res['Result'] == 'true' || res['Result'] == true;
    if (!ok) {
      setState(() {
        _errorMessage = SettlementApiService.friendlyErrorMessage(
            res['code']?.toString(), res['ResponseMsg']?.toString());
      });
      return;
    }
    final sent = res['sent'] == true || res['sent'] == 'true';
    final link = res['link']?.toString() ?? '';
    if (sent) {
      ApiWrapper.showToastMessage("Payment link sent to the receiver".tr);
      return;
    }
    if (link.isEmpty) {
      ApiWrapper.showToastMessage(SettlementApiService.friendlyErrorMessage(
          'NOT_CONFIGURED', res['ResponseMsg']?.toString()));
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text("Share this link with the receiver".tr,
            style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15)),
        content: SelectableText(link,
            style: const TextStyle(fontFamily: "Gilroy_Medium", fontSize: 13)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text("Close".tr),
          ),
          TextButton(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: link));
              if (ctx.mounted) Navigator.of(ctx).pop();
              ApiWrapper.showToastMessage("Link copied".tr);
            },
            child: Text("Copy link".tr),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = _settlement['status']?.toString() ?? 'pending';
    // isReceiverPaying() is true only for payer == 'receiver' && status == 'pending';
    // a map without `payer` (legacy / old socket payload) is a normal customer settlement.
    final isReceiverMode = isReceiverPaying(_settlement);
    final markup = receiverMarkup(_settlement);
    final amountDue = isReceiverMode
        ? receiverPayTotal(_settlement)
        : (double.tryParse(_settlement['amount_due']?.toString() ?? '0') ?? 0.0);
    final fare = double.tryParse(_settlement['fare']?.toString() ?? '0') ?? amountDue;
    final isCustomerOwes = status == 'customer_owes';
    final isSettled = status == 'cash_received' || status == 'paid_online';
    final isDisputed = status == 'disputed';

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Drag Handle
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Title Header
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: linercolor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(Icons.payment_rounded, color: linercolor, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Trip Payment Settlement".tr,
                          style: const TextStyle(
                            fontFamily: "Gilroy_Bold",
                            fontSize: 17,
                            color: Colors.black87,
                          ),
                        ),
                        Text(
                          "Order #${widget.orderId}".tr,
                          style: TextStyle(
                            fontFamily: "Gilroy_Medium",
                            fontSize: 12.5,
                            color: Colors.grey.shade600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 20, color: Colors.grey),
                    onPressed: () => Get.back(),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Amount Due Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [linercolor.withOpacity(0.14), linercolor.withOpacity(0.04)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: linercolor.withOpacity(0.3)),
                ),
                child: Column(
                  children: [
                    Text(
                      isReceiverMode
                          ? "Receiver pays total".tr
                          : isCustomerOwes ? "Payment Due (Order Completed)".tr : "Amount Due".tr,
                      style: TextStyle(
                        fontFamily: "Gilroy_Medium",
                        fontSize: 13,
                        color: Colors.grey.shade700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "₹${amountDue.toStringAsFixed(2)}",
                      style: TextStyle(
                        fontFamily: "Gilroy_Bold",
                        fontSize: 32,
                        color: linercolor,
                      ),
                    ),
                    if (isReceiverMode && markup > 0)
                      Text(
                        "${"Includes your".tr} ₹${markup.toStringAsFixed(2)} ${"service fee".tr} ${"(if paid online)".tr}",
                        style: TextStyle(
                          fontFamily: "Gilroy_Medium",
                          fontSize: 12,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    if (!isReceiverMode && fare > amountDue)
                      Text(
                        "${"Total trip fare:".tr} ₹${fare.toStringAsFixed(2)}",
                        style: TextStyle(
                          fontFamily: "Gilroy_Medium",
                          fontSize: 12,
                          color: Colors.grey.shade600,
                        ),
                      ),
                  ],
                ),
              ),

              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: TextStyle(
                      fontFamily: "Gilroy_Medium",
                      fontSize: 12,
                      color: Colors.red.shade800,
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 20),

              // Settled State
              if (isSettled) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F8EE),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFF00C853).withOpacity(0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 28),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              status == 'cash_received'
                                  ? (_settlement['confirmed_by']?.toString() == 'system'
                                      ? "Payment complete".tr
                                      : "Driver confirmed ₹${amountDue.toStringAsFixed(0)} cash receipt!".tr)
                                  : "Online payment confirmed!".tr,
                              style: const TextStyle(
                                fontFamily: "Gilroy_Bold",
                                fontSize: 14,
                                color: Color(0xFF007E33),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              "Trip payment has been settled successfully.".tr,
                              style: TextStyle(
                                fontFamily: "Gilroy_Medium",
                                fontSize: 12,
                                color: Colors.grey.shade700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                ElevatedButton(
                  onPressed: () => Get.back(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF00C853),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: Text(
                    "Done".tr,
                    style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15, color: Colors.white),
                  ),
                ),
              ] else if (isDisputed) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.orange.shade50,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.orange.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.report_problem_rounded, color: Colors.orange.shade800, size: 26),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          "This trip payment is currently under review by our support team.".tr,
                          style: TextStyle(
                            fontFamily: "Gilroy_Medium",
                            fontSize: 13,
                            color: Colors.orange.shade900,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                ElevatedButton(
                  onPressed: () => Get.back(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: linercolor,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: Text("Close".tr, style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15, color: Colors.white)),
                ),
              ] else if (isReceiverMode) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.blue.shade100),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.hourglass_top_rounded, color: Colors.blue.shade800, size: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          "Receiver is paying".tr,
                          style: TextStyle(
                            fontFamily: "Gilroy_Bold",
                            fontSize: 14,
                            color: Colors.blue.shade900,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                ElevatedButton(
                  onPressed: (_takingOver || _resending) ? null : _confirmTakeOver,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: linercolor,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _takingOver
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text("I'll pay myself".tr,
                          style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15, color: Colors.white)),
                ),
                const SizedBox(height: 10),
                OutlinedButton(
                  onPressed: (_takingOver || _resending) ? null : _handleResend,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: BorderSide(color: linercolor),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _resending
                      ? SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: linercolor),
                        )
                      : Text("Resend payment link".tr,
                          style: TextStyle(fontFamily: "Gilroy_Bold", fontSize: 14.5, color: linercolor)),
                ),
              ] else ...[
                // Payment Method Options
                Text(
                  isCustomerOwes
                      ? "Complete Payment Online".tr
                      : "Choose How to Pay".tr,
                  style: const TextStyle(
                    fontFamily: "Gilroy_Bold",
                    fontSize: 14.5,
                    color: Colors.black87,
                  ),
                ),
                const SizedBox(height: 10),

                // Option 1: Pay Driver Directly (only if not customer_owes)
                if (!isCustomerOwes) ...[
                  InkWell(
                    onTap: _choosingDriver ? null : _handleChooseDriver,
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: _choseDriver ? const Color(0xFFF1F8E9) : Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: _choseDriver ? const Color(0xFF7CB342) : Colors.grey.shade200,
                          width: _choseDriver ? 1.5 : 1.0,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.green.shade50,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.handshake_rounded, color: Color(0xFF2E7D32), size: 20),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      "Pay driver directly (cash/UPI)".tr,
                                      style: const TextStyle(
                                        fontFamily: "Gilroy_Bold",
                                        fontSize: 14,
                                        color: Colors.black87,
                                      ),
                                    ),
                                    Text(
                                      "Give cash or scan driver's UPI QR".tr,
                                      style: TextStyle(
                                        fontFamily: "Gilroy_Medium",
                                        fontSize: 11.5,
                                        color: Colors.grey.shade600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (_choosingDriver)
                                const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              else if (_choseDriver)
                                const Icon(Icons.check_circle_rounded, color: Color(0xFF2E7D32), size: 22),
                            ],
                          ),
                          if (_choseDriver) ...[
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(
                                children: [
                                  const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF2E7D32)),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      "Give ₹${amountDue.toStringAsFixed(0)} to your driver - they will confirm in their app".tr,
                                      style: const TextStyle(
                                        fontFamily: "Gilroy_Medium",
                                        fontSize: 12,
                                        color: Color(0xFF2E7D32),
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
                  ),
                  const SizedBox(height: 12),
                ],

                // Option 2: Pay Online (Razorpay)
                InkWell(
                  onTap: widget.onPayOnlinePressed,
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade50,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: linercolor.withOpacity(0.4)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: linercolor.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(Icons.credit_card_rounded, color: linercolor, size: 20),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "Pay online (UPI / Cards / Netbanking)".tr,
                                style: const TextStyle(
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 14,
                                  color: Colors.black87,
                                ),
                              ),
                              Text(
                                "Fast & secure digital settlement via Razorpay".tr,
                                style: TextStyle(
                                  fontFamily: "Gilroy_Medium",
                                  fontSize: 11.5,
                                  color: Colors.grey.shade600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(Icons.arrow_forward_ios_rounded, size: 14, color: linercolor),
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
}
