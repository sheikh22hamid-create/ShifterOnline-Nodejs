// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/authscreen/signin.dart';
import 'package:otp_autofill/otp_autofill.dart';
import 'package:pinput/pinput.dart';
import 'package:provider/provider.dart';
import 'package:sms_autofill/sms_autofill.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'verification.dart';

// ─────────────────────────────────────────────────────────────────────────────
// City model
// ─────────────────────────────────────────────────────────────────────────────
class CityModel {
  final String id;
  final String title;
  CityModel({required this.id, required this.title});
}

// ─────────────────────────────────────────────────────────────────────────────
// SignUp widget
// ─────────────────────────────────────────────────────────────────────────────
class SignUp extends StatefulWidget {
  final String? type;
  final bool? showBackbutton;
  const SignUp({super.key, this.type, this.showBackbutton});

  @override
  State<SignUp> createState() => _SignUpState();
}

class _SignUpState extends State<SignUp> with TickerProviderStateMixin {
  // ── Controllers ──────────────────────────────────────────────────────────
  final TextEditingController number      = TextEditingController();
  final TextEditingController fullName    = TextEditingController();
  final TextEditingController email       = TextEditingController();
  final TextEditingController referralCode = TextEditingController();

  // ── State ─────────────────────────────────────────────────────────────────
  final String dropdownvalue = '+91';
  bool _termsAccepted   = false;
  bool isLoading        = false;
  bool _referralVisible = false;

  // ── City ──────────────────────────────────────────────────────────────────
  List<CityModel> cityList = [];
  CityModel? selectedCity;
  bool isCityLoading = false;

  // ── Inline validation errors ───────────────────────────────────────────────
  String? _nameError;
  String? _numberError;
  String? _emailError;
  String? _cityError;

  // ── Entrance animation ────────────────────────────────────────────────────
  late AnimationController _entranceCtrl;
  late Animation<double>   _fadeAnim;
  late Animation<Offset>   _slideAnim;

  // ── WebView helper ────────────────────────────────────────────────────────
  void _showWebViewDialog(String url, String title) {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadRequest(Uri.parse(url));

    showDialog(
      context: context,
      builder: (_) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            height: Get.height * 0.8,
            width:  Get.width  * 0.9,
            child: Column(children: [
              AppBar(
                title: Text(title,
                    style: const TextStyle(
                        fontSize: 16,
                        fontFamily: 'Gilroy_Bold',
                        color: Colors.black)),
                backgroundColor: Colors.white,
                elevation: 0,
                iconTheme: const IconThemeData(color: Colors.black),
                leading: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(context)),
              ),
              Expanded(child: WebViewWidget(controller: controller)),
            ]),
          ),
        ),
      ),
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    fetchCities();

    _entranceCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _fadeAnim  = CurvedAnimation(parent: _entranceCtrl, curve: Curves.easeOut);
    _slideAnim = Tween<Offset>(
            begin: const Offset(0, 0.08), end: Offset.zero)
        .animate(
            CurvedAnimation(parent: _entranceCtrl, curve: Curves.easeOut));

    _entranceCtrl.forward();
  }

  @override
  void dispose() {
    _entranceCtrl.dispose();
    number.dispose();
    fullName.dispose();
    email.dispose();
    referralCode.dispose();
    super.dispose();
  }

  // ── City API ──────────────────────────────────────────────────────────────
  Future<void> fetchCities() async {
    setState(() => isCityLoading = true);
    final val = await ApiWrapper.dataGetNode(Config.nodeCities);
    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      final list = val['CityData'] as List;
      setState(() {
        cityList = list
            .map((e) =>
                CityModel(id: e['id'].toString(), title: e['title'].toString()))
            .toList();
      });
    }
    setState(() => isCityLoading = false);
  }

  // ── Inline validation ─────────────────────────────────────────────────────
  bool _validate() {
    bool ok = true;

    _nameError   = null;
    _numberError = null;
    _emailError  = null;
    _cityError   = null;

    if (fullName.text.trim().isEmpty) {
      _nameError = 'Please enter your full name';
      ok = false;
    }
    final trimmedNum = number.text.trim();
    if (trimmedNum.isEmpty) {
      _numberError = 'Please enter your mobile number';
      ok = false;
    } else if (trimmedNum.length != 10 ||
        !RegExp(r'^[6-9][0-9]{9}$').hasMatch(trimmedNum)) {
      _numberError = 'Enter a valid 10-digit mobile number';
      ok = false;
    }
    // Email is optional — validate only when entered
    if (email.text.trim().isNotEmpty &&
        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email.text.trim())) {
      _emailError = 'Enter a valid email address';
      ok = false;
    }
    if (selectedCity == null) {
      _cityError = 'Please select your city';
      ok = false;
    }
    if (!_termsAccepted) {
      tostmsg('Please accept the Terms & Conditions');
      ok = false;
    }

    setState(() {});
    return ok;
  }

  // ── Primary CTA handler ───────────────────────────────────────────────────
  Future<void> _handleCreateAccount() async {
    FocusScope.of(context).unfocus();
    if (!_validate()) return;

    final numberchek = {'mobile': number.text.trim(), 'ccode': dropdownvalue};
    setState(() => isLoading = true);

    final val =
        await ApiWrapper.dataPostNode(Config.nodeMobileCheck, numberchek);
    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      // OTP-based registration: Send OTP and present the OTP bottom sheet.
      // Account creation (singUpApi) will execute only once the OTP is verified.
      await _sendOtp();
    } else {
      tostmsg(val?['ResponseMsg']?.toString() ?? 'Something went wrong');
    }
    setState(() => isLoading = false);
  }

  Future<void> _sendOtp() async {
    final body = {'mobile': dropdownvalue + number.text.trim()};
    final val  = await ApiWrapper.dataPostNode(Config.nodeSendOtp, body);
    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      final otp = val['otp']?.toString() ?? '';
      if (mounted) _showOtpBottomSheet(otp);
    } else {
      tostmsg(val?['ResponseMsg']?.toString() ?? 'Failed to send OTP');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OTP Bottom Sheet
  // ─────────────────────────────────────────────────────────────────────────
  void _showOtpBottomSheet(String sentOtp) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      isDismissible: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _OtpBottomSheet(
        mobile:       number.text.trim(),
        ccode:        dropdownvalue,
        sentOtp:      sentOtp,
        name:         fullName.text.trim(),
        emailVal:     email.text.trim(),
        cityId:       selectedCity?.id ?? '',
        refferalCode: referralCode.text.trim(),
        ptype:        widget.type,
        onResend:     _sendOtpForResend,
      ),
    );
  }

  // Resend uses same flow but updates the otp via callback
  Future<String?> _sendOtpForResend() async {
    final body = {'mobile': dropdownvalue + number.text.trim()};
    final val  = await ApiWrapper.dataPostNode(Config.nodeSendOtp, body);
    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      return val['otp']?.toString();
    }
    tostmsg(val?['ResponseMsg']?.toString() ?? 'Failed to resend OTP');
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // City Bottom Sheet
  // ─────────────────────────────────────────────────────────────────────────
  void _showCitySheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CitySheet(
        cityList:    cityList,
        isLoading:   isCityLoading,
        onSelect:    (city) {
          setState(() {
            selectedCity = city;
            _cityError   = null;
          });
        },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: Colors.white,
      resizeToAvoidBottomInset: true,
      body: FadeTransition(
        opacity: _fadeAnim,
        child: SlideTransition(
          position: _slideAnim,
          child: SafeArea(
            child: Column(
              children: [
                _buildTopBar(),
                Expanded(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.only(
                      left: 22,
                      right: 22,
                      bottom:
                          MediaQuery.of(context).viewInsets.bottom + 24,
                    ),
                    physics: const BouncingScrollPhysics(),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 8),
                        _buildHeader(),
                        const SizedBox(height: 28),
                        _buildFullNameField(),
                        const SizedBox(height: 16),
                        _buildMobileField(),
                        const SizedBox(height: 16),
                        _buildEmailField(),
                        const SizedBox(height: 16),
                        _buildCityField(),
                        const SizedBox(height: 12),
                        _buildReferralSection(),
                        const SizedBox(height: 20),
                        _buildTermsRow(),
                        const SizedBox(height: 24),
                        _buildCTAButton(),
                        const SizedBox(height: 20),
                        _buildSignInRow(),
                        const SizedBox(height: 12),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── Top Bar ───────────────────────────────────────────────────────────────
  Widget _buildTopBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 20, 0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Back button
          widget.type == 'onboarding'
              ? const SizedBox(width: 40)
              : GestureDetector(
                  onTap: () => Get.back(),
                  child: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: const Color(0xFFF5F5F5),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.arrow_back_ios_new_rounded,
                        size: 18, color: Color(0xFF1A1A1A)),
                  ),
                ),

          // Sign In link
          GestureDetector(
            onTap: () {
              if (widget.type == 'onboarding') {
                Get.offAll(SignIn(paymenttype: widget.type));
              } else {
                Get.back();
              }
            },
            child: Text(
              'Sign In',
              style: TextStyle(
                color: linercolor,
                fontFamily: 'Gilroy_Bold',
                fontSize: 15,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Header ────────────────────────────────────────────────────────────────
  Widget _buildHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Brand logo row
        Row(
          children: [
            Image.asset('assets/logo1.png', height: 36),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RichText(
                  text: TextSpan(
                    children: [
                      TextSpan(
                        text: 'Shifter',
                        style: TextStyle(
                          color: linercolor,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 18,
                        ),
                      ),
                      const TextSpan(
                        text: 'Online',
                        style: TextStyle(
                          color: Color(0xFF1A1A1A),
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 18,
                        ),
                      ),
                    ],
                  ),
                ),
                const Text(
                  'Delivery Made Simple',
                  style: TextStyle(
                    color: Color(0xFF888888),
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 20),
        const Text(
          'Create your account 🚀',
          style: TextStyle(
            color: Color(0xFF1A1A1A),
            fontFamily: 'Gilroy_Bold',
            fontSize: 26,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Get started in less than a minute',
          style: TextStyle(
            color: Color(0xFF888888),
            fontFamily: 'Gilroy_Medium',
            fontSize: 14,
          ),
        ),
      ],
    );
  }

  // ── Field builder helpers ─────────────────────────────────────────────────
  Widget _premiumField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
    bool obscure = false,
    Widget? suffixWidget,
    Widget? prefixExtra,
    String? error,
    List<TextInputFormatter>? formatters,
    bool readOnly = false,
    VoidCallback? onTap,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: onTap,
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: error != null
                    ? Colors.red.shade300
                    : const Color(0xFFE0E0E0),
                width: 1.2,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: Icon(icon,
                      color: error != null
                          ? Colors.red.shade400
                          : const Color(0xFF999999),
                      size: 20),
                ),
                if (prefixExtra != null) prefixExtra,
                Expanded(
                  child: readOnly
                      ? Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: Text(
                            controller.text.isEmpty
                                ? hint
                                : controller.text,
                            style: TextStyle(
                              color: controller.text.isEmpty
                                  ? const Color(0xFFBBBBBB)
                                  : const Color(0xFF1A1A1A),
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 15,
                            ),
                          ),
                        )
                      : TextFormField(
                          controller: controller,
                          keyboardType: keyboardType,
                          obscureText: obscure,
                          readOnly: readOnly,
                          inputFormatters: formatters,
                          style: const TextStyle(
                            color: Color(0xFF1A1A1A),
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 15,
                          ),
                          decoration: InputDecoration(
                            hintText: hint,
                            hintStyle: const TextStyle(
                              color: Color(0xFFBBBBBB),
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 15,
                            ),
                            border: InputBorder.none,
                            contentPadding:
                                const EdgeInsets.symmetric(vertical: 16),
                          ),
                          onTap: onTap,
                        ),
                ),
                if (suffixWidget != null) suffixWidget,
              ],
            ),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 5),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              error,
              style: TextStyle(
                color: Colors.red.shade500,
                fontFamily: 'Gilroy_Medium',
                fontSize: 12,
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _fieldLabel(String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF1A1A1A),
          fontFamily: 'Gilroy_Bold',
          fontSize: 13.5,
        ),
      ),
    );
  }

  // ── Full Name ─────────────────────────────────────────────────────────────
  Widget _buildFullNameField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fieldLabel('Full Name'),
        _premiumField(
          controller: fullName,
          hint: 'Enter your full name',
          icon: Icons.person_outline_rounded,
          keyboardType: TextInputType.name,
          error: _nameError,
        ),
      ],
    );
  }

  // ── Mobile ────────────────────────────────────────────────────────────────
  Widget _buildMobileField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fieldLabel('Mobile Number'),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: _numberError != null
                  ? Colors.red.shade300
                  : const Color(0xFFE0E0E0),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            children: [
              // Flag + code prefix
              Container(
                margin: const EdgeInsets.only(left: 12, right: 0),
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                decoration: BoxDecoration(
                  border: Border(
                    right: const BorderSide(
                      color: Color(0xFFE0E0E0),
                      width: 1.2,
                    ),
                  ),
                ),
                child: Row(
                  children: [
                    // India flag emoji
                    const Text('🇮🇳', style: TextStyle(fontSize: 18)),
                    const SizedBox(width: 6),
                    Text(
                      '+91',
                      style: TextStyle(
                        color: const Color(0xFF1A1A1A),
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(Icons.keyboard_arrow_down_rounded,
                        size: 18, color: Color(0xFF999999)),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextFormField(
                  controller: number,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  maxLength: 10,
                  style: const TextStyle(
                    color: Color(0xFF1A1A1A),
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 15,
                  ),
                  decoration: const InputDecoration(
                    hintText: 'Enter mobile number',
                    hintStyle: TextStyle(
                      color: Color(0xFFBBBBBB),
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 15,
                    ),
                    border: InputBorder.none,
                    counterText: '',
                    contentPadding: EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_numberError != null) ...[
          const SizedBox(height: 5),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              _numberError!,
              style: TextStyle(
                color: Colors.red.shade500,
                fontFamily: 'Gilroy_Medium',
                fontSize: 12,
              ),
            ),
          ),
        ],
      ],
    );
  }

  // ── Email (Optional) ──────────────────────────────────────────────────────
  Widget _buildEmailField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _fieldLabel('Email'),
            const SizedBox(width: 6),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFF0F0F0),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'Optional',
                style: TextStyle(
                  color: Color(0xFF888888),
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ),
        _premiumField(
          controller: email,
          hint: 'Enter your email address',
          icon: Icons.mail_outline_rounded,
          keyboardType: TextInputType.emailAddress,
          error: _emailError,
        ),
      ],
    );
  }

  // ── City ──────────────────────────────────────────────────────────────────
  Widget _buildCityField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fieldLabel('City'),
        GestureDetector(
          onTap: cityList.isEmpty && !isCityLoading ? null : _showCitySheet,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: _cityError != null
                    ? Colors.red.shade300
                    : const Color(0xFFE0E0E0),
                width: 1.2,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Icon(
                  Icons.location_city_outlined,
                  color: _cityError != null
                      ? Colors.red.shade400
                      : const Color(0xFF999999),
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: isCityLoading
                      ? SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: linercolor,
                          ),
                        )
                      : Text(
                          selectedCity?.title ?? 'Select your city',
                          style: TextStyle(
                            color: selectedCity != null
                                ? const Color(0xFF1A1A1A)
                                : const Color(0xFFBBBBBB),
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 15,
                          ),
                        ),
                ),
                const Icon(Icons.keyboard_arrow_down_rounded,
                    size: 20, color: Color(0xFF999999)),
              ],
            ),
          ),
        ),
        if (_cityError != null) ...[
          const SizedBox(height: 5),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              _cityError!,
              style: TextStyle(
                color: Colors.red.shade500,
                fontFamily: 'Gilroy_Medium',
                fontSize: 12,
              ),
            ),
          ),
        ],
      ],
    );
  }

  // ── Referral Code (collapsible) ───────────────────────────────────────────
  Widget _buildReferralSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => setState(() => _referralVisible = !_referralVisible),
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                  color: const Color(0xFFE0E0E0), width: 1.2),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Icon(Icons.local_offer_outlined,
                    color: const Color(0xFF999999), size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    referralCode.text.isEmpty
                        ? 'Have a referral code?'
                        : referralCode.text,
                    style: TextStyle(
                      color: referralCode.text.isEmpty
                          ? const Color(0xFFBBBBBB)
                          : const Color(0xFF1A1A1A),
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 15,
                    ),
                  ),
                ),
                AnimatedRotation(
                  turns: _referralVisible ? 0.5 : 0,
                  duration: const Duration(milliseconds: 250),
                  child: const Icon(Icons.keyboard_arrow_down_rounded,
                      size: 20, color: Color(0xFF999999)),
                ),
              ],
            ),
          ),
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeInOut,
          child: _referralVisible
              ? Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: TextFormField(
                    controller: referralCode,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(
                      color: Color(0xFF1A1A1A),
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 15,
                      letterSpacing: 1.5,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Enter referral code',
                      hintStyle: const TextStyle(
                        color: Color(0xFFBBBBBB),
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 15,
                        letterSpacing: 0,
                      ),
                      prefixIcon: Icon(Icons.local_offer_outlined,
                          color: linercolor, size: 20),
                      filled: true,
                      fillColor: linercolor.withOpacity(0.05),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide:
                            BorderSide(color: linercolor.withOpacity(0.3)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide:
                            BorderSide(color: linercolor.withOpacity(0.3)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(color: linercolor, width: 1.5),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 14),
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                )
              : const SizedBox.shrink(),
        ),
      ],
    );
  }

  // ── Terms row ─────────────────────────────────────────────────────────────
  Widget _buildTermsRow() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 24,
          height: 24,
          child: Checkbox(
            value: _termsAccepted,
            activeColor: linercolor,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
            side: const BorderSide(
                color: Color(0xFFCCCCCC), width: 1.5),
            onChanged: (v) => setState(() => _termsAccepted = v ?? false),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: RichText(
            text: TextSpan(
              text: 'I agree to the ',
              style: const TextStyle(
                color: Color(0xFF555555),
                fontFamily: 'Gilroy_Medium',
                fontSize: 13,
              ),
              children: [
                TextSpan(
                  text: 'Terms & Conditions',
                  style: TextStyle(
                    color: linercolor,
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13,
                    decoration: TextDecoration.underline,
                  ),
                  recognizer: TapGestureRecognizer()
                    ..onTap = () => _showWebViewDialog(
                        'https://shifteronline.com/terms_conditions.php',
                        'Terms & Conditions'),
                ),
                const TextSpan(text: ' and '),
                TextSpan(
                  text: 'Privacy Policy',
                  style: TextStyle(
                    color: linercolor,
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13,
                    decoration: TextDecoration.underline,
                  ),
                  recognizer: TapGestureRecognizer()
                    ..onTap = () => _showWebViewDialog(
                        'https://shifteronline.com/privacy_policy.php',
                        'Privacy Policy'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ── CTA Button ────────────────────────────────────────────────────────────
  Widget _buildCTAButton() {
    final bool canSubmit = fullName.text.trim().isNotEmpty &&
        number.text.trim().length >= 6 &&
        selectedCity != null &&
        _termsAccepted;

    return AnimatedOpacity(
      opacity: canSubmit ? 1.0 : 0.55,
      duration: const Duration(milliseconds: 200),
      child: GestureDetector(
        onTap: isLoading ? null : _handleCreateAccount,
        child: Container(
          width: double.infinity,
          height: 54,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                const Color(0xFFFF6B35),
                const Color(0xFFFA4500),
              ],
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
            ),
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: linercolor.withOpacity(0.35),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Center(
            child: isLoading
                ? const SpinKitThreeBounce(color: Colors.white, size: 22)
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Text(
                        'Create Account',
                        style: TextStyle(
                          color: Colors.white,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 16,
                          letterSpacing: 0.3,
                        ),
                      ),
                      SizedBox(width: 8),
                      Icon(Icons.arrow_forward_rounded,
                          color: Colors.white, size: 20),
                    ],
                  ),
          ),
        ),
      ),
    );
  }

  // ── Sign In row ───────────────────────────────────────────────────────────
  Widget _buildSignInRow() {
    return Center(
      child: RichText(
        textAlign: TextAlign.center,
        text: TextSpan(
          text: 'Already have an account? ',
          style: const TextStyle(
            color: Color(0xFF888888),
            fontFamily: 'Gilroy_Medium',
            fontSize: 14,
          ),
          children: [
            TextSpan(
              text: 'Sign In',
              style: TextStyle(
                color: linercolor,
                fontFamily: 'Gilroy_Bold',
                fontSize: 14,
              ),
              recognizer: TapGestureRecognizer()
                ..onTap = () {
                  if (widget.type == 'onboarding') {
                    Get.offAll(SignIn(paymenttype: widget.type));
                  } else {
                    Get.back();
                  }
                },
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// City Selector Bottom Sheet
// ─────────────────────────────────────────────────────────────────────────────
class _CitySheet extends StatefulWidget {
  final List<CityModel> cityList;
  final bool isLoading;
  final void Function(CityModel) onSelect;

  const _CitySheet({
    required this.cityList,
    required this.isLoading,
    required this.onSelect,
  });

  @override
  State<_CitySheet> createState() => _CitySheetState();
}

class _CitySheetState extends State<_CitySheet> {
  final TextEditingController _search = TextEditingController();
  List<CityModel> _filtered = [];

  @override
  void initState() {
    super.initState();
    _filtered = widget.cityList;
    _search.addListener(() {
      final q = _search.text.toLowerCase();
      setState(() {
        _filtered = widget.cityList
            .where((c) => c.title.toLowerCase().contains(q))
            .toList();
      });
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad  = MediaQuery.of(context).padding.bottom;
    final keyboardH  = MediaQuery.of(context).viewInsets.bottom;

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
            // Handle bar
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFDDDDDD),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Select your city',
              style: TextStyle(
                color: Color(0xFF1A1A1A),
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 16),
            // Search bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TextField(
                controller: _search,
                style: const TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 14,
                  color: Color(0xFF1A1A1A),
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
                  fillColor: const Color(0xFFF7F7F7),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                ),
              ),
            ),
            const SizedBox(height: 8),
            // City list — SizedBox with calculated height so it never
            // overflows past the screen edges
            if (widget.isLoading)
              const Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(),
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
                  // 55% of screen, minus bottom safe area and keyboard
                  maxHeight: (MediaQuery.of(context).size.height * 0.55) -
                      bottomPad -
                      keyboardH,
                ),
                child: ListView.separated(
                  shrinkWrap: true,
                  padding: EdgeInsets.fromLTRB(20, 4, 20, bottomPad + 16),
                  itemCount: _filtered.length,
                  separatorBuilder: (_, __) =>
                      const Divider(height: 1, color: Color(0xFFF0F0F0)),
                  itemBuilder: (ctx, i) {
                    final city = _filtered[i];
                    return InkWell(
                      onTap: () {
                        widget.onSelect(city);
                        Navigator.pop(ctx);
                      },
                      borderRadius: BorderRadius.circular(10),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 4, vertical: 14),
                        child: Row(
                          children: [
                            Icon(Icons.location_on_outlined,
                                color: linercolor, size: 18),
                            const SizedBox(width: 12),
                            Text(
                              city.title,
                              style: const TextStyle(
                                color: Color(0xFF1A1A1A),
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP Bottom Sheet  (inline — replaces Verification screen navigation)
// ─────────────────────────────────────────────────────────────────────────────
class _OtpBottomSheet extends StatefulWidget {
  final String mobile;
  final String ccode;
  final String sentOtp;
  final String name;
  final String emailVal;
  final String cityId;
  final String refferalCode;
  final String? ptype;
  final Future<String?> Function() onResend;

  const _OtpBottomSheet({
    required this.mobile,
    required this.ccode,
    required this.sentOtp,
    required this.name,
    required this.emailVal,
    required this.cityId,
    required this.refferalCode,
    required this.ptype,
    required this.onResend,
  });

  @override
  State<_OtpBottomSheet> createState() => _OtpBottomSheetState();
}

class _OtpBottomSheetState extends State<_OtpBottomSheet> with CodeAutoFill {
  late OTPTextEditController _otpCtrl;
  late OTPInteractor _otpInteractor;

  Timer? _timer;
  int _countdown = 24;
  bool _canResend = false;
  bool _isVerifying = false;

  @override
  void codeUpdated() {
    if (code != null && code!.length == 6 && mounted) {
      _otpCtrl.setText(code!);
      _autoVerify();
    }
  }

  @override
  void initState() {
    super.initState();
    _initOtp();
    _startTimer();
  }

  void _initOtp() {
    listenForCode();
    _otpInteractor = OTPInteractor();
    _otpInteractor
        .getAppSignature()
        .then((v) => debugPrint('OTP signature: $v'));

    _otpCtrl = OTPTextEditController(
      codeLength: 6,
      onCodeReceive: (code) => debugPrint('Received OTP: $code'),
      otpInteractor: _otpInteractor,
    )..startListenUserConsent(
        (code) {
          final exp = RegExp(r'(\d{6})');
          return exp.stringMatch(code ?? '') ?? '';
        },
        strategies: [_OtpStrategy()],
      );
  }

  void _startTimer() {
    _countdown = 24;
    _canResend = false;
    const tick = Duration(seconds: 1);
    _timer = Timer.periodic(tick, (t) {
      if (!mounted) { t.cancel(); return; }
      if (_countdown == 0) {
        setState(() => _canResend = true);
        t.cancel();
      } else {
        setState(() => _countdown--);
      }
    });
  }

  @override
  Future<void> dispose() async {
    await _otpCtrl.stopListen();
    cancel();
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _autoVerify() async {
    await Future.delayed(const Duration(milliseconds: 300));
    if (mounted && _otpCtrl.text.length == 6) _verify();
  }

  Future<void> _verify() async {
    if (_isVerifying) return;
    FocusScope.of(context).unfocus();
    if (_otpCtrl.text.length < 6) {
      tostmsg('Please enter the 6-digit OTP');
      return;
    }
    setState(() => _isVerifying = true);

    final body = {
      'mobile': widget.mobile,
      'otp': _otpCtrl.text,
    };
    final val = await ApiWrapper.dataPostNode(Config.nodeVerifyOtp, body);

    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      // OTP verified — now register
      if (!mounted) return;
      await singUpApi(
        context,
        name:         widget.name,
        email:        widget.emailVal,
        ccode:        widget.ccode,
        mobile:       widget.mobile,
        password:     '',
        ptype:        widget.ptype,
        cityId:       widget.cityId,
        refferalCode: widget.refferalCode,
      );
      if (mounted) Navigator.pop(context); // close OTP sheet
    } else {
      tostmsg(val != null && val['ResponseMsg'] != null
          ? val['ResponseMsg'].toString()
          : 'Invalid OTP. Please try again.');
      setState(() => _isVerifying = false);
    }
  }

  Future<void> _resend() async {
    if (!_canResend) return;
    setState(() { _canResend = false; _countdown = 24; });
    _otpCtrl.clear();
    final newOtp = await widget.onResend();
    if (newOtp != null) {
      _initOtp();
      _startTimer();
    }
  }

  @override
  Widget build(BuildContext context) {
    final maskedPhone =
        '${widget.ccode} ${widget.mobile.replaceRange(2, widget.mobile.length - 2, '*' * (widget.mobile.length - 4))}';

    final defaultPin = PinTheme(
      width: 50,
      height: 56,
      textStyle: const TextStyle(
        fontSize: 22,
        color: Color(0xFF1A1A1A),
        fontFamily: 'Gilroy_Bold',
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F7),
        border: Border.all(color: const Color(0xFFE0E0E0), width: 1.2),
        borderRadius: BorderRadius.circular(12),
      ),
    );

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 28,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: const Color(0xFFDDDDDD),
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header row
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Verify your number',
                      style: TextStyle(
                        color: Color(0xFF1A1A1A),
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 20,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'We sent a 6-digit OTP to',
                      style: const TextStyle(
                        color: Color(0xFF888888),
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 13,
                      ),
                    ),
                    Row(
                      children: [
                        Text(
                          maskedPhone,
                          style: const TextStyle(
                            color: Color(0xFF1A1A1A),
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(width: 6),
                        GestureDetector(
                          onTap: () => Navigator.pop(context),
                          child: Icon(Icons.edit_outlined,
                              color: linercolor, size: 16),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF5F5F5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.close_rounded,
                      size: 18, color: Color(0xFF555555)),
                ),
              ),
            ],
          ),

          const SizedBox(height: 28),

          // OTP Pinput
          Pinput(
            length: 6,
            controller: _otpCtrl,
            defaultPinTheme: defaultPin,
            focusedPinTheme: defaultPin.copyDecorationWith(
              border: Border.all(color: linercolor, width: 1.8),
              color: linercolor.withOpacity(0.04),
            ),
            submittedPinTheme: defaultPin.copyDecorationWith(
              border: Border.all(color: linercolor, width: 1.5),
              color: linercolor.withOpacity(0.07),
            ),
            hapticFeedbackType: HapticFeedbackType.lightImpact,
            onCompleted: (_) => _autoVerify(),
          ),

          const SizedBox(height: 20),

          // Resend row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                "Didn't receive OTP?",
                style: TextStyle(
                  color: Color(0xFF888888),
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 13,
                ),
              ),
              GestureDetector(
                onTap: _canResend ? _resend : null,
                child: Text(
                  _canResend
                      ? 'Resend OTP'
                      : 'Resend in ${_countdown}s',
                  style: TextStyle(
                    color: _canResend ? linercolor : const Color(0xFF999999),
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 28),

          // Verify button
          GestureDetector(
            onTap: _isVerifying ? null : _verify,
            child: Container(
              width: double.infinity,
              height: 54,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    const Color(0xFFFF6B35),
                    const Color(0xFFFA4500),
                  ],
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: linercolor.withOpacity(0.35),
                    blurRadius: 14,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: Center(
                child: _isVerifying
                    ? const SpinKitThreeBounce(color: Colors.white, size: 22)
                    : const Text(
                        'Verify & Create Account',
                        style: TextStyle(
                          color: Colors.white,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 16,
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Simple OTP strategy required by otp_autofill
class _OtpStrategy extends OTPStrategy {
  @override
  Future<String> listenForCode() {
    return Future.delayed(
      const Duration(seconds: 25),
      () => '',
    );
  }
}
