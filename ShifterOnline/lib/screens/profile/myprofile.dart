// ignore_for_file: deprecated_member_use

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
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
import '../../utils/Calculation.dart';

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
      completionTitle = "Profile 100% Completed! 🎉";
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
    final List favDriverList = favDriversData["drivers"] is List
        ? (favDriversData["drivers"] as List)
        : [];

    // Notification Data
    final notifData = overviewData?["notifications"] ?? {};
    final bool hasUnreadNotif = (notifData["has_unread"] == true) ||
        ((int.tryParse(notifData["unread_count"]?.toString() ?? "0") ?? 0) > 0);

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FB),
      body: RefreshIndicator(
        onRefresh: fetchProfileOverview,
        color: const Color(0xFFFA4500),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).padding.bottom + 85),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── 1. Vibrant Orange Header Section ─────────────────────────────
              _buildOrangeHeader(
                name: name,
                ccode: ccode,
                mobile: mobile,
                rImg: rImg,
                tagline: tagline,
                hasUnreadNotif: hasUnreadNotif,
              ),

              const SizedBox(height: 18),

              // ── 2. Complete Your Profile Card ────────────────────────────────
              _buildCompleteProfileCard(
                title: completionTitle,
                prompt: completionPrompt,
                percentage: completionPercent,
              ),

              const SizedBox(height: 18),

              // ── 3. Quick Access Section (Shifter Premium & Favorite Drivers) ──
              _buildQuickAccessSection(
                premiumData: premiumData,
                favDriversData: favDriversData,
                driverList: favDriverList,
              ),

              const SizedBox(height: 22),

              // ── 4. Help & Legal Section (FAQ, Privacy Policy, Terms) ──────────
              _buildHelpAndLegalSection(),

              const SizedBox(height: 22),

              // ── 5. More Section (Refer & Earn, Share) ────────────────────────
              _buildMoreSection(),

              const SizedBox(height: 16),

              // ── 6. Log Out Card ──────────────────────────────────────────────
              _buildLogoutCard(),

              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Orange Header
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildOrangeHeader({
    required String name,
    required String ccode,
    required String mobile,
    required String rImg,
    required String tagline,
    required bool hasUnreadNotif,
  }) {
    const radius = BorderRadius.only(
      bottomLeft: Radius.circular(32),
      bottomRight: Radius.circular(32),
    );

    Widget bubble(double size, double opacity) => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.white.withOpacity(opacity),
          ),
        );

    Widget roundIconButton({required IconData icon, required VoidCallback onTap, bool dot = false}) {
      return GestureDetector(
        onTap: onTap,
        child: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.20),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withOpacity(0.35)),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 22),
              if (dot)
                Positioned(
                  top: 9,
                  right: 10,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFE14D),
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFFA4500), width: 1.5),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    }

    Future<void> openEditProfile() async {
      await Get.to(() => const EditProfile());
      fetchProfileOverview();
    }

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFFFF6A2B), Color(0xFFFA4500), Color(0xFFE63E00)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: radius,
        boxShadow: [
          BoxShadow(color: Color(0x40FA4500), blurRadius: 18, offset: Offset(0, 8)),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Stack(
          children: [
            // Soft decorative circles (brand pattern, no text so nothing collides with the content)
            Positioned(right: -46, top: -34, child: bubble(160, 0.10)),
            Positioned(right: 60, top: 70, child: bubble(54, 0.07)),
            Positioned(left: -56, bottom: -70, child: bubble(180, 0.07)),

            SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Top bar: title + actions
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "My Profile".tr,
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 26,
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.2,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                "Manage your account and preferences".tr,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 12.5,
                                  color: Colors.white.withOpacity(0.88),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        roundIconButton(icon: Icons.settings_outlined, onTap: _showSettingsBottomSheet),
                        const SizedBox(width: 10),
                        roundIconButton(
                          icon: Icons.notifications_outlined,
                          dot: hasUnreadNotif,
                          onTap: () => Get.to(() => const Notifications()),
                        ),
                      ],
                    ),

                    const SizedBox(height: 22),

                    // Identity: avatar + name / phone / verified. Full width, so a long name is not cut off.
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        GestureDetector(
                          onTap: openEditProfile,
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Container(
                                height: 86,
                                width: 86,
                                padding: const EdgeInsets.all(3),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white,
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.18),
                                      blurRadius: 14,
                                      offset: const Offset(0, 6),
                                    ),
                                  ],
                                ),
                                child: ClipOval(
                                  child: Config.isValidImageUrl(rImg)
                                      ? Image.network(
                                          Config.resolveImageUrl(rImg),
                                          fit: BoxFit.cover,
                                          errorBuilder: (context, error, stackTrace) => Image.asset(
                                            "assets/signin_hero_mascot.jpg",
                                            fit: BoxFit.cover,
                                          ),
                                        )
                                      : Image.asset("assets/signin_hero_mascot.jpg", fit: BoxFit.cover),
                                ),
                              ),
                              Positioned(
                                bottom: 0,
                                right: 0,
                                child: Container(
                                  height: 28,
                                  width: 28,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF111827),
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white, width: 2),
                                  ),
                                  child: const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 13),
                                ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(width: 16),

                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 22,
                                        color: Colors.white,
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: -0.2,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  const Icon(Icons.verified_rounded, color: Colors.white, size: 19),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Icon(Icons.phone_rounded, color: Colors.white.withOpacity(0.9), size: 14),
                                  const SizedBox(width: 5),
                                  Text(
                                    "$ccode $mobile",
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 14,
                                      color: Colors.white,
                                      letterSpacing: 0.3,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: const [
                                    Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 13),
                                    SizedBox(width: 4),
                                    Text(
                                      "Phone Verified",
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 11,
                                        color: Color(0xFF16A34A),
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),

                    // Tagline (user's own line from the backend), calm and readable instead of squeezed italics.
                    Text(
                      tagline,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 12.5,
                        color: Colors.white.withOpacity(0.9),
                        height: 1.35,
                      ),
                    ),

                    const SizedBox(height: 14),

                    // Edit Profile: full-width white button, clear primary action of the header.
                    SizedBox(
                      width: double.infinity,
                      height: 44,
                      child: ElevatedButton.icon(
                        onPressed: openEditProfile,
                        icon: const Icon(Icons.edit_rounded, size: 17),
                        label: Text(
                          "Edit Profile".tr,
                          style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14, fontWeight: FontWeight.w700),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xFFFA4500),
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared section heading (orange accent bar + title + subtitle)
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _sectionHeader(String title, String subtitle) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 4,
            height: 32,
            decoration: BoxDecoration(
              color: const Color(0xFFFA4500),
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title.tr,
                style: const TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 16.5,
                  color: Color(0xFF0F172A),
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                subtitle.tr,
                style: const TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 12,
                  color: Color(0xFF64748B),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. "Complete your profile" Card
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildCompleteProfileCard({
    required String title,
    required String prompt,
    required int percentage,
  }) {
    final double normalizedValue = (percentage / 100.0).clamp(0.0, 1.0);
    final bool isComplete = percentage >= 100;
    final Color accentColor = isComplete ? const Color(0xFF10B981) : const Color(0xFFFA4500);
    final Color trackColor = isComplete ? const Color(0xFFD1FAE5) : const Color(0xFFFFE4D6);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFF1F5F9)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () async {
            final missing = (overviewData?["profile_completion"]?["missing_fields"] as List?) ?? [];
            if (missing.length == 1 && missing.contains("saved_address")) {
              await Get.to(() => const AddressListPage());
            } else {
              await Get.to(() => const EditProfile());
            }
            fetchProfileOverview();
          },
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(15),
            child: Row(
              children: [
                // Circular progress with the percentage inside
                SizedBox(
                  width: 54,
                  height: 54,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      SizedBox(
                        width: 54,
                        height: 54,
                        child: CircularProgressIndicator(
                          value: normalizedValue,
                          strokeWidth: 5,
                          backgroundColor: trackColor,
                          valueColor: AlwaysStoppedAnimation<Color>(accentColor),
                        ),
                      ),
                      Text(
                        "$percentage%",
                        style: TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 12.5,
                          color: accentColor,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 14),

                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title.tr,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 14.5,
                          color: Color(0xFF0F172A),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        prompt.tr,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 11.5,
                          color: Color(0xFF64748B),
                          height: 1.3,
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(width: 6),
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: accentColor.withOpacity(0.10),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.chevron_right_rounded, color: accentColor, size: 20),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. "Quick Access" Section
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildQuickAccessSection({
    required Map premiumData,
    required Map favDriversData,
    required List driverList,
  }) {
    final String premiumTitle = premiumData["title"]?.toString() ?? "Shifter Premium";
    final String premiumBadge = premiumData["badge"]?.toString() ?? "NEW";
    // The backend sends two-line copy; on a full-width row it reads better on one flowing line.
    final String premiumSubtitle = (premiumData["subtitle"]?.toString() ??
            "Save more on every booking\nFaster • Better • More rewards")
        .replaceAll('\n', ' · ');

    final String favTitle = favDriversData["title"]?.toString() ?? "Favorite Drivers";
    final String favSubtitle = (favDriversData["subtitle"]?.toString() ?? "Quickly book your preferred drivers")
        .replaceAll('\n', ' ');

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionHeader("Quick Access", "Everything you need, quickly"),

          // Premium: highlighted row. Height follows its content (no fixed height), so there is no empty space.
          Container(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFF7ED), Color(0xFFFFE9D2)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFFED7AA), width: 1.2),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFF59E0B).withOpacity(0.14),
                  blurRadius: 14,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => Get.to(() => const PremiumPlansScreen()),
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                  child: Row(
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFFFBBF24), Color(0xFFF59E0B)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(14),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFFF59E0B).withOpacity(0.35),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Icon(Icons.workspace_premium_rounded, color: Colors.white, size: 26),
                      ),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    premiumTitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 15,
                                      color: Color(0xFF0F172A),
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                if (premiumBadge.isNotEmpty) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFEA580C),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      premiumBadge,
                                      style: const TextStyle(
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 9,
                                        color: Colors.white,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: 3),
                            Text(
                              premiumSubtitle,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 11.5,
                                color: Color(0xFF7C5A3A),
                                height: 1.3,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        width: 30,
                        height: 30,
                        decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                        child: const Icon(Icons.chevron_right_rounded, color: Color(0xFFEA580C), size: 21),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          const SizedBox(height: 12),

          // Favorite + Blocked drivers: one grouped card, same row style as the other sections.
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFF1F5F9)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.03),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              children: [
                _buildMenuItem(
                  icon: Icons.favorite_rounded,
                  iconColor: const Color(0xFFF43F5E),
                  iconBgColor: const Color(0xFFFFF1F2),
                  title: favTitle,
                  subtitle: favSubtitle,
                  onTap: () => Get.to(() => const FavoriteDriversScreen()),
                ),
                _buildItemDivider(),
                _buildMenuItem(
                  icon: Icons.block_rounded,
                  iconColor: const Color(0xFF475569),
                  iconBgColor: const Color(0xFFF1F5F9),
                  title: "Blocked Drivers",
                  subtitle: "Drivers you blocked. Unblock them anytime",
                  onTap: () => Get.to(() => const BlockedDriversScreen()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. "Help & Legal" Section
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildHelpAndLegalSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionHeader("Help & Legal", "Get support and learn more"),

          // Container with 3 items: FAQ, Privacy Policy, Terms of Use
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFF1F5F9)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.03),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              children: [
                // Customer Care Helpline
                _buildMenuItem(
                  icon: Icons.headset_mic_rounded,
                  iconColor: const Color(0xFF00C853),
                  iconBgColor: const Color(0xFFE8F8EE),
                  title: "Customer Care",
                  subtitle: "Call $customerCareNumber • $customerCareHours",
                  onTap: () => _callCustomerCare(),
                ),
                _buildItemDivider(),

                // FAQ
                _buildMenuItem(
                  icon: Icons.question_mark_rounded,
                  iconColor: const Color(0xFF0284C7),
                  iconBgColor: const Color(0xFFE0F2FE),
                  title: "FAQ",
                  subtitle: "Find answers to common questions",
                  onTap: () => Get.to(() => Faq()),
                ),
                _buildItemDivider(),

                // Privacy Policy
                _buildMenuItem(
                  icon: Icons.verified_user_rounded,
                  iconColor: const Color(0xFF16A34A),
                  iconBgColor: const Color(0xFFDCFCE7),
                  title: "Privacy Policy",
                  subtitle: "How we protect your data",
                  onTap: () => _openLegalPage("Privacy Policy"),
                ),
                _buildItemDivider(),

                // Terms of Use
                _buildMenuItem(
                  icon: Icons.description_rounded,
                  iconColor: const Color(0xFF6366F1),
                  iconBgColor: const Color(0xFFEEF2FF),
                  title: "Terms of Use",
                  subtitle: "Rules and guidelines for using Shifter Online",
                  onTap: () => _openLegalPage("Terms of Use"),
                ),
              ],
            ),
          ),
        ],
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
              style: const TextStyle(
                fontFamily: "Gilroy_Bold",
                fontSize: 18,
                color: Color(0xFF0F172A),
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
                    style: const TextStyle(
                      fontFamily: "Gilroy_Bold",
                      fontSize: 17,
                      color: Color(0xFF0F172A),
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
  // 5. "More" Section
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildMoreSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionHeader("More", "Additional options"),

          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFF1F5F9)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.03),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              children: [
                // Refer & Earn
                _buildMenuItem(
                  icon: Icons.card_giftcard_rounded,
                  iconColor: const Color(0xFFE11D48),
                  iconBgColor: const Color(0xFFFFE4E6),
                  title: "Refer & Earn",
                  subtitle: "Invite friends and earn exciting rewards",
                  onTap: referAndEarn,
                ),
                _buildItemDivider(),

                // Share Shifter Online
                _buildMenuItem(
                  icon: Icons.share_rounded,
                  iconColor: const Color(0xFF3B82F6),
                  iconBgColor: const Color(0xFFE0E7FF),
                  title: "Share Shifter Online",
                  subtitle: "Help us grow, share with your friends",
                  onTap: share,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Log Out Card
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildLogoutCard() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFEE2E2), width: 1.2),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _handleLogout,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFE4E6),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.logout_rounded,
                    color: Color(0xFFEF4444),
                    size: 20,
                  ),
                ),
                const SizedBox(width: 14),

                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Log out".tr,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15,
                          color: Color(0xFFDC2626),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        "You'll need to verify your phone again to sign in".tr,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 11.5,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(width: 6),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: Color(0xFFFCA5A5),
                  size: 22,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reusable Menu Item & Divider
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildMenuItem({
    required IconData icon,
    required Color iconColor,
    required Color iconBgColor,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: iconBgColor,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: iconColor, size: 20),
              ),
              const SizedBox(width: 14),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title.tr,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 14.5,
                        color: Color(0xFF0F172A),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle.tr,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 11.5,
                        color: Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(width: 6),
              const Icon(
                Icons.chevron_right_rounded,
                color: Color(0xFF94A3B8),
                size: 22,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildItemDivider() {
    return const Padding(
      padding: EdgeInsets.only(left: 68, right: 14),
      child: Divider(
        height: 1,
        thickness: 0.8,
        color: Color(0xFFF1F5F9),
      ),
    );
  }

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
                style: const TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 18,
                  color: Color(0xFF0F172A),
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
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 14.5,
                    color: Color(0xFF0F172A),
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
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 14.5,
                    color: Color(0xFF0F172A),
                  ),
                ),
                trailing: CupertinoSwitch(
                  value: notifier.isDark,
                  activeColor: const Color(0xFFFA4500),
                  onChanged: (value) async {
                    final prefs = await SharedPreferences.getInstance();
                    setState(() => notifier.setIsDark = value);
                    prefs.setBool("isDark", value);
                  },
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
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 20,
                    color: Color(0xFF0F172A),
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
                                  const Text(
                                    "Refer from Phone Contacts",
                                    style: TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: Color(0xFF0F172A),
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
