// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:get/get.dart';
import 'package:pinput/pinput.dart';
import 'package:provider/provider.dart';
import 'package:sms_autofill/sms_autofill.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import 'signin.dart';
import 'verification.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Design Tokens (Single source of truth for the UI)
// ─────────────────────────────────────────────────────────────────────────────
class _Tokens {
  // Brand
  static const Color primary       = Color(0xFFFA4500);
  static const Color primaryLight  = Color(0xFFFF6B35);
  static const Color primaryBg     = Color(0xFFFFF4EE);
  static const Color primaryBorder = Color(0xFFFFCDB8);

  // Neutrals
  static const Color textPrimary   = Color(0xFF1A1A1A);
  static const Color textSecondary = Color(0xFF777777);
  static const Color textMuted     = Color(0xFFAAAAAA);
  static const Color border        = Color(0xFFE8E8E8);
  static const Color inputFill     = Color(0xFFFAFAFA);

  // Success
  static const Color successBg     = Color(0xFFF0FDF4);
  static const Color successBorder = Color(0xFFDCFCE7);
  static const Color successText   = Color(0xFF15803D);
  static const Color successIcon   = Color(0xFF16A34A);

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

// ─────────────────────────────────────────────────────────────────────────────
// SignUp Widget — 3-Step Modern Onboarding Flow
// ─────────────────────────────────────────────────────────────────────────────
class SignUp extends StatefulWidget {
  final String? type;
  final bool? showBackbutton;
  const SignUp({super.key, this.type, this.showBackbutton});

  @override
  State<SignUp> createState() => _SignUpState();
}

class _SignUpState extends State<SignUp> with CodeAutoFill {
  late final PageController _pageController;
  int _currentStep = 0;

  // ── Controllers ────────────────────────────────────────────────────────────
  final TextEditingController number       = TextEditingController();
  final TextEditingController fullName     = TextEditingController();
  final TextEditingController email        = TextEditingController();
  final TextEditingController referralCode = TextEditingController();
  final TextEditingController _otpCtrl     = TextEditingController(); // Replaced with standard controller for sms_autofill

  // Focus nodes for focus-aware borders
  final FocusNode _mobileFocus  = FocusNode();
  final FocusNode _nameFocus    = FocusNode();
  final FocusNode _emailFocus   = FocusNode();
  final FocusNode _referralFocus = FocusNode();

  // ── OTP State ──────────────────────────────────────────────────────────────
  Timer? _timer;
  int _countdown   = 24;
  bool _canResend  = false;
  bool _isVerifying = false;

  // ── Form State ─────────────────────────────────────────────────────────────
  final String dropdownvalue = '+91';
  bool _termsAccepted       = false;
  bool _referralExpanded    = false;
  bool _isMobileChecking    = false;
  bool _isCreatingAccount   = false;

  String? _numberError;
  String? _nameError;
  String? _emailError;
  String? _cityError;

  // ── City Data ──────────────────────────────────────────────────────────────
  List<CityModel> cityList = [];
  CityModel? selectedCity;
  bool isCityLoading       = false;

  late ColorNotifier notifier;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _fetchCities();
    // Start listening for OTP using sms_autofill
    listenForCode();
  }

  @override
  void codeUpdated() {
    if (code != null && code!.isNotEmpty && mounted && _currentStep == 1) {
      _otpCtrl.text = code!;
      _autoVerify();
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    cancel(); // Cancel sms_autofill listener
    _timer?.cancel();
    number.dispose();
    fullName.dispose();
    email.dispose();
    referralCode.dispose();
    _otpCtrl.dispose();
    _mobileFocus.dispose();
    _nameFocus.dispose();
    _emailFocus.dispose();
    _referralFocus.dispose();
    super.dispose();
  }

  // ── Page Navigation ────────────────────────────────────────────────────────
  void _goToPage(int page) {
    FocusScope.of(context).unfocus();
    setState(() => _currentStep = page);
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeInOutCubic,
    );
  }

  Future<bool> _handlePop() async {
    if (_currentStep > 0) {
      _goToPage(_currentStep - 1);
      return false;
    }
    return true;
  }

  // ── Cities API ─────────────────────────────────────────────────────────────
  Future<void> _fetchCities() async {
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

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 0: Continue Mobile Action
  // ─────────────────────────────────────────────────────────────────────────
  Future<void> _handleMobileContinue() async {
    FocusScope.of(context).unfocus();
    final trimmed = number.text.trim();
    if (trimmed.isEmpty) {
      setState(() => _numberError = 'Please enter your mobile number');
      return;
    }
    if (trimmed.length != 10 || !RegExp(r'^[6-9][0-9]{9}$').hasMatch(trimmed)) {
      setState(() => _numberError = 'Enter a valid 10-digit mobile number');
      return;
    }
    setState(() {
      _numberError = null;
      _isMobileChecking = true;
    });

    final checkBody = {'mobile': trimmed, 'ccode': dropdownvalue};
    final val = await ApiWrapper.dataPostNode(Config.nodeMobileCheck, checkBody);

    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      await _sendOtp();
    } else {
      tostmsg(val?['ResponseMsg']?.toString() ?? 'Mobile check failed');
    }
    setState(() => _isMobileChecking = false);
  }

  Future<void> _sendOtp() async {
    final body = {'mobile': dropdownvalue + number.text.trim()};
    final val  = await ApiWrapper.dataPostNode(Config.nodeSendOtp, body);
    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      _startOtpTimer();
      _goToPage(1);
    } else {
      tostmsg(val?['ResponseMsg']?.toString() ?? 'Failed to send OTP');
    }
  }

  void _startOtpTimer() {
    _timer?.cancel();
    setState(() {
      _countdown = 24;
      _canResend  = false;
    });
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      if (_countdown == 0) {
        setState(() => _canResend = true);
        t.cancel();
      } else {
        setState(() => _countdown--);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Verify OTP Action
  // ─────────────────────────────────────────────────────────────────────────
  Future<void> _autoVerify() async {
    await Future.delayed(const Duration(milliseconds: 250));
    if (mounted && _otpCtrl.text.length == 6) _handleVerifyOtp();
  }

  Future<void> _handleVerifyOtp() async {
    if (_isVerifying) return;
    FocusScope.of(context).unfocus();
    if (_otpCtrl.text.length < 6) {
      tostmsg('Please enter the 6-digit OTP');
      return;
    }
    setState(() => _isVerifying = true);

    final body = {
      'mobile': number.text.trim(),
      'otp': _otpCtrl.text.trim(),
    };
    final val = await ApiWrapper.dataPostNode(Config.nodeVerifyOtp, body);

    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      setState(() => _isVerifying = false);
      _goToPage(2);
    } else {
      tostmsg(val?['ResponseMsg']?.toString() ?? 'Invalid OTP. Please try again.');
      setState(() => _isVerifying = false);
    }
  }

  Future<void> _handleResendOtp() async {
    if (!_canResend) return;
    _otpCtrl.clear();
    final body = {'mobile': dropdownvalue + number.text.trim()};
    final val  = await ApiWrapper.dataPostNode(Config.nodeSendOtp, body);
    if (val != null &&
        val['ResponseCode'] == '200' &&
        val['Result'] == 'true') {
      tostmsg('OTP resent successfully');
      _startOtpTimer();
    } else {
      tostmsg(val?['ResponseMsg']?.toString() ?? 'Failed to resend OTP');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Create Account Action
  // ─────────────────────────────────────────────────────────────────────────
  bool _validateProfile() {
    bool ok = true;
    _nameError  = null;
    _emailError = null;
    _cityError  = null;

    if (fullName.text.trim().isEmpty) {
      _nameError = 'Please enter your full name';
      ok = false;
    }
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

  Future<void> _handleCreateAccount() async {
    FocusScope.of(context).unfocus();
    if (!_validateProfile()) return;

    setState(() => _isCreatingAccount = true);
    await singUpApi(
      context,
      name:         fullName.text.trim(),
      email:        email.text.trim(),
      ccode:        dropdownvalue,
      mobile:       number.text.trim(),
      password:     '',
      cityId:       selectedCity?.id ?? '',
      refferalCode: referralCode.text.trim(),
      ptype:        widget.type,
    );
    if (mounted) setState(() => _isCreatingAccount = false);
  }

  // ── Web View Dialog ────────────────────────────────────────────────────────
  void _showWebViewDialog(String url, String title) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        height: MediaQuery.of(ctx).size.height * 0.88,
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
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
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 16,
                        color: _Tokens.textPrimary,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: WebViewWidget(
                controller: WebViewController()
                  ..setJavaScriptMode(JavaScriptMode.unrestricted)
                  ..loadRequest(Uri.parse(url)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── City Bottom Sheet ──────────────────────────────────────────────────────
  void _showCitySheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withOpacity(0.4),
      builder: (_) => _CitySheet(
        cityList:  cityList,
        isLoading: isCityLoading,
        onSelect:  (city) {
          setState(() {
            selectedCity = city;
            _cityError   = null;
          });
        },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN BUILD
  // ─────────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return PopScope(
      canPop: _currentStep == 0,
      onPopInvoked: (didPop) {
        if (!didPop) _handlePop();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFFAFAFA),
        resizeToAvoidBottomInset: true,
        body: SafeArea(
          child: Column(
            children: [
              // Persistent Step Progress Indicator
              _StepProgress(current: _currentStep),
              Expanded(
                child: PageView(
                  controller: _pageController,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    _buildStep0Welcome(),
                    _buildStep1VerifyOtp(),
                    _buildStep2ProfileDetails(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCREEN 1: Welcome & Mobile Entry
  // ─────────────────────────────────────────────────────────────────────────
  Widget _buildStep0Welcome() {
    return Column(
      children: [
        // Removed back button completely, just keeping the Login button on the right
        Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: const EdgeInsets.only(top: 8, right: 16, bottom: 4),
            child: GestureDetector(
              onTap: () => Get.offAll(() => SignIn()),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: _Tokens.primaryBg,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: _Tokens.primaryBorder, width: 1),
                ),
                child: const Text(
                  'Login',
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13.5,
                    color: _Tokens.primary,
                  ),
                ),
              ),
            ),
          ),
        ),

        Expanded(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: _Tokens.pad),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 8),

                // Hero Section
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      flex: 4,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Increased Logo Size here
                          Image.asset(
                            'assets/logo1.png',
                            height: 48, 
                            fit: BoxFit.contain,
                            alignment: Alignment.centerLeft,
                          ),
                          const SizedBox(height: 14),
                          const Text(
                            'Welcome to\nShifter Online 👋',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 23,
                              color: _Tokens.textPrimary,
                              height: 1.25,
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Anything you want,\nDelivered locally.',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 13,
                              color: _Tokens.textSecondary,
                              height: 1.4,
                            ),
                          ),
                          const SizedBox(height: 16),
                          _featureBadge(Icons.local_shipping_rounded, 'Fast & Reliable'),
                          const SizedBox(height: 8),
                          _featureBadge(Icons.shield_outlined, 'Safe & Secure'),
                          const SizedBox(height: 8),
                          _featureBadge(Icons.location_on_outlined, 'Your Local Partner'),
                        ],
                      ),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      flex: 5,
                      child: Image.asset(
                        'assets/delivery_mascot.jpg',
                        height: 255,
                        fit: BoxFit.contain,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 24),

                // Elevated Input Card
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(_Tokens.radius + 6),
                    boxShadow: _Tokens.soft,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Enter your mobile number\nto get started',
                        style: TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15.5,
                          color: _Tokens.textPrimary,
                          height: 1.3,
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Mobile Input — Focus-aware
                      _MobileInput(
                        controller: number,
                        focusNode: _mobileFocus,
                        error: _numberError,
                        onChanged: (_) {
                          if (_numberError != null) {
                            setState(() => _numberError = null);
                          }
                        },
                      ),

                      const SizedBox(height: 18),

                      // Continue CTA
                      _PrimaryCta(
                        label: 'Continue',
                        icon: Icons.arrow_forward_rounded,
                        loading: _isMobileChecking,
                        onTap: _handleMobileContinue,
                      ),

                      const SizedBox(height: 16),

                      // Terms
                      Center(
                        child: RichText(
                          textAlign: TextAlign.center,
                          text: TextSpan(
                            text: 'By continuing, you agree to our\n',
                            style: const TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 11,
                              color: _Tokens.textSecondary,
                              height: 1.35,
                            ),
                            children: [
                              TextSpan(
                                text: 'Terms and Conditions',
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  color: _Tokens.primary,
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
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  color: _Tokens.primary,
                                  decoration: TextDecoration.underline,
                                ),
                                recognizer: TapGestureRecognizer()
                                  ..onTap = () => _showWebViewDialog(
                                      'https://shifteronline.com/privacy_policy.php',
                                      'Privacy Policy'),
                              ),
                              const TextSpan(text: '.'),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // Footer graphic
                ClipRRect(
                  borderRadius: BorderRadius.circular(_Tokens.radius),
                  child: Image.asset(
                    'assets/delivery_van_footer.jpg',
                    height: 76,
                    width: double.infinity,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 8),
                const Center(
                  child: Text(
                    'Support Local  •  Move Together  •  Grow Together',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 10.5,
                      color: _Tokens.textMuted,
                    ),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _featureBadge(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: _Tokens.primaryBg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: _Tokens.primaryLight),
          const SizedBox(width: 6),
          Text(
            text,
            style: const TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 11.5,
              color: Color(0xFF444444),
            ),
          ),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCREEN 2: Verify Your Number (OTP)
  // ─────────────────────────────────────────────────────────────────────────
  Widget _buildStep1VerifyOtp() {
    final defaultPin = PinTheme(
      width: 48,
      height: 52,
      textStyle: const TextStyle(
        fontSize: 22,
        fontFamily: 'Gilroy_Bold',
        color: _Tokens.textPrimary,
      ),
      decoration: BoxDecoration(
        color: _Tokens.inputFill,
        borderRadius: BorderRadius.circular(_Tokens.radiusSm),
        border: Border.all(color: _Tokens.border, width: 1.2),
      ),
    );

    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: _Tokens.pad),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const SizedBox(height: 20),

          // OTP illustration card with subtle gradient bg
          Container(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 22),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  _Tokens.primaryBg,
                  Colors.white,
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Image.asset(
              'assets/otp_illustration.jpg',
              height: 130,
              fit: BoxFit.contain,
            ),
          ),

          const SizedBox(height: 18),

          const Text(
            'Verify your number',
            style: TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 23,
              color: _Tokens.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'We have sent a 6-digit OTP to',
            style: TextStyle(
              fontFamily: 'Gilroy_Medium',
              fontSize: 13.5,
              color: _Tokens.textSecondary,
            ),
          ),
          const SizedBox(height: 4),

          // Phone number + Edit pencil
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                '+91 ${number.text.trim()}',
                style: const TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 15,
                  color: _Tokens.textPrimary,
                ),
              ),
              const SizedBox(width: 6),
              GestureDetector(
                onTap: () => _goToPage(0),
                child: const Icon(
                  Icons.edit_outlined,
                  size: 16,
                  color: _Tokens.primary,
                ),
              ),
            ],
          ),

          const SizedBox(height: 28),

          Pinput(
            length: 6,
            controller: _otpCtrl,
            defaultPinTheme: defaultPin,
            focusedPinTheme: defaultPin.copyDecorationWith(
              border: Border.all(color: _Tokens.primaryLight, width: 1.8),
              color: Colors.white,
            ),
            submittedPinTheme: defaultPin.copyDecorationWith(
              border: Border.all(color: _Tokens.primary, width: 1.5),
              color: _Tokens.primaryBg,
            ),
            hapticFeedbackType: HapticFeedbackType.lightImpact,
            onCompleted: (_) => _autoVerify(),
          ),

          const SizedBox(height: 22),

          // Resend row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                "Didn't receive OTP?",
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 13,
                  color: _Tokens.textSecondary,
                ),
              ),
              GestureDetector(
                onTap: _canResend ? _handleResendOtp : null,
                child: Text(
                  _canResend ? 'Resend OTP' : 'Resend in ${_countdown}s',
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13,
                    color: _canResend
                        ? _Tokens.primary
                        : _Tokens.textMuted,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 28),

          _PrimaryCta(
            label: 'Verify & Continue',
            loading: _isVerifying,
            onTap: _handleVerifyOtp,
          ),

          const SizedBox(height: 24),

          // Trust Badge Card
          _TrustBadge(
            icon: Icons.shield_rounded,
            title: 'Your number is safe with us',
            subtitle: 'We use secure encryption to protect your information.',
            iconBg: _Tokens.successBorder,
            iconColor: _Tokens.successIcon,
            bgColor: _Tokens.successBg,
            borderColor: _Tokens.successBorder,
            titleColor: _Tokens.successText,
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCREEN 3: Profile Details
  // ─────────────────────────────────────────────────────────────────────────
  Widget _buildStep2ProfileDetails() {
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: _Tokens.pad),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 20),
          
          // 3D Avatar + Heading (compact hero card)
          Container(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  _Tokens.primaryBg,
                  Colors.white,
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: const [
                          Text(
                            'Almost there! ',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 22,
                              color: _Tokens.textPrimary,
                            ),
                          ),
                          Text('🎉', style: TextStyle(fontSize: 20)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Tell us a little about yourself\nto complete your account.',
                        style: TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 13,
                          color: _Tokens.textSecondary,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                Image.asset(
                  'assets/profile_illustration.jpg',
                  height: 95,
                  fit: BoxFit.contain,
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),

          // Grouped form card
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(_Tokens.radius + 6),
              boxShadow: _Tokens.soft,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Full Name
                _fieldLabel('Full Name'),
                _inputBox(
                  controller: fullName,
                  hint: 'Enter your full name',
                  icon: Icons.person_outline_rounded,
                  focusNode: _nameFocus,
                  error: _nameError,
                ),

                const SizedBox(height: 14),

                // Email (Optional)
                _fieldLabel('Email (Optional)'),
                _inputBox(
                  controller: email,
                  hint: 'Enter your email address',
                  icon: Icons.mail_outline_rounded,
                  keyboardType: TextInputType.emailAddress,
                  focusNode: _emailFocus,
                  error: _emailError,
                ),

                const SizedBox(height: 14),

                // City
                _fieldLabel('City'),
                _CitySelector(
                  selectedCity: selectedCity,
                  error: _cityError,
                  onTap: _showCitySheet,
                ),

                const SizedBox(height: 14),

                // Referral accordion
                _ReferralAccordion(
                  expanded: _referralExpanded,
                  controller: referralCode,
                  focusNode: _referralFocus,
                  onToggle: () => setState(
                      () => _referralExpanded = !_referralExpanded),
                ),
              ],
            ),
          ),

          const SizedBox(height: 18),

          // Terms Checkbox
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            decoration: BoxDecoration(
              color: _Tokens.inputFill,
              borderRadius: BorderRadius.circular(_Tokens.radiusSm),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                SizedBox(
                  width: 22,
                  height: 22,
                  child: Checkbox(
                    value: _termsAccepted,
                    activeColor: _Tokens.primary,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(5)),
                    side: const BorderSide(
                        color: Color(0xFFCCCCCC), width: 1.5),
                    onChanged: (v) =>
                        setState(() => _termsAccepted = v ?? false),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: RichText(
                    text: TextSpan(
                      text: 'I agree to the ',
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 12.5,
                        color: Color(0xFF444444),
                      ),
                      children: [
                        TextSpan(
                          text: 'Terms and Conditions',
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            color: _Tokens.primary,
                          ),
                          recognizer: TapGestureRecognizer()
                            ..onTap = () => _showWebViewDialog(
                                'https://shifteronline.com/terms_conditions.php',
                                'Terms & Conditions'),
                        ),
                        const TextSpan(text: ' and '),
                        TextSpan(
                          text: 'Privacy Policy',
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            color: _Tokens.primary,
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
            ),
          ),

          const SizedBox(height: 20),

          _PrimaryCta(
            label: 'Create Account',
            icon: Icons.arrow_forward_rounded,
            loading: _isCreatingAccount,
            onTap: _handleCreateAccount,
          ),

          const SizedBox(height: 16),

          Center(
            child: RichText(
              text: TextSpan(
                text: 'Already have an account? ',
                style: const TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 14,
                  color: _Tokens.textSecondary,
                ),
                children: [
                  TextSpan(
                    text: 'Sign In',
                    style: const TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      color: _Tokens.primary,
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
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _fieldLabel(String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        label,
        style: const TextStyle(
          fontFamily: 'Gilroy_Bold',
          fontSize: 13.5,
          color: _Tokens.textPrimary,
        ),
      ),
    );
  }

  Widget _inputBox({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
    String? error,
    required FocusNode focusNode,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AnimatedBuilder(
          animation: focusNode,
          builder: (ctx, _) {
            final focused = focusNode.hasFocus;
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: focused ? _Tokens.primaryBg : _Tokens.inputFill,
                borderRadius: BorderRadius.circular(_Tokens.radiusSm),
                border: Border.all(
                  color: error != null
                      ? Colors.red.shade400
                      : focused
                          ? _Tokens.primaryLight
                          : _Tokens.border,
                  width: focused ? 1.5 : 1.2,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    icon,
                    size: 20,
                    color: focused ? _Tokens.primary : const Color(0xFF888888),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: controller,
                      keyboardType: keyboardType,
                      focusNode: focusNode,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 14.5,
                        color: _Tokens.textPrimary,
                      ),
                      decoration: InputDecoration(
                        hintText: hint,
                        hintStyle: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 14,
                          color: Color(0xFFBBBBBB),
                        ),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
        if (error != null) ...[
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              error,
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
// STEP PROGRESS INDICATOR (3 steps) - Fixed word wrap issue
// ─────────────────────────────────────────────────────────────────────────────
class _StepProgress extends StatelessWidget {
  final int current;
  const _StepProgress({required this.current});

  @override
  Widget build(BuildContext context) {
    const steps = ['Mobile', 'Verify', 'Profile'];
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          for (int i = 0; i < steps.length; i++) ...[
            // Step Item (Circle + Text)
            Row(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    color: i <= current ? _Tokens.primary : const Color(0xFFEEEEEE),
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: i < current
                        ? const Icon(Icons.check_rounded,
                            color: Colors.white, size: 16)
                        : Text(
                            '${i + 1}',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 12,
                              color: i == current ? Colors.white : const Color(0xFF999999),
                            ),
                          ),
                  ),
                ),
                const SizedBox(width: 8),
                // Prevented word wrap by removing Expanded and setting fixed flexible constraints
                Text(
                  steps[i],
                  style: TextStyle(
                    fontFamily: i == current ? 'Gilroy_Bold' : 'Gilroy_Medium',
                    fontSize: 12,
                    color: i == current ? _Tokens.textPrimary : _Tokens.textMuted,
                  ),
                ),
              ],
            ),
            // Dynamic Divider
            if (i < steps.length - 1)
              Expanded(
                child: Container(
                  height: 2,
                  margin: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: i < current ? _Tokens.primary : const Color(0xFFEEEEEE),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY CTA (Scale-on-tap + loading)
// ─────────────────────────────────────────────────────────────────────────────
class _PrimaryCta extends StatefulWidget {
  final String label;
  final IconData? icon;
  final bool loading;
  final VoidCallback onTap;

  const _PrimaryCta({
    required this.label,
    this.icon,
    required this.loading,
    required this.onTap,
  });

  @override
  State<_PrimaryCta> createState() => _PrimaryCtaState();
}

class _PrimaryCtaState extends State<_PrimaryCta> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) {
        setState(() => _pressed = false);
        if (!widget.loading) widget.onTap();
      },
      onTapCancel: () => setState(() => _pressed = false),
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1.0,
        duration: const Duration(milliseconds: 120),
        child: Container(
          width: double.infinity,
          height: 54,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [_Tokens.primaryLight, _Tokens.primary],
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
            ),
            borderRadius: BorderRadius.circular(14),
            boxShadow: _Tokens.cta,
          ),
          child: Center(
            child: widget.loading
                ? const SpinKitThreeBounce(color: Colors.white, size: 20)
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        widget.label,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 16,
                          color: Colors.white,
                        ),
                      ),
                      if (widget.icon != null) ...[
                        const SizedBox(width: 8),
                        Icon(widget.icon, size: 18, color: Colors.white),
                      ],
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE INPUT (Focus-aware with country code)
// ─────────────────────────────────────────────────────────────────────────────
class _MobileInput extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final String? error;
  final ValueChanged<String> onChanged;

  const _MobileInput({
    required this.controller,
    required this.focusNode,
    required this.error,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AnimatedBuilder(
          animation: focusNode,
          builder: (ctx, _) {
            final focused = focusNode.hasFocus;
            return Container(
              decoration: BoxDecoration(
                color: focused ? _Tokens.primaryBg : _Tokens.inputFill,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: error != null
                      ? Colors.red.shade400
                      : focused
                          ? _Tokens.primaryLight
                          : _Tokens.border,
                  width: focused ? 1.5 : 1.2,
                ),
              ),
              child: Row(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 14),
                    child: Row(
                      children: const [
                        Text('🇮🇳', style: TextStyle(fontSize: 18)),
                        SizedBox(width: 6),
                        Text(
                          '+91',
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 15,
                            color: _Tokens.textPrimary,
                          ),
                        ),
                        SizedBox(width: 4),
                        Icon(Icons.keyboard_arrow_down_rounded,
                            size: 18, color: Color(0xFF888888)),
                      ],
                    ),
                  ),
                  Container(
                    height: 24,
                    width: 1,
                    color: _Tokens.border,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Focus(
                      focusNode: focusNode,
                      child: TextFormField(
                        controller: controller,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly
                        ],
                        maxLength: 10,
                        onChanged: onChanged,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 15,
                          color: _Tokens.textPrimary,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Enter mobile number',
                          hintStyle: TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 14,
                            color: Color(0xFFBBBBBB),
                          ),
                          border: InputBorder.none,
                          counterText: '',
                          contentPadding:
                              EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
        if (error != null) ...[
          const SizedBox(height: 5),
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
// CITY SELECTOR TRIGGER
// ─────────────────────────────────────────────────────────────────────────────
class _CitySelector extends StatelessWidget {
  final CityModel? selectedCity;
  final String? error;
  final VoidCallback onTap;

  const _CitySelector({
    required this.selectedCity,
    required this.error,
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
              color: _Tokens.inputFill,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: error != null
                    ? Colors.red.shade400
                    : _Tokens.border,
                width: 1.2,
              ),
            ),
            child: Row(
              children: [
                Icon(Icons.location_city_rounded,
                    size: 20,
                    color: selectedCity != null
                        ? _Tokens.primary
                        : const Color(0xFF888888)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    selectedCity?.title ?? 'Select your city',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 14.5,
                      color: selectedCity != null
                          ? _Tokens.textPrimary
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
class _ReferralAccordion extends StatelessWidget {
  final bool expanded;
  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onToggle;

  const _ReferralAccordion({
    required this.expanded,
    required this.controller,
    required this.focusNode,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _Tokens.inputFill,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _Tokens.border),
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
                      size: 18, color: _Tokens.textSecondary),
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
                    color: _Tokens.textSecondary,
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
                        border: Border.all(color: _Tokens.border),
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
// TRUST BADGE
// ─────────────────────────────────────────────────────────────────────────────
class _TrustBadge extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color iconBg;
  final Color iconColor;
  final Color bgColor;
  final Color borderColor;
  final Color titleColor;

  const _TrustBadge({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.iconBg,
    required this.iconColor,
    required this.bgColor,
    required this.borderColor,
    required this.titleColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: iconBg,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: iconColor, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13,
                    color: titleColor,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 11.5,
                    color: Color(0xFF4B5563),
                  ),
                ),
              ],
            ),
          ),
        ],
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
  final ValueChanged<CityModel> onSelect;

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
  void didUpdateWidget(covariant _CitySheet oldWidget) {
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
                color: _Tokens.textPrimary,
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
                  color: _Tokens.textPrimary,
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
                  fillColor: _Tokens.inputFill,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(
                        color: _Tokens.primaryLight, width: 1.5),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                ),
              ),
            ),
            const SizedBox(height: 8),

            if (widget.isLoading)
              const Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(color: _Tokens.primary),
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
                          color: _Tokens.primaryBg,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.location_city_rounded,
                            size: 18, color: _Tokens.primary),
                      ),
                      title: Text(
                        city.title,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 15,
                          color: _Tokens.textPrimary,
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
          ],
        ),
      ),
    );
  }
}