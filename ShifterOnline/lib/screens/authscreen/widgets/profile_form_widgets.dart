// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';

// Shared pieces of the customer profile form (used by CompleteProfile).

// ─────────────────────────────────────────────────────────────────────────────
// Design Tokens (Single source of truth for the UI)
// ─────────────────────────────────────────────────────────────────────────────
class AuthTokens {
  // Brand
  static const Color primary = Color(0xFFFA4500);
  static const Color primaryLight = Color(0xFFFF6B35);
  static const Color primaryBg = Color(0xFFFFF4EE);
  static const Color primaryBorder = Color(0xFFFFCDB8);

  // Neutrals
  static const Color textPrimary = Color(0xFF1A1A1A);
  static const Color textSecondary = Color(0xFF777777);
  static const Color textMuted = Color(0xFFAAAAAA);
  static const Color border = Color(0xFFE8E8E8);
  static const Color inputFill = Color(0xFFFAFAFA);

  // Success
  static const Color successBg = Color(0xFFF0FDF4);
  static const Color successBorder = Color(0xFFDCFCE7);
  static const Color successText = Color(0xFF15803D);
  static const Color successIcon = Color(0xFF16A34A);

  // Spacing
  static const double pad = 22.0;
  static const double radius = 16.0;
  static const double radiusSm = 12.0;

  // Shadows
  static List<BoxShadow> get soft => [
        BoxShadow(
          color: Colors.black.withOpacity(0.05),
          blurRadius: 20,
          offset: const Offset(0, 6),
        ),
      ];
  static List<BoxShadow> get cta => [
        BoxShadow(
          color: primary.withOpacity(0.30),
          blurRadius: 16,
          offset: const Offset(0, 6),
        ),
      ];
}

// ─────────────────────────────────────────────────────────────────────────────
// City Model
// ─────────────────────────────────────────────────────────────────────────────
class CityModel {
  final String id;
  final String title;
  CityModel({required this.id, required this.title});
}

class ProfileFormErrors {
  final String? name;
  final String? email;
  final String? city;
  const ProfileFormErrors({this.name, this.email, this.city});
  bool get ok => name == null && email == null && city == null;
}

/// Email is optional; it is only checked when something was typed.
ProfileFormErrors validateProfileForm({
  required String name,
  required String email,
  CityModel? city,
}) {
  final e = email.trim();
  return ProfileFormErrors(
    name: name.trim().isEmpty ? 'Please enter your full name' : null,
    email: e.isNotEmpty && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(e)
        ? 'Enter a valid email address'
        : null,
    city: city == null ? 'Please select your city' : null,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CITY SELECTOR TRIGGER
// ─────────────────────────────────────────────────────────────────────────────
class CitySelector extends StatelessWidget {
  final CityModel? selectedCity;
  final String? error;
  final VoidCallback onTap;

  const CitySelector({
    super.key,
    this.selectedCity,
    this.error,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            decoration: BoxDecoration(
              color: AuthTokens.inputFill,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: error != null ? Colors.red.shade400 : AuthTokens.border,
                width: 1.2,
              ),
            ),
            child: Row(
              children: [
                Icon(Icons.location_city_rounded,
                    size: 20,
                    color: selectedCity != null
                        ? AuthTokens.primary
                        : const Color(0xFF888888)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    selectedCity?.title ?? 'Select your city',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 14.5,
                      color: selectedCity != null
                          ? AuthTokens.textPrimary
                          : const Color(0xFFBBBBBB),
                    ),
                  ),
                ),
                const Icon(Icons.keyboard_arrow_down_rounded,
                    size: 20, color: Color(0xFF888888)),
              ],
            ),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              error!,
              style: TextStyle(
                fontFamily: 'Gilroy_Medium',
                fontSize: 12,
                color: Colors.red.shade500,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERRAL ACCORDION
// ─────────────────────────────────────────────────────────────────────────────
class ReferralAccordion extends StatelessWidget {
  final bool expanded;
  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onToggle;

  const ReferralAccordion({
    super.key,
    required this.expanded,
    required this.controller,
    required this.focusNode,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AuthTokens.inputFill,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AuthTokens.border),
      ),
      child: Column(
        children: [
          GestureDetector(
            onTap: onToggle,
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              child: Row(
                children: [
                  const Icon(Icons.sell_outlined,
                      size: 18, color: AuthTokens.textSecondary),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Have a referral code?',
                      style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 13.5,
                        color: Color(0xFF444444),
                      ),
                    ),
                  ),
                  Icon(
                    expanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: AuthTokens.textSecondary,
                    size: 20,
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
            child: expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AuthTokens.border),
                      ),
                      child: TextField(
                        controller: controller,
                        focusNode: focusNode,
                        textCapitalization: TextCapitalization.characters,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 14,
                          letterSpacing: 1.5,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'ENTER CODE',
                          hintStyle: TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 13,
                            letterSpacing: 0,
                            color: Color(0xFFBBBBBB),
                          ),
                          border: InputBorder.none,
                        ),
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// City Selector Bottom Sheet
// ─────────────────────────────────────────────────────────────────────────────
class CitySheet extends StatefulWidget {
  final List<CityModel> cityList;
  final bool isLoading;
  final ValueChanged<CityModel> onSelect;

  const CitySheet({
    super.key,
    required this.cityList,
    required this.isLoading,
    required this.onSelect,
  });

  @override
  State<CitySheet> createState() => _CitySheetState();
}

class _CitySheetState extends State<CitySheet> {
  final TextEditingController _search = TextEditingController();
  List<CityModel> _filtered = [];

  @override
  void initState() {
    super.initState();
    _filtered = widget.cityList;
    _search.addListener(_onSearch);
  }

  void _onSearch() {
    final q = _search.text.toLowerCase();
    setState(() {
      _filtered = widget.cityList
          .where((c) => c.title.toLowerCase().contains(q))
          .toList();
    });
  }

  @override
  void didUpdateWidget(covariant CitySheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.cityList != widget.cityList) {
      _onSearch();
    }
  }

  @override
  void dispose() {
    _search.removeListener(_onSearch);
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).padding.bottom;
    final keyboardH = MediaQuery.of(context).viewInsets.bottom;

    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: EdgeInsets.only(bottom: keyboardH),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFDDDDDD),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Select your city',
              style: TextStyle(
                color: AuthTokens.textPrimary,
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TextField(
                controller: _search,
                style: const TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 14,
                  color: AuthTokens.textPrimary,
                ),
                decoration: InputDecoration(
                  hintText: 'Search city...',
                  hintStyle: const TextStyle(
                    color: Color(0xFFBBBBBB),
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 14,
                  ),
                  prefixIcon: const Icon(Icons.search_rounded,
                      color: Color(0xFF999999), size: 20),
                  filled: true,
                  fillColor: AuthTokens.inputFill,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(
                        color: AuthTokens.primaryLight, width: 1.5),
                  ),
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (widget.isLoading)
              const Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(color: AuthTokens.primary),
              )
            else if (_filtered.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No cities found',
                  style: TextStyle(
                    color: Color(0xFF888888),
                    fontFamily: 'Gilroy_Medium',
                  ),
                ),
              )
            else
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: (MediaQuery.of(context).size.height * 0.55) -
                      bottomPad -
                      keyboardH,
                ),
                // Own Material so ListTile ink isn't hidden by the white sheet.
                child: Material(
                  type: MaterialType.transparency,
                  child: ListView.separated(
                    shrinkWrap: true,
                    padding: EdgeInsets.fromLTRB(20, 4, 20, bottomPad + 16),
                    itemCount: _filtered.length,
                    separatorBuilder: (_, __) =>
                        const Divider(height: 1, color: Color(0xFFF0F0F0)),
                    itemBuilder: (ctx, idx) {
                      final city = _filtered[idx];
                      return ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 4, vertical: 2),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                        leading: Container(
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            color: AuthTokens.primaryBg,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.location_city_rounded,
                              size: 18, color: AuthTokens.primary),
                        ),
                        title: Text(
                          city.title,
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 15,
                            color: AuthTokens.textPrimary,
                          ),
                        ),
                        trailing: const Icon(Icons.arrow_forward_ios_rounded,
                            size: 13, color: Color(0xFFCCCCCC)),
                        onTap: () {
                          widget.onSelect(city);
                          Navigator.pop(ctx);
                        },
                      );
                    },
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
