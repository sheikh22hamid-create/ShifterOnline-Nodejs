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
import 'faq.dart';
import 'favorite_drivers.dart';
import 'premium_plans_screen.dart';

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

  final PageListApiController pageListApiController = Get.put(PageListApiController());

  @override
  void initState() {
    super.initState();
    getPackage();
    fetchProfileOverview();
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

    // Profile Completion Data
    final completionData = overviewData?["profile_completion"] ?? {};
    final int completionPercent =
        int.tryParse(completionData["percentage"]?.toString() ?? "") ?? 80;
    final String completionTitle =
        completionData["title"]?.toString() ?? "Complete your profile";
    final String completionPrompt = completionData["prompt"]?.toString() ??
        "Add your email and more details for a better experience.";

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

              const SizedBox(height: 14),

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
    final double topSafe = MediaQuery.of(context).padding.top;

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFFFF5C22), Color(0xFFFA4500)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(28),
          bottomRight: Radius.circular(28),
        ),
      ),
      child: Stack(
        children: [
          // Background script watermark / ambient graphic
          Positioned(
            right: 14,
            top: topSafe + 36,
            child: Opacity(
              opacity: 0.16,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.location_on_rounded, color: Colors.white, size: 24),
                  const SizedBox(width: 4),
                  Transform.rotate(
                    angle: -0.08,
                    child: const Text(
                      "Delivering\nA Better\nTomorrow",
                      style: TextStyle(
                        fontFamily: "Gilroy_Bold",
                        fontSize: 18,
                        color: Colors.white,
                        height: 1.15,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Top Row: Title + Settings & Notification icons
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "My Profile".tr,
                            style: const TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 26,
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            "Manage your account and preferences".tr,
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 13,
                              color: Colors.white.withOpacity(0.88),
                            ),
                          ),
                        ],
                      ),
                      Row(
                        children: [
                          // Settings Button
                          GestureDetector(
                            onTap: _showSettingsBottomSheet,
                            child: Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.18),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.settings_outlined,
                                color: Colors.white,
                                size: 22,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          // Notification Bell Button with unread indicator
                          GestureDetector(
                            onTap: () => Get.to(() => const Notifications()),
                            child: Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.18),
                                shape: BoxShape.circle,
                              ),
                              child: Stack(
                                alignment: Alignment.center,
                                children: [
                                  const Icon(
                                    Icons.notifications_outlined,
                                    color: Colors.white,
                                    size: 22,
                                  ),
                                  if (hasUnreadNotif)
                                    Positioned(
                                      top: 8,
                                      right: 9,
                                      child: Container(
                                        width: 8,
                                        height: 8,
                                        decoration: const BoxDecoration(
                                          color: Color(0xFFFF2E2E),
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),

                  const SizedBox(height: 22),

                  // User Info Card Row inside Header
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // Avatar with edit pen badge
                      GestureDetector(
                        onTap: () => Get.to(() => const EditProfile()),
                        child: Stack(
                          clipBehavior: Clip.none,
                          children: [
                            Container(
                              height: 74,
                              width: 74,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white, width: 3.5),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.12),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: ClipOval(
                                child: Config.isValidImageUrl(rImg)
                                    ? Image.network(
                                        Config.resolveImageUrl(rImg),
                                        fit: BoxFit.cover,
                                        errorBuilder: (context, error, stackTrace) {
                                          return Image.asset(
                                            "assets/signin_hero_mascot.jpg",
                                            fit: BoxFit.cover,
                                          );
                                        },
                                      )
                                    : Image.asset(
                                        "assets/signin_hero_mascot.jpg",
                                        fit: BoxFit.cover,
                                      ),
                              ),
                            ),
                            Positioned(
                              bottom: 0,
                              right: 0,
                              child: Container(
                                height: 26,
                                width: 26,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFA4500),
                                  shape: BoxShape.circle,
                                  border: Border.all(color: Colors.white, width: 2),
                                ),
                                child: const Icon(
                                  Icons.edit_rounded,
                                  color: Colors.white,
                                  size: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(width: 14),

                      // User Details Column
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Name + Blue verified badge
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Flexible(
                                  child: Text(
                                    name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 20,
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: const BoxDecoration(
                                    color: Color(0xFF0284C7),
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(
                                    Icons.check,
                                    color: Colors.white,
                                    size: 12,
                                  ),
                                ),
                              ],
                            ),

                            const SizedBox(height: 3),

                            // Mobile number
                            Text(
                              "$ccode $mobile",
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 13.5,
                                color: Colors.white,
                                letterSpacing: 0.3,
                              ),
                            ),

                            const SizedBox(height: 5),

                            // "Phone Verified" Pill Tag
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: const [
                                  Icon(
                                    Icons.check_circle_rounded,
                                    color: Color(0xFF16A34A),
                                    size: 12,
                                  ),
                                  SizedBox(width: 4),
                                  Text(
                                    "Phone Verified",
                                    style: TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 10.5,
                                      color: Color(0xFF16A34A),
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 5),

                            // Dynamic Tagline / Mission statement
                            Text(
                              "“$tagline”",
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 11,
                                color: Colors.white.withOpacity(0.92),
                                fontStyle: FontStyle.italic,
                                height: 1.25,
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(width: 8),

                      // "Edit Profile ->" Pill Button
                      GestureDetector(
                        onTap: () => Get.to(() => const EditProfile()),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.18),
                            borderRadius: BorderRadius.circular(22),
                            border: Border.all(
                              color: Colors.white.withOpacity(0.85),
                              width: 1.2,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: const [
                              Text(
                                "Edit Profile",
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 12,
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              SizedBox(width: 4),
                              Icon(
                                Icons.arrow_forward_rounded,
                                color: Colors.white,
                                size: 14,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
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

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.035),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => Get.to(() => const EditProfile()),
          borderRadius: BorderRadius.circular(18),
          child: Padding(
            padding: const EdgeInsets.all(15),
            child: Row(
              children: [
                // Person Outline Icon in soft rounded container
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF1EB),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.person_outline_rounded,
                    color: Color(0xFFFA4500),
                    size: 24,
                  ),
                ),
                const SizedBox(width: 14),

                // Title + Subtitle + Progress Bar
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
                        prompt.tr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 11.5,
                          color: Color(0xFF64748B),
                        ),
                      ),
                      const SizedBox(height: 9),

                      // Progress Bar row with percentage label
                      Row(
                        children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: LinearProgressIndicator(
                                value: normalizedValue,
                                minHeight: 6,
                                backgroundColor: const Color(0xFFE2E8F0),
                                valueColor: const AlwaysStoppedAnimation<Color>(
                                  Color(0xFFFA4500),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            "$percentage%",
                            style: const TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 12.5,
                              color: Color(0xFFFA4500),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(width: 8),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: Color(0xFF94A3B8),
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
  // 3. "Quick Access" Section
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildQuickAccessSection({
    required Map premiumData,
    required Map favDriversData,
    required List driverList,
  }) {
    final String premiumTitle = premiumData["title"]?.toString() ?? "Shifter Premium";
    final String premiumBadge = premiumData["badge"]?.toString() ?? "NEW";
    final String premiumSubtitle = premiumData["subtitle"]?.toString() ??
        "Save more on every booking\nFaster • Better • More rewards";

    final String favTitle = favDriversData["title"]?.toString() ?? "Favorite Drivers";
    final String favSubtitle =
        favDriversData["subtitle"]?.toString() ?? "Quickly book your\npreferred drivers";

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section Title
          Text(
            "Quick Access".tr,
            style: const TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 16.5,
              color: Color(0xFF0F172A),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            "Everything you need, quickly".tr,
            style: const TextStyle(
              fontFamily: 'Gilroy_Medium',
              fontSize: 12,
              color: Color(0xFF64748B),
            ),
          ),
          const SizedBox(height: 12),

          // Two side-by-side cards
          Row(
            children: [
              // Card 1: Shifter Premium
              Expanded(
                child: Container(
                  height: 154,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFF7ED), Color(0xFFFFEDD5)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: const Color(0xFFFED7AA), width: 1.2),
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => Get.to(() => const PremiumPlansScreen()),
                      borderRadius: BorderRadius.circular(18),
                      child: Stack(
                        children: [
                          // 3D Golden Crown Graphic accent in bottom-left
                          Positioned(
                            bottom: -4,
                            left: 8,
                            child: Opacity(
                              opacity: 0.90,
                              child: Image.asset(
                                "assets/premium_crown_gold.jpg",
                                height: 52,
                                width: 52,
                                fit: BoxFit.contain,
                                errorBuilder: (c, e, s) => const Icon(
                                  Icons.workspace_premium_rounded,
                                  size: 42,
                                  color: Color(0xFFF59E0B),
                                ),
                              ),
                            ),
                          ),

                          Padding(
                            padding: const EdgeInsets.all(13),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Top row: Crown icon + Title + NEW Badge + Arrow
                                Row(
                                  children: [
                                    Container(
                                      width: 28,
                                      height: 28,
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFF59E0B),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: const Icon(
                                        Icons.workspace_premium_rounded,
                                        color: Colors.white,
                                        size: 18,
                                      ),
                                    ),
                                    const SizedBox(width: 7),
                                    Expanded(
                                      child: Row(
                                        children: [
                                          Flexible(
                                            child: Text(
                                              premiumTitle,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                fontFamily: 'Gilroy_Bold',
                                                fontSize: 12.5,
                                                color: Color(0xFF0F172A),
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 4),
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 4, vertical: 1.5),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFEA580C),
                                              borderRadius: BorderRadius.circular(5),
                                            ),
                                            child: Text(
                                              premiumBadge,
                                              style: const TextStyle(
                                                fontFamily: 'Gilroy_Bold',
                                                fontSize: 8,
                                                color: Colors.white,
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const Icon(
                                      Icons.chevron_right_rounded,
                                      color: Color(0xFF94A3B8),
                                      size: 18,
                                    ),
                                  ],
                                ),

                                const SizedBox(height: 8),

                                // Subtitle
                                Text(
                                  premiumSubtitle,
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontFamily: 'Gilroy_Medium',
                                    fontSize: 10.5,
                                    color: Color(0xFF64748B),
                                    height: 1.35,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(width: 12),

              // Card 2: Favorite Drivers
              Expanded(
                child: Container(
                  height: 154,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: const Color(0xFFF1F5F9), width: 1.2),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.025),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => Get.to(() => const FavoriteDriversScreen()),
                      borderRadius: BorderRadius.circular(18),
                      child: Padding(
                        padding: const EdgeInsets.all(13),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Top row: Heart icon + Title + Arrow
                            Row(
                              children: [
                                Container(
                                  width: 28,
                                  height: 28,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFF1F2),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Icon(
                                    Icons.favorite_rounded,
                                    color: Color(0xFFF43F5E),
                                    size: 16,
                                  ),
                                ),
                                const SizedBox(width: 7),
                                Expanded(
                                  child: Text(
                                    favTitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 12.5,
                                      color: Color(0xFF0F172A),
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                const Icon(
                                  Icons.chevron_right_rounded,
                                  color: Color(0xFF94A3B8),
                                  size: 18,
                                ),
                              ],
                            ),

                            const SizedBox(height: 8),

                            // Subtitle
                            Text(
                              favSubtitle,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 10.5,
                                color: Color(0xFF64748B),
                                height: 1.35,
                              ),
                            ),

                            const Spacer(),

                            // Driver Avatar Stack
                            Row(
                              children: [
                                _buildDriverAvatarStack(driverList),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // Overlapping 3-avatar stack for Favorite Drivers
  Widget _buildDriverAvatarStack(List drivers) {
    // Show real driver avatars if available, fallback to 3 avatar items
    final int count = drivers.isNotEmpty ? drivers.length.clamp(1, 3) : 3;

    return SizedBox(
      height: 30,
      width: 65,
      child: Stack(
        children: List.generate(count, (index) {
          final String? avatarUrl = index < drivers.length
              ? drivers[index]["avatar"]?.toString()
              : null;

          return Positioned(
            left: index * 17.0,
            child: Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
                color: const Color(0xFFE2E8F0),
              ),
              child: ClipOval(
                child: Config.isValidImageUrl(avatarUrl)
                    ? Image.network(
                        Config.resolveImageUrl(avatarUrl),
                        fit: BoxFit.cover,
                        errorBuilder: (c, e, s) => Image.asset(
                          "assets/signin_hero_mascot.jpg",
                          fit: BoxFit.cover,
                        ),
                      )
                    : Image.asset(
                        "assets/signin_hero_mascot.jpg",
                        fit: BoxFit.cover,
                      ),
              ),
            ),
          );
        }),
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
          Text(
            "Help & Legal".tr,
            style: const TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 16.5,
              color: Color(0xFF0F172A),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            "Get support and learn more".tr,
            style: const TextStyle(
              fontFamily: 'Gilroy_Medium',
              fontSize: 12,
              color: Color(0xFF64748B),
            ),
          ),
          const SizedBox(height: 12),

          // Container with 3 items: FAQ, Privacy Policy, Terms of Use
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.025),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              children: [
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. "More" Section
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildMoreSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "More".tr,
            style: const TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 16.5,
              color: Color(0xFF0F172A),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            "Additional options".tr,
            style: const TextStyle(
              fontFamily: 'Gilroy_Medium',
              fontSize: 12,
              color: Color(0xFF64748B),
            ),
          ),
          const SizedBox(height: 12),

          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.025),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
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
