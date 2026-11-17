// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/myorder/widgets/trip_complete_widgets.dart';
import 'package:goParcel/theme/app_tokens.dart';

class CustomerFeedbackSheet extends StatefulWidget {
  final int orderId;
  final int uid;
  final int riderId;
  final String? driverName;
  final String? driverImage;
  final String? vehicleName;

  /// Stars already chosen on the trip-complete card (1-5); null = default 5.
  final int? initialRating;
  final VoidCallback? onSubmitted;

  const CustomerFeedbackSheet({
    super.key,
    required this.orderId,
    required this.uid,
    required this.riderId,
    this.driverName,
    this.driverImage,
    this.vehicleName,
    this.initialRating,
    this.onSubmitted,
  });

  static Future<void> show(
    BuildContext context, {
    required int orderId,
    required int uid,
    required int riderId,
    String? driverName,
    String? driverImage,
    String? vehicleName,
    int? initialRating,
    VoidCallback? onSubmitted,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      isDismissible: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => CustomerFeedbackSheet(
        orderId: orderId,
        uid: uid,
        riderId: riderId,
        driverName: driverName,
        driverImage: driverImage,
        vehicleName: vehicleName,
        initialRating: initialRating,
        onSubmitted: onSubmitted,
      ),
    );
  }

  @override
  State<CustomerFeedbackSheet> createState() => _CustomerFeedbackSheetState();
}

class _CustomerFeedbackSheetState extends State<CustomerFeedbackSheet> {
  late int _driverRating;
  int _deliveryRating = 5;
  int _vehicleRating = 5;
  final Set<String> _selectedTags = {};
  final TextEditingController _commentController = TextEditingController();
  bool _submitting = false;

  final List<String> _positiveTags = [
    "Polite & Helpful",
    "On-Time Arrival",
    "Careful with items",
    "Safe Driving",
    "Clean Vehicle",
  ];

  final List<String> _negativeTags = [
    "Delayed Arrival",
    "Demanded Extra Cash",
    "Careless Handling",
    "Rash Driving",
    "Rude Behaviour",
  ];

  @override
  void initState() {
    super.initState();
    final r = widget.initialRating;
    _driverRating = (r != null && r >= 1 && r <= 5) ? r : 5;
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  String _getRatingLabel(int rating) {
    switch (rating) {
      case 1:
        return "Poor".tr;
      case 2:
        return "Below Average".tr;
      case 3:
        return "Average".tr;
      case 4:
        return "Very Good".tr;
      case 5:
      default:
        return "Excellent!".tr;
    }
  }

  Future<void> _submit() async {
    if (_submitting) return;
    setState(() => _submitting = true);

    try {
      final body = {
        "order_id": widget.orderId,
        "uid": widget.uid,
        "rider_id": widget.riderId,
        "driver_rating": _driverRating,
        "delivery_rating": _deliveryRating,
        "vehicle_rating": _vehicleRating,
        "feedback_tags": _selectedTags.join(", "),
        "comment": _commentController.text.trim(),
      };

      final res = await ApiWrapper.dataPostNode(Config.nodeCustomerFeedback, body);
      if (!mounted) return;

      if (res != null && (res['ResponseCode'] == '200' || res['Result'] == 'true')) {
        ApiWrapper.showToastMessage(res['ResponseMsg'] ?? "Thank you for your feedback!".tr);
        widget.onSubmitted?.call();
        if (Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      } else {
        final msg = res?['ResponseMsg'] ?? "Failed to submit feedback. Please try again.".tr;
        ApiWrapper.showToastMessage(msg);
      }
    } catch (e) {
      if (mounted) {
        ApiWrapper.showToastMessage("Something went wrong. Please try again.".tr);
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // The sheet stays light in every theme, as before.
    final p = AppPalette.light;
    final low = _driverRating <= 3;
    final tagsToShow = low ? _negativeTags : _positiveTags;
    final rawName = (widget.driverName ?? "").trim();
    final displayName = rawName.isNotEmpty ? rawName : "Delivery Partner".tr;
    final vehicle = (widget.vehicleName ?? "").trim();
    final initials = nameInitials(rawName);
    final labelColor = _driverRating <= 2 ? p.danger : (_driverRating == 3 ? p.warning : p.successText);

    TextStyle bold(double size, [Color? c]) => TextStyle(fontSize: size, fontFamily: "Gilroy_Bold", color: c ?? p.ink);
    TextStyle medium(double size, [Color? c]) =>
        TextStyle(fontSize: size, fontFamily: "Gilroy_Medium", color: c ?? p.inkSubtle);

    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).padding.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: p.line, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 16),

            // Driver
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
                  child: initials.isEmpty
                      ? Icon(Icons.person_rounded, color: p.brandText, size: 26)
                      : Text(initials, style: bold(17, p.brandText)),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("How was your trip?".tr, style: bold(18)),
                      const SizedBox(height: 3),
                      Text(
                        [displayName, if (vehicle.isNotEmpty) vehicle, "${"Order".tr} #${widget.orderId}"].join(" · "),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: medium(13),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: "Close".tr,
                  icon: Icon(Icons.close_rounded, color: p.inkSubtle, size: 22),
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // Main rating
            Container(
              padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
              decoration: BoxDecoration(
                color: p.canvas,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                children: [
                  Text("Delivery partner".tr, style: bold(14)),
                  const SizedBox(height: 10),
                  RatingBar.builder(
                    initialRating: _driverRating.toDouble(),
                    minRating: 1,
                    direction: Axis.horizontal,
                    allowHalfRating: false,
                    itemCount: 5,
                    itemSize: 36,
                    unratedColor: p.line,
                    itemPadding: const EdgeInsets.symmetric(horizontal: 5),
                    itemBuilder: (context, _) => Icon(Icons.star_rounded, color: p.brand),
                    onRatingUpdate: (rating) {
                      setState(() {
                        _driverRating = rating.round();
                        _selectedTags.clear();
                      });
                    },
                  ),
                  const SizedBox(height: 8),
                  Text(_getRatingLabel(_driverRating), style: bold(13, labelColor)),
                ],
              ),
            ),
            const SizedBox(height: 12),

            Row(
              children: [
                Expanded(
                  child: _buildMiniRatingCard(
                    p,
                    title: "Delivery Speed".tr,
                    currentRating: _deliveryRating,
                    onChanged: (r) => setState(() => _deliveryRating = r),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMiniRatingCard(
                    p,
                    title: "Vehicle & Care".tr,
                    currentRating: _vehicleRating,
                    onChanged: (r) => setState(() => _vehicleRating = r),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),

            Text("What went well or needs improvement?".tr, style: bold(13)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: tagsToShow.map((tag) {
                final isSelected = _selectedTags.contains(tag);
                final accent = low ? p.danger : p.successText;
                return ChoiceChip(
                  label: Text(tag.tr),
                  selected: isSelected,
                  showCheckmark: false,
                  selectedColor: low ? p.dangerTint : p.successTint,
                  backgroundColor: p.surface,
                  labelStyle: TextStyle(
                    fontSize: 12.5,
                    fontFamily: isSelected ? "Gilroy_Bold" : "Gilroy_Medium",
                    color: isSelected ? accent : p.inkMuted,
                  ),
                  shape: StadiumBorder(side: BorderSide(color: isSelected ? accent : p.line)),
                  onSelected: (selected) {
                    setState(() {
                      if (selected) {
                        _selectedTags.add(tag);
                      } else {
                        _selectedTags.remove(tag);
                      }
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 16),

            Text("${"Additional Comments".tr} (${"Optional".tr})", style: bold(13)),
            const SizedBox(height: 6),
            TextField(
              controller: _commentController,
              maxLines: 2,
              style: TextStyle(fontSize: 13.5, color: p.ink, fontFamily: "Gilroy_Medium"),
              decoration: InputDecoration(
                hintText: "Tell us more about your experience...".tr,
                hintStyle: TextStyle(fontSize: 13, color: p.inkSubtle, fontFamily: "Gilroy_Regular"),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                filled: true,
                fillColor: p.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: p.line),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: p.line),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: p.brand, width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Skip | Submit feedback
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 52,
                    child: OutlinedButton(
                      onPressed: _submitting ? null : () => Navigator.of(context).maybePop(),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: p.ink,
                        side: BorderSide(color: p.line),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text("Skip".tr, style: bold(15)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: SizedBox(
                    height: 52,
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: p.brand,
                        disabledBackgroundColor: p.brand.withOpacity(0.5),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        elevation: 0,
                      ),
                      child: _submitting
                          ? SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(color: p.onBrand, strokeWidth: 2),
                            )
                          : Text("Submit Feedback".tr, style: bold(15, p.onBrand)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMiniRatingCard(
    AppPalette p, {
    required String title,
    required int currentRating,
    required ValueChanged<int> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: p.canvas,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(fontSize: 12, fontFamily: "Gilroy_Bold", color: p.ink)),
          const SizedBox(height: 6),
          RatingBar.builder(
            initialRating: currentRating.toDouble(),
            minRating: 1,
            direction: Axis.horizontal,
            allowHalfRating: false,
            itemCount: 5,
            itemSize: 20,
            unratedColor: p.line,
            itemPadding: const EdgeInsets.symmetric(horizontal: 1),
            itemBuilder: (context, _) => Icon(Icons.star_rounded, color: p.brand),
            onRatingUpdate: (r) => onChanged(r.round()),
          ),
        ],
      ),
    );
  }
}
