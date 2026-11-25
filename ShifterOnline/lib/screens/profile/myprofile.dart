// ignore_for_file: deprecated_member_use

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemUiOverlayStyle;
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../Language/language_screen.dart';
import '../../controllers/page_list_api_controller.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../../utils/delete_and_logout_bottomsheet.dart';
import '../../utils/node_socket_manager.dart';
import '../authscreen/signin.dart';
import '../loream.dart';
import '../notification/notification.dart';
import 'editprofile.dart';
import 'AddressList.dart';
import 'faq.dart';
import 'blocked_drivers.dart';
import 'favorite_drivers.dart';
import 'premium_plans_screen.dart';
import 'LeadReferralScreen.dart';
import '../home/referral_points_screen.dart';
import '../../utils/Calculation.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_group_card.dart';

class MyProfile extends StatefulWidget {
  const MyProfile({super.key});

  @override
  State<MyProfile> createState() => _MyProfileState();
}

class _MyProfileState extends State<MyProfile> {
  final getdata = GetStorage();
  late ColorNotifier notifier;

  PackageInfo? packageInfo;
  String? appName;
  String? packageName;
  String? appVersion;

  Map<String, dynamic>? overviewData;
  bool isLoadingOverview = false;
  String customerCareNumber = "+91 9999908008";
  String customerCareHours = "24/7 Helpline";

  final PageListApiController pageListApiController = Get.put(PageListApiController());

  @override
  void initState() {
    super.initState();
    getPackage();
    fetchProfileOverview();
    fetchCustomerCare();
  }

  Future<void> fetchCustomerCare() async {
    try {
      final res = await ApiWrapper.dataPostNode(Config.nodeCustomerCare, {});
      if (res != null && (res["Result"] == "true" || res["Result"] == true)) {
        if (mounted) {
          setState(() {
            final num = (res["customer_care_number"] ?? "").toString().trim();
            if (num.isNotEmpty) customerCareNumber = num;
            final hrs = (res["customer_care_hours"] ?? "").toString().trim();
            if (hrs.isNotEmpty) customerCareHours = hrs;
          });
        }
      }
    } catch (_) {}
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Refresh dynamic data when returning from sub-screens (e.g. Edit Profile)
    fetchProfileOverview();
  }

  Future<void> getPackage() async {
    try {
      packageInfo = await PackageInfo.fromPlatform();
      appName = packageInfo?.appName;
      packageName = packageInfo?.packageName;
      appVersion = packageInfo?.version;
      if (mounted) setState(() {});
    } catch (_) {}
  }

  Future<void> fetchProfileOverview() async {
    final uid = getdata.read("Uid") ?? getdata.read("UserLogin")?["id"];
    if (uid == null) return;

    if (overviewData == null) {
      isLoadingOverview = true;
    }

    try {
      final res = await ApiWrapper.dataPostNode(
        Config.nodeProfileOverview,
        {"uid": uid},
      );

      if (res != null && res["Result"] == "true" && res["data"] != null) {
        if (mounted) {
          setState(() {
            overviewData = Map<String, dynamic>.from(res["data"]);
            isLoadingOverview = false;

            // Sync fresh user data back into GetStorage so editprofile & other screens stay fresh
            if (overviewData?["user"] != null) {
              final freshUser = Map<String, dynamic>.from(overviewData!["user"]);
              final existing = getdata.read("UserLogin");
              if (existing is Map) {
                freshUser.addAll(
                  Map<String, dynamic>.from(existing)
                    ..removeWhere((k, v) => freshUser.containsKey(k)),
                );
              }
              save("UserLogin", freshUser);
            }
          });
        }
        return;
      }
    } catch (e) {
      debugPrint("fetchProfileOverview error: $e");
    }

    if (mounted) {
      setState(() => isLoadingOverview = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);

    final userLogin = getdata.read("UserLogin");
    final dynamicUser = overviewData?["user"] ?? userLogin ?? {};

    final String name = (dynamicUser["name"] ?? "User").toString();
    final String ccode = (dynamicUser["ccode"] ?? "+91").toString();
    final String mobile = (dynamicUser["mobile"] ?? "").toString();
    final String rImg = (dynamicUser["r_img"] ?? "").toString();
    final String tagline = (dynamicUser["tagline"] ??
            "Let's move a smarter, cleaner and more connected city.")
        .toString();

    // Profile Completion Data - dynamically computed from real-time user profile data
    final String email = (dynamicUser["email"] ?? "").toString().trim();
    final bool hasName = name.isNotEmpty && name.toLowerCase() != "user";
    final bool hasMobile = mobile.isNotEmpty;
    final bool hasEmail = email.isNotEmpty && email.contains("@") && !email.contains("@placeholder");
    final bool hasImage = Config.isValidImageUrl(rImg);
    final bool hasAddress = overviewData != null && overviewData?["profile_completion"] != null
        ? ((overviewData?["profile_completion"]?["missing_fields"] as List?)?.contains("saved_address") == false)
        : false;

    int computedPercent = 0;
    if (hasMobile) computedPercent += 20;
    if (hasName) computedPercent += 20;
    if (hasEmail) computedPercent += 20;
    if (hasImage) computedPercent += 20;
    if (hasAddress) computedPercent += 20;

    final completionData = overviewData?["profile_completion"] ?? {};
    final int completionPercent = overviewData != null && completionData["percentage"] != null
        ? (int.tryParse(completionData["percentage"]?.toString() ?? "") ?? computedPercent)
        : computedPercent;

    String completionTitle = "Complete your profile";
    String completionPrompt = "Add your email and details for a better experience.";
    if (completionPercent >= 100) {
      completionTitle = "Profile 100% Completed!";
      completionPrompt = "All details & addresses are verified and up to date.";
    } else if (!hasName) {
      completionPrompt = "Add your full name to personalize your account.";
    } else if (!hasEmail) {
      completionPrompt = "Add your email to receive booking receipts & trip invoices.";
    } else if (!hasImage) {
      completionPrompt = "Upload a profile photo to personalize your account.";
    } else if (!hasAddress) {
      completionPrompt = "Save your home or work address for 1-tap fast booking.";
    }

    // Quick Access Data
    final quickAccess = overviewData?["quick_access"] ?? {};
    final premiumData = quickAccess["premium"] ?? {};
    final favDriversData = quickAccess["favorite_drivers"] ?? {};

    // Notification Data
    final notifData = overviewData?["notifications"] ?? {};
    final bool hasUnreadNotif = (notifData["has_unread"] == true) ||
        ((int.tryParse(notifData["unread_count"]?.toString() ?? "0") ?? 0) > 0);

    final p = AppPalette.current;
    return Scaffold(
      backgroundColor: p.canvas,
      body: RefreshIndicator(
        onRefresh: fetchProfileOverview,
        color: p.brand,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).padding.bottom + 85),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── 1. Orange band (same look as Home) ─────────────────────────────
              _buildOrangeHeader(hasUnreadNotif: hasUnreadNotif),

              // Everything below overlaps the band a little, like Home's pickup card.
              Transform.translate(
                offset: const Offset(0, -_overlap),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // ── 2. Identity + profile completion ──────────────────────
                      _buildIdentityCard(
                        name: name,
                        ccode: ccode,
                        mobile: mobile,
                        rImg: rImg,
                        tagline: tagline,
                        completionTitle: completionTitle,
                        completionPrompt: completionPrompt,
                        completionPercent: completionPercent,
                      ),
                      const SizedBox(height: 14),

                      // ── 3. Quick actions (Porter-style tiles) ─────────────────
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: _quickTile(
                              icon: Icons.location_on_rounded,
                              label: 'Saved Addresses'.tr,
                              color: p.brandText,
                              tint: p.brandTint,
                              onTap: () => Get.to(() => const AddressListPage()),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _quickTile(
                              icon: Icons.card_giftcard_rounded,
                              label: 'Refer & Earn'.tr,
                              color: p.successText,
                              tint: p.successTint,
                              onTap: referAndEarn,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _quickTile(
                              icon: Icons.headset_mic_rounded,
                              label: 'Help'.tr,
                              color: p.warning,
                              tint: p.warningTint,
                              onTap: _callCustomerCare,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),

                      // ── 4. Grouped rows (every row = an existing screen / handler) ──
                      AppGroupCard(title: 'Benefits'.tr, children: [
                        AppMenuRow(
                          icon: Icons.workspace_premium_rounded,
                          title: (premiumData["title"]?.toString() ?? "Shifter Premium").tr,
                          subtitle: (premiumData["subtitle"]?.toString() ??
                                  "Save more on every booking\nFaster • Better • More rewards")
                              .replaceAll('\n', ' · '),
                          onTap: () => Get.to(() => const PremiumPlansScreen()),
                        ),
                        AppMenuRow(
                          icon: Icons.toll_outlined,
                          title: 'Reward Points'.tr,
                          subtitle: 'Your points and how to use them'.tr,
                          onTap: () => Get.to(() => const ReferralPointsScreen()),
                        ),
                      ]),
                      const SizedBox(height: 14),
                      AppGroupCard(title: 'Refer'.tr, children: [
                        AppMenuRow(
                          icon: Icons.business_center_outlined,
                          title: 'Refer business leads'.tr,
                          subtitle: 'Know a business that ships? Earn for every lead'.tr,
                          onTap: () => Get.to(() => const LeadReferralScreen()),
                        ),
                        AppMenuRow(
                          icon: Icons.share_rounded,
                          title: 'Share Shifter Online'.tr,
                          subtitle: 'Help us grow, share with your friends'.tr,
                          onTap: share,
                        ),
                      ]),
                      const SizedBox(height: 14),
                      AppGroupCard(title: 'Drivers'.tr, children: [
                        AppMenuRow(
                          icon: Icons.favorite_rounded,
                          title: (favDriversData["title"]?.toString() ?? "Favorite Drivers").tr,
                          subtitle: (favDriversData["subtitle"]?.toString() ?? "Quickly book your preferred drivers")
                              .replaceAll('\n', ' '),
                          onTap: () => Get.to(() => const FavoriteDriversScreen()),
                        ),
                        AppMenuRow(
                          icon: Icons.block_rounded,
                          title: 'Blocked Drivers'.tr,
                          subtitle: 'Drivers you blocked. Unblock them anytime'.tr,
                          onTap: () => Get.to(() => const BlockedDriversScreen()),
                        ),
                      ]),
                      const SizedBox(height: 14),
                      AppGroupCard(title: 'Preferences'.tr, children: [
                        AppMenuRow(
                          icon: Icons.translate_rounded,
                          title: 'Language'.tr,
                          onTap: () => Get.to(() => const LanguageScreen()),
                        ),
                        AppMenuRow(
                          icon: notifier.isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                          title: 'Dark Mode'.tr,
                          trailing: Switch(value: notifier.isDark, activeColor: p.brand, onChanged: _setDarkMode),
                          onTap: () => _setDarkMode(!notifier.isDark),
                        ),
                      ]),
                      const SizedBox(height: 14),
                      AppGroupCard(title: 'Help & Support'.tr, children: [
                        AppMenuRow(
                          icon: Icons.headset_mic_rounded,
                          title: 'Customer Care'.tr,
                          subtitle: "Call $customerCareNumber • $customerCareHours",
                          onTap: () => _callCustomerCare(),
                        ),
                        AppMenuRow(
                          icon: Icons.question_mark_rounded,
                          title: 'FAQ'.tr,
                          subtitle: 'Find answers to common questions'.tr,
                          onTap: () => Get.to(() => Faq()),
                        ),
                        AppMenuRow(
                          icon: Icons.verified_user_rounded,
                          title: 'Privacy Policy'.tr,
                          subtitle: 'How we protect your data'.tr,
                          onTap: () => _openLegalPage("Privacy Policy"),
                        ),
                        AppMenuRow(
                          icon: Icons.description_rounded,
                          title: 'Terms of Use'.tr,
                          subtitle: 'Rules and guidelines for using Shifter Online'.tr,
                          onTap: () => _openLegalPage("Terms of Use"),
                        ),
                      ]),
                      const SizedBox(height: 14),

                      // ── 5. Account actions ───────────────────────────────────
                      AppGroupCard(children: [
                        AppMenuRow(
                          icon: Icons.logout_rounded,
                          title: 'Log out'.tr,
                          subtitle: "You'll need to verify your phone again to sign in".tr,
                          onTap: _handleLogout,
                        ),
                        AppMenuRow(
                          icon: Icons.delete_outline_rounded,
                          title: 'Delete Account'.tr,
                          danger: true,
                          onTap: _askDeleteAccount,
                        ),
                      ]),
                      const SizedBox(height: 20),
                      Center(
                        child: Column(
                          children: [
                            Text('Shifter Online', style: AppText.bodyStrong(p.inkSubtle).copyWith(fontSize: 13)),
                            const SizedBox(height: 2),
                            Text("${'Version'.tr} ${appVersion ?? '1.0.0'}", style: AppText.caption(p.inkSubtle)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Orange Header
  // ─────────────────────────────────────────────────────────────────────────────
  /// How far the cards below overlap the orange band.
  static const double _overlap = 44;

  /// Text under the title on the orange band (same dark brown as Home's header).
  static const Color _onBandSub = Color(0xFF3A1A0B);

  Widget _bandButton({required IconData icon, required String label, required VoidCallback onTap, bool dot = false}) {
    final p = AppPalette.light;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        radius: 24,
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(color: p.surface, shape: BoxShape.circle, boxShadow: AppShadow.card),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(icon, color: p.ink, size: 22),
              if (dot)
                Positioned(
                  top: 10,
                  right: 11,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: p.danger,
                      shape: BoxShape.circle,
                      border: Border.all(color: p.surface, width: 1.5),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOrangeHeader({required bool hasUnreadNotif}) {
    final p = AppPalette.current;
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: p.brand,
          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(24)),
        ),
        padding: EdgeInsets.fromLTRB(20, top + 14, 20, _overlap + 22),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Account".tr, style: AppText.title(p.onBrand).copyWith(fontSize: 27, letterSpacing: -0.4)),
                  const SizedBox(height: 2),
                  Text(
                    "Manage your account and preferences".tr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.body(_onBandSub).copyWith(fontSize: 14),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            _bandButton(icon: Icons.settings_outlined, label: 'Settings'.tr, onTap: _showSettingsBottomSheet),
            const SizedBox(width: 10),
            _bandButton(
              icon: Icons.notifications_none_rounded,
              label: 'Notifications'.tr,
              dot: hasUnreadNotif,
              onTap: () => Get.to(() => const Notifications()),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openEditProfile() async {
    await Get.to(() => const EditProfile());
    fetchProfileOverview();
  }

  Widget _buildIdentityCard({
    required String name,
    required String ccode,
    required String mobile,
    required String rImg,
    required String tagline,
    required String completionTitle,
    required String completionPrompt,
    required int completionPercent,
  }) {
    final p = AppPalette.current;
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => w[0].toUpperCase())
        .join();
    Widget initialsAvatar() => Container(
          color: p.brandTint,
          alignment: Alignment.center,
          child: Text(initials.isEmpty ? 'S' : initials, style: AppText.title(p.brandText).copyWith(fontSize: 24)),
        );
    // The server's default line is not worth the space; a custom tagline still shows.
    final showTagline = tagline.trim().isNotEmpty && !tagline.startsWith("Let's move a smarter");

    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: _openEditProfile,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 12, 16),
              child: Row(
                children: [
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Container(
                        height: 64,
                        width: 64,
                        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: p.brandTint, width: 3)),
                        child: ClipOval(
                          child: Config.isValidImageUrl(rImg)
                              ? Image.network(
                                  Config.resolveImageUrl(rImg),
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) => initialsAvatar(),
                                )
                              : initialsAvatar(),
                        ),
                      ),
                      Positioned(
                        bottom: -2,
                        right: -2,
                        child: Container(
                          height: 24,
                          width: 24,
                          decoration: BoxDecoration(
                            color: p.brand,
                            shape: BoxShape.circle,
                            border: Border.all(color: p.surface, width: 2),
                          ),
                          child: Icon(Icons.camera_alt_rounded, color: p.onBrand, size: 12),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.title(p.ink).copyWith(fontSize: 20)),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Flexible(
                              child: Text("$ccode $mobile",
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.body(p.inkMuted).copyWith(fontSize: 14)),
                            ),
                            const SizedBox(width: 6),
                            Icon(Icons.verified_rounded, color: p.success, size: 16),
                          ],
                        ),
                        if (showTagline) ...[
                          const SizedBox(height: 4),
                          Text(tagline,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.caption(p.inkSubtle).copyWith(height: 1.3)),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Semantics(
                    button: true,
                    label: 'Edit Profile'.tr,
                    excludeSemantics: true,
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: p.canvas, shape: BoxShape.circle),
                      child: Icon(Icons.edit_outlined, color: p.ink, size: 19),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (completionPercent < 100) ...[
            Divider(height: 1, color: p.divider),
            _buildCompleteProfileCard(
              title: completionTitle,
              prompt: completionPrompt,
              percentage: completionPercent,
            ),
          ],
        ],
      ),
    );
  }

  /// Porter-style quick action: tinted round icon over a short label.
  Widget _quickTile({
    required IconData icon,
    required String label,
    required Color color,
    required Color tint,
    required VoidCallback onTap,
  }) {
    final p = AppPalette.current;
    return Material(
      color: p.surface,
      borderRadius: BorderRadius.circular(AppRadius.card),
      elevation: 0,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: Container(
          constraints: const BoxConstraints(minHeight: 96),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.card), boxShadow: AppShadow.card, color: p.surface),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: tint, shape: BoxShape.circle),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 8),
              Text(label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13, height: 1.2)),
            ],
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared section heading (orange accent bar + title + subtitle)
  // ─────────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────
  // 2. "Complete your profile" Card
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildCompleteProfileCard({
    required String title,
    required String prompt,
    required int percentage,
  }) {
    final p = AppPalette.current;
    final double value = (percentage / 100.0).clamp(0.0, 1.0);
    return InkWell(
      onTap: () async {
        final missing = (overviewData?["profile_completion"]?["missing_fields"] as List?) ?? [];
        if (missing.length == 1 && missing.contains("saved_address")) {
          await Get.to(() => const AddressListPage());
        } else {
          await Get.to(() => const EditProfile());
        }
        fetchProfileOverview();
      },
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.card)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(title.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14))),
                      Text('$percentage%', style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: value,
                      minHeight: 6,
                      backgroundColor: p.brandTint,
                      valueColor: AlwaysStoppedAnimation<Color>(p.brand),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(prompt.tr,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption(p.inkMuted).copyWith(fontSize: 12.5, height: 1.3)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 22),
          ],
        ),
      ),
    );
  }

  void _callCustomerCare() {
    Get.bottomSheet(
      Container(
        padding: const EdgeInsets.all(22),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 44,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                color: Color(0xFFE8F8EE),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.phone_in_talk_rounded, color: Color(0xFF00C853), size: 32),
            ),
            const SizedBox(height: 14),
            Text(
              "Customer Care Support".tr,
              style: TextStyle(
                fontFamily: "Gilroy_Bold",
                fontSize: 18,
                color: AppPalette.light.ink,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              customerCareHours.tr,
              style: const TextStyle(
                fontFamily: "Gilroy_Medium",
                fontSize: 13,
                color: Color(0xFF64748B),
              ),
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.phone_rounded, color: Color(0xFF00C853), size: 20),
                  const SizedBox(width: 8),
                  Text(
                    customerCareNumber,
                    style: TextStyle(
                      fontFamily: "Gilroy_Bold",
                      fontSize: 17,
                      color: AppPalette.light.ink,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Get.back(),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: BorderSide(color: Colors.grey.shade300),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text("Cancel".tr, style: const TextStyle(fontFamily: "Gilroy_Bold", color: Color(0xFF64748B))),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Get.back();
                      makePhoneCall(customerCareNumber);
                    },
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      backgroundColor: const Color(0xFF00C853),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.call_rounded, color: Colors.white, size: 18),
                        const SizedBox(width: 6),
                        Text("Call Now".tr, style: const TextStyle(fontFamily: "Gilroy_Bold", color: Colors.white)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(height: MediaQuery.of(context).padding.bottom + 6),
          ],
        ),
      ),
      isScrollControlled: true,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reusable Menu Item & Divider
  // ─────────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────
  // Legal Pages Handler (Privacy Policy & Terms)
  // ─────────────────────────────────────────────────────────────────────────────
  void _openLegalPage(String keyWord) {
    // Check backend overview data first
    final legalData = overviewData?["legal"] ?? {};
    if (keyWord.toLowerCase().contains("privacy") && legalData["privacy_policy"] != null) {
      final p = legalData["privacy_policy"];
      Get.to(() => Loream(
            title: p["title"] ?? "Privacy Policy",
            description: p["description"] ?? "Privacy Policy details",
          ));
      return;
    }
    if (keyWord.toLowerCase().contains("term") && legalData["terms_of_use"] != null) {
      final p = legalData["terms_of_use"];
      Get.to(() => Loream(
            title: p["title"] ?? "Terms of Use",
            description: p["description"] ?? "Terms and conditions details",
          ));
      return;
    }

    // Fallback to PageListApiController
    final pages = pageListApiController.pageListApiModel?.pagelist ?? [];
    for (final page in pages) {
      final t = (page.title ?? "").toLowerCase();
      if (keyWord.toLowerCase().contains("privacy") && t.contains("privacy")) {
        Get.to(() => Loream(
              title: page.title ?? "Privacy Policy",
              description: page.description ?? "",
            ));
        return;
      }
      if (keyWord.toLowerCase().contains("term") &&
          (t.contains("term") || t.contains("condition"))) {
        Get.to(() => Loream(
              title: page.title ?? "Terms of Use",
              description: page.description ?? "",
            ));
        return;
      }
    }

    // Default fallback
    Get.to(() => Loream(
          title: keyWord,
          description: "<h3>$keyWord</h3><p>Shifter Online terms and information.</p>",
        ));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Settings Bottom Sheet (Gear Icon)
  // ─────────────────────────────────────────────────────────────────────────────
  /// Dark mode switch (Account row + settings sheet).
  Future<void> _setDarkMode(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    setState(() => notifier.setIsDark = value);
    prefs.setBool("isDark", value);
  }

  /// Delete-account confirmation (Account row + settings sheet).
  void _askDeleteAccount() {
    deleteAndLogoutBottomsheet(
      context,
      titel: "Delete Account".tr,
      description: "Are you sure you want to delete your account permanently?".tr,
      buttonText: "Yes, Delete".tr,
      onTap: () {
        Get.back();
        deleteAccount();
      },
    );
  }

  void _showSettingsBottomSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFCBD5E1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                "App Preferences".tr,
                style: TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 18,
                  color: AppPalette.light.ink,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 16),

              // Language
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.language_rounded, color: Color(0xFF2563EB)),
                ),
                title: Text(
                  "Language".tr,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 14.5,
                    color: AppPalette.light.ink,
                  ),
                ),
                trailing: const Icon(Icons.chevron_right_rounded, color: Color(0xFF94A3B8)),
                onTap: () {
                  Navigator.pop(context);
                  Get.to(() => const LanguageScreen());
                },
              ),

              const Divider(height: 1),

              // Dark Mode
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFBEB),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    notifier.isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                    color: const Color(0xFFD97706),
                  ),
                ),
                title: Text(
                  "Dark Mode".tr,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 14.5,
                    color: AppPalette.light.ink,
                  ),
                ),
                trailing: CupertinoSwitch(
                  value: notifier.isDark,
                  activeColor: const Color(0xFFFA4500),
                  onChanged: _setDarkMode,
                ),
              ),

              const Divider(height: 1),

              // Delete Account
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.delete_outline_rounded, color: Color(0xFFEF4444)),
                ),
                title: Text(
                  "Delete Account".tr,
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 14.5,
                    color: Color(0xFFEF4444),
                  ),
                ),
                onTap: () {
                  Navigator.pop(context);
                  _askDeleteAccount();
                },
              ),

              const SizedBox(height: 14),
              Center(
                child: Text(
                  "Version ${appVersion ?? '1.0.0'}",
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 12,
                    color: Color(0xFF94A3B8),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Referral & Share
  // ─────────────────────────────────────────────────────────────────────────────
  Future<void> referAndEarn() async {
    final referralData = overviewData?["referral"] ?? {};
    String refCode = referralData["code"]?.toString() ??
        getdata.read("referral_code")?.toString() ??
        "";
    if (refCode.isEmpty) {
      refCode = getdata.read("UserLogin")?["referral_code"]?.toString() ?? "";
    }

    String refMsg = referralData["share_message"]?.toString() ??
        getdata.read("referral_msg")?.toString() ??
        "Hey! Use my referral code to sign up on Shifter Online and earn rewards!";

    showDialog(
      context: context,
      builder: (BuildContext context) {
        return Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          backgroundColor: Colors.white,
          elevation: 5,
          child: Padding(
            padding: const EdgeInsets.all(22.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.card_giftcard_rounded,
                  color: Color(0xFFE11D48),
                  size: 46,
                ),
                const SizedBox(height: 12),
                Text(
                  "Refer & Earn".tr,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 20,
                    color: AppPalette.light.ink,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  "Invite friends to Shifter Online using your referral code and earn instant reward points!"
                      .tr,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 13,
                    color: Color(0xFF64748B),
                    height: 1.35,
                  ),
                ),
                if (refCode.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          refCode,
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 16,
                            color: Color(0xFFFA4500),
                            letterSpacing: 1.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 22),
                Row(
                  children: [
                    Expanded(
                      child: InkWell(
                        onTap: () {
                          Navigator.pop(context);
                          final shareText =
                              "$refMsg\n\nReferral Code: $refCode\n\nDownload: https://play.google.com/store/apps/details?id=$packageName";
                          Share.share(shareText, subject: 'Refer & Earn - Shifter Online');
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEFF6FF),
                            border: Border.all(color: const Color(0xFFBFDBFE)),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: const [
                              Icon(Icons.person, color: Color(0xFF2563EB), size: 28),
                              SizedBox(height: 6),
                              Text(
                                "CUSTOMER",
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 13,
                                  color: Color(0xFF1D4ED8),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: InkWell(
                        onTap: () {
                          Navigator.pop(context);
                          final shareText =
                              "$refMsg\n\nReferral Code: $refCode\n\nDownload driver app: https://play.google.com/store/apps/details?id=com.shifter.driver&pcampaignid=web_share";
                          Share.share(shareText, subject: 'Refer & Earn - Shifter Online');
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF0FDF4),
                            border: Border.all(color: const Color(0xFFBBF7D0)),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: const [
                              Icon(Icons.local_shipping, color: Color(0xFF16A34A), size: 28),
                              SizedBox(height: 6),
                              Text(
                                "DRIVER",
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 13,
                                  color: Color(0xFF15803D),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                InkWell(
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => const LeadReferralScreen(),
                      ),
                    );
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7ED),
                      border: Border.all(color: const Color(0xFFFFEDD5)),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: const BoxDecoration(
                            color: Color(0xFFFFEDD5),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.contacts_rounded, color: Color(0xFFFA4500), size: 22),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    "Refer from Phone Contacts",
                                    style: TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: AppPalette.light.ink,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFA4500),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Text(
                                      "NEW",
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 9,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              const Text(
                                "Select contacts, earn 100 pts & track status",
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 11,
                                  color: Color(0xFF64748B),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Color(0xFFFA4500)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> share() async {
    final referralData = overviewData?["referral"] ?? {};
    String refCode = referralData["code"]?.toString() ??
        getdata.read("referral_code")?.toString() ??
        getdata.read("UserLogin")?["referral_code"]?.toString() ??
        "";

    String refMsg = referralData["share_message"]?.toString() ??
        getdata.read("referral_msg")?.toString() ??
        "Hey! Sign up on Shifter Online for fast, secure and reliable deliveries!";

    final buffer = StringBuffer(refMsg);
    if (refCode.isNotEmpty) {
      buffer.write("\n\nMy Referral Code: $refCode");
    }
    buffer.write("\n\nDownload the app: https://play.google.com/store/apps/details?id=$packageName");

    await Share.share(buffer.toString(), subject: 'Shifter Online');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Logout & Delete
  // ─────────────────────────────────────────────────────────────────────────────
  void _handleLogout() {
    deleteAndLogoutBottomsheet(
      context,
      buttonText: "Yes, Logout".tr,
      description: "Are you sure you want to log out?".tr,
      titel: "Log Out".tr,
      onTap: () async {
        Get.back();
        final prefs = await SharedPreferences.getInstance();
        prefs.setBool("isDark", false);
        NodeSocketManager.instance.disconnect();
        getdata.remove("Uid");
        save("firstLogin", false);
        getdata.remove("UserLogin");
        Get.offAll(const SignIn(paymenttype: "onboarding"));
      },
    );
  }

  void deleteAccount() {
    final uid = getdata.read("Uid") ?? "";
    final data = {"uid": uid};

    ApiWrapper.dataPostNode(Config.nodeDeleteAccount, data).then((val) async {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          tostmsg("${val["ResponseMsg"]}");
          final prefs = await SharedPreferences.getInstance();
          prefs.setBool("isDark", false);
          NodeSocketManager.instance.disconnect();
          getdata.remove("Uid");
          save("firstLogin", false);
          getdata.remove("UserLogin");
          Get.offAll(const SignIn(paymenttype: "onboarding"));
        }
      }
    });
  }
}
