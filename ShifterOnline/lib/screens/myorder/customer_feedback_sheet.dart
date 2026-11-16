// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/utils/colors.dart';

class CustomerFeedbackSheet extends StatefulWidget {
  final int orderId;
  final int uid;
  final int riderId;
  final String? driverName;
  final String? driverImage;
  final VoidCallback? onSubmitted;

  const CustomerFeedbackSheet({
    super.key,
    required this.orderId,
    required this.uid,
    required this.riderId,
    this.driverName,
    this.driverImage,
    this.onSubmitted,
  });

  static Future<void> show(
    BuildContext context, {
    required int orderId,
    required int uid,
    required int riderId,
    String? driverName,
    String? driverImage,
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
        onSubmitted: onSubmitted,
      ),
    );
  }

  @override
  State<CustomerFeedbackSheet> createState() => _CustomerFeedbackSheetState();
}

class _CustomerFeedbackSheetState extends State<CustomerFeedbackSheet> {
  int _driverRating = 5;
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
    final tagsToShow = _driverRating <= 3 ? _negativeTags : _positiveTags;
    final displayName = (widget.driverName != null && widget.driverName!.trim().isNotEmpty)
        ? widget.driverName!.trim()
        : "Delivery Partner".tr;

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Handle bar
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Header with Driver info
            Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: const Color(0xFF15803D).withOpacity(0.12),
                  child: const Icon(Icons.person, color: Color(0xFF15803D), size: 28),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "How was your trip?".tr,
                        style: const TextStyle(
                          fontSize: 18,
                          fontFamily: "Gilroy_Bold",
                          color: Color(0xFF15171C),
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        "${"Order".tr} #${widget.orderId} • $displayName",
                        style: TextStyle(
                          fontSize: 13,
                          fontFamily: "Gilroy_Medium",
                          color: greaycolor,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close, color: greaycolor, size: 22),
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // Main Star Rating
            Container(
              padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey.withOpacity(0.15)),
              ),
              child: Column(
                children: [
                  const Text(
                    "Rate Driver & Service",
                    style: TextStyle(
                      fontSize: 14,
                      fontFamily: "Gilroy_Bold",
                      color: Color(0xFF15171C),
                    ),
                  ),
                  const SizedBox(height: 10),
                  RatingBar.builder(
                    initialRating: _driverRating.toDouble(),
                    minRating: 1,
                    direction: Axis.horizontal,
                    allowHalfRating: false,
                    itemCount: 5,
                    itemSize: 34,
                    itemPadding: const EdgeInsets.symmetric(horizontal: 5),
                    itemBuilder: (context, _) => const Icon(
                      Icons.star_rounded,
                      color: Color(0xFFF59E0B),
                    ),
                    onRatingUpdate: (rating) {
                      setState(() {
                        _driverRating = rating.round();
                        _selectedTags.clear();
                      });
                    },
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _getRatingLabel(_driverRating),
                    style: TextStyle(
                      fontSize: 13,
                      fontFamily: "Gilroy_Bold",
                      color: _driverRating <= 2
                          ? Colors.red.shade700
                          : _driverRating == 3
                              ? Colors.amber.shade800
                              : const Color(0xFF15803D),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Detailed Aspects (Delivery speed & Vehicle)
            Row(
              children: [
                Expanded(
                  child: _buildMiniRatingCard(
                    title: "Delivery Speed".tr,
                    currentRating: _deliveryRating,
                    onChanged: (r) => setState(() => _deliveryRating = r),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMiniRatingCard(
                    title: "Vehicle & Care".tr,
                    currentRating: _vehicleRating,
                    onChanged: (r) => setState(() => _vehicleRating = r),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // Quick Tags Section
            const Text(
              "What went well or needs improvement?",
              style: TextStyle(
                fontSize: 13,
                fontFamily: "Gilroy_Bold",
                color: Color(0xFF15171C),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: tagsToShow.map((tag) {
                final isSelected = _selectedTags.contains(tag);
                return ChoiceChip(
                  label: Text(tag.tr),
                  selected: isSelected,
                  selectedColor: _driverRating <= 3
                      ? const Color(0xFFFEE2E2)
                      : const Color(0xFFDCFCE7),
                  backgroundColor: Colors.grey.shade100,
                  labelStyle: TextStyle(
                    fontSize: 12,
                    fontFamily: isSelected ? "Gilroy_Bold" : "Gilroy_Medium",
                    color: isSelected
                        ? (_driverRating <= 3 ? const Color(0xFFB91C1C) : const Color(0xFF15803D))
                        : Colors.grey.shade800,
                  ),
                  side: BorderSide(
                    color: isSelected
                        ? (_driverRating <= 3 ? const Color(0xFFEF4444) : const Color(0xFF22C55E))
                        : Colors.grey.shade300,
                  ),
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

            // Comment Field
            Text(
              "${"Additional Comments".tr} (${"Optional".tr})",
              style: const TextStyle(
                fontSize: 13,
                fontFamily: "Gilroy_Bold",
                color: Color(0xFF15171C),
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _commentController,
              maxLines: 2,
              style: const TextStyle(fontSize: 13, color: Color(0xFF15171C), fontFamily: "Gilroy_Medium"),
              decoration: InputDecoration(
                hintText: "Tell us more about your experience...".tr,
                hintStyle: TextStyle(fontSize: 12.5, color: greaycolor, fontFamily: "Gilroy_Regular"),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: Colors.grey.withOpacity(0.2)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: Colors.grey.withOpacity(0.2)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: Color(0xFF15803D), width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Submit Button
            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed: _submitting ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6B35),
                  disabledBackgroundColor: const Color(0xFFFF6B35),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  elevation: 0,
                ),
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(color: Color(0xFF1A0B04), strokeWidth: 2),
                      )
                    : Text(
                        "Submit Feedback".tr,
                        style: const TextStyle(
                          fontSize: 15,
                          fontFamily: "Gilroy_Bold",
                          color: Color(0xFF1A0B04),
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 6),

            // Skip Button
            Center(
              child: TextButton(
                onPressed: _submitting ? null : () => Navigator.of(context).maybePop(),
                child: Text(
                  "Skip".tr,
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: "Gilroy_Medium",
                    color: greaycolor,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMiniRatingCard({
    required String title,
    required int currentRating,
    required ValueChanged<int> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.withOpacity(0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 11.5,
              fontFamily: "Gilroy_Bold",
              color: Color(0xFF15171C),
            ),
          ),
          const SizedBox(height: 6),
          RatingBar.builder(
            initialRating: currentRating.toDouble(),
            minRating: 1,
            direction: Axis.horizontal,
            allowHalfRating: false,
            itemCount: 5,
            itemSize: 18,
            itemPadding: const EdgeInsets.symmetric(horizontal: 1.5),
            itemBuilder: (context, _) => const Icon(
              Icons.star_rounded,
              color: Color(0xFFF59E0B),
            ),
            onRatingUpdate: (r) => onChanged(r.round()),
          ),
        ],
      ),
    );
  }
}
