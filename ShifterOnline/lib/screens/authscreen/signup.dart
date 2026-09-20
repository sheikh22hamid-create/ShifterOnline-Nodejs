// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:get/get.dart';
import 'package:otp_autofill/otp_autofill.dart';
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
  int _currentStep = 0; // 0 = Welcome/Mobile, 1 = Verify OTP, 2 = Profile Details

  // ── Controllers ────────────────────────────────────────────────────────────
  final TextEditingController number       = TextEditingController();
  final TextEditingController fullName     = TextEditingController();
  final TextEditingController email        = TextEditingController();
  final TextEditingController referralCode = TextEditingController();

  // ── OTP State ──────────────────────────────────────────────────────────────
  late OTPTextEditController _otpCtrl;
  late OTPInteractor _otpInteractor;
  Timer? _timer;
  int _countdown   = 24;
  bool _canResend  = false;
  bool _isVerifying = false;

  // ── Form State ─────────────────────────────────────────────────────────────
  final String dropdownvalue = '+91';
  bool _termsAccepted       = true;
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
    _initOtpListener();
    _fetchCities();
  }

  void _initOtpListener() {
    listenForCode();
    _otpInteractor = OTPInteractor();
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

  @override
  void codeUpdated() {
    if (code != null && code!.length == 6 && mounted && _currentStep == 1) {
      _otpCtrl.setText(code!);
      _autoVerify();
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    _otpCtrl.stopListen();
    cancel();
    _timer?.cancel();
    number.dispose();
    fullName.dispose();
    email.dispose();
    referralCode.dispose();
    super.dispose();
  }

  // ── Page Navigation ────────────────────────────────────────────────────────
  void _goToPage(int page) {
    FocusScope.of(context).unfocus();
    setState(() => _currentStep = page);
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 350),
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
      // New number -> Send OTP and navigate to Step 1
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
      // OTP verified successfully -> Proceed to Step 2 (Profile Details)
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
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Container(
              margin: const EdgeInsets.only(top: 10),
              width: 36,
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
                        color: Color(0xFF1A1A1A),
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
        backgroundColor: Colors.white,
        resizeToAvoidBottomInset: true,
        body: SafeArea(
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
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCREEN 1: Welcome & Mobile Entry
  // ─────────────────────────────────────────────────────────────────────────
  Widget _buildStep0Welcome() {
    return Column(
      children: [
        // Top Nav: Back + Skip
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (widget.showBackbutton != false)
                GestureDetector(
                  onTap: () => Navigator.pop(context),
                  child: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFEEEEEE)),
                    ),
                    child: const Icon(Icons.arrow_back_rounded,
                        size: 20, color: Color(0xFF1A1A1A)),
                  ),
                )
              else
                const SizedBox(width: 40),
              GestureDetector(
                onTap: () => Get.offAll(() => SignIn()),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF3EE),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFFFCDB8), width: 1),
                  ),
                  child: const Text(
                    'Login',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 14,
                      color: Color(0xFFFA4500),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),

        // Scrollable content
        Expanded(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Brand logo
                Image.asset(
                  'assets/logo1.png',
                  height: 38,
                  fit: BoxFit.contain,
                  alignment: Alignment.centerLeft,
                ),

                const SizedBox(height: 16),

                // Hero Section: Text + Badges (Left) & Mascot (Right)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Welcome to\nShifter Online 👋',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 23,
                              color: Color(0xFF1A1A1A),
                              height: 1.25,
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Anything you want,\nDelivered locally.',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 14,
                              color: Color(0xFF777777),
                              height: 1.4,
                            ),
                          ),
                          const SizedBox(height: 16),
                          _featureBadge(Icons.local_shipping_rounded, 'Fast & Reliable'),
                          const SizedBox(height: 10),
                          _featureBadge(Icons.shield_outlined, 'Safe & Secure'),
                          const SizedBox(height: 10),
                          _featureBadge(Icons.location_on_outlined, 'Your Local Partner'),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 4,
                      child: Image.asset(
                        'assets/delivery_mascot.jpg',
                        height: 240,
                        fit: BoxFit.contain,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 24),

                // Elevated Input Card
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(22),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.06),
                        blurRadius: 18,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Enter your mobile number\nto get started',
                        style: TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15,
                          color: Color(0xFF1A1A1A),
                          height: 1.3,
                        ),
                      ),
                      const SizedBox(height: 14),

                      // Mobile Input
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFFFBFBFB),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: _numberError != null
                                ? Colors.red.shade400
                                : const Color(0xFFE2E2E2),
                            width: 1.2,
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
                                      color: Color(0xFF1A1A1A),
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
                              color: const Color(0xFFE0E0E0),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextFormField(
                                controller: number,
                                keyboardType: TextInputType.number,
                                inputFormatters: [
                                  FilteringTextInputFormatter.digitsOnly
                                ],
                                maxLength: 10,
                                onChanged: (_) {
                                  if (_numberError != null) {
                                    setState(() => _numberError = null);
                                  }
                                },
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 15,
                                  color: Color(0xFF1A1A1A),
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
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 12,
                              color: Colors.red.shade500,
                            ),
                          ),
                        ),
                      ],

                      const SizedBox(height: 16),

                      // Continue CTA Button
                      GestureDetector(
                        onTap: _isMobileChecking ? null : _handleMobileContinue,
                        child: Container(
                          width: double.infinity,
                          height: 52,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFFF6B35), Color(0xFFFA4500)],
                              begin: Alignment.centerLeft,
                              end: Alignment.centerRight,
                            ),
                            borderRadius: BorderRadius.circular(14),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFFFF642F).withOpacity(0.35),
                                blurRadius: 14,
                                offset: const Offset(0, 5),
                              ),
                            ],
                          ),
                          child: Center(
                            child: _isMobileChecking
                                ? const SpinKitThreeBounce(
                                    color: Colors.white, size: 20)
                                : Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: const [
                                      Text(
                                        'Continue',
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 16,
                                          color: Colors.white,
                                        ),
                                      ),
                                      SizedBox(width: 8),
                                      Icon(Icons.arrow_forward_rounded,
                                          size: 18, color: Colors.white),
                                    ],
                                  ),
                          ),
                        ),
                      ),

                      const SizedBox(height: 14),

                      // Terms disclaimer
                      Center(
                        child: RichText(
                          textAlign: TextAlign.center,
                          text: TextSpan(
                            text: 'By continuing, you agree to our\n',
                            style: const TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 11,
                              color: Color(0xFF888888),
                              height: 1.35,
                            ),
                            children: [
                              TextSpan(
                                text: 'Terms and Conditions',
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  color: Color(0xFFFF5722),
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
                                  color: Color(0xFFFF5722),
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

                const SizedBox(height: 18),

                // Delivery Van Footer Graphic
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.asset(
                    'assets/delivery_van_footer.jpg',
                    height: 78,
                    width: double.infinity,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 6),
                const Center(
                  child: Text(
                    'Support Local  •  Move Together  •  Grow Together',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 10.5,
                      color: Color(0xFF999999),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
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
        color: const Color(0xFFFFF4EE),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: const Color(0xFFFF642F)),
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
        color: Color(0xFF1A1A1A),
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF9F9F9),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E2E2), width: 1.2),
      ),
    );

    return Column(
      children: [
        // Top Nav: Back
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => _goToPage(0),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFEEEEEE)),
                  ),
                  child: const Icon(Icons.arrow_back_rounded,
                      size: 20, color: Color(0xFF1A1A1A)),
                ),
              ),
            ],
          ),
        ),

        Expanded(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const SizedBox(height: 8),

                // 3D OTP Illustration
                Image.asset(
                  'assets/otp_illustration.jpg',
                  height: 135,
                  fit: BoxFit.contain,
                ),

                const SizedBox(height: 16),

                const Text(
                  'Verify your number',
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 23,
                    color: Color(0xFF1A1A1A),
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'We have sent a 6-digit OTP to',
                  style: TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 13.5,
                    color: Color(0xFF777777),
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
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                    const SizedBox(width: 6),
                    GestureDetector(
                      onTap: () => _goToPage(0),
                      child: const Icon(
                        Icons.edit_outlined,
                        size: 16,
                        color: Color(0xFFFF5722),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 28),

                // 6-digit Pinput
                Pinput(
                  length: 6,
                  controller: _otpCtrl,
                  defaultPinTheme: defaultPin,
                  focusedPinTheme: defaultPin.copyDecorationWith(
                    border: Border.all(color: const Color(0xFFFF642F), width: 1.8),
                    color: const Color(0xFFFFF7F4),
                  ),
                  submittedPinTheme: defaultPin.copyDecorationWith(
                    border: Border.all(color: const Color(0xFFFF642F), width: 1.5),
                    color: const Color(0xFFFFF4EE),
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
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 13,
                        color: Color(0xFF777777),
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
                              ? const Color(0xFFFF5722)
                              : const Color(0xFF999999),
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 28),

                // Verify & Continue Button
                GestureDetector(
                  onTap: _isVerifying ? null : _handleVerifyOtp,
                  child: Container(
                    width: double.infinity,
                    height: 52,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFF6B35), Color(0xFFFA4500)],
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                      ),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFF642F).withOpacity(0.35),
                          blurRadius: 14,
                          offset: const Offset(0, 5),
                        ),
                      ],
                    ),
                    child: Center(
                      child: _isVerifying
                          ? const SpinKitThreeBounce(
                              color: Colors.white, size: 20)
                          : const Text(
                              'Verify & Continue',
                              style: TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 16,
                                color: Colors.white,
                              ),
                            ),
                    ),
                  ),
                ),

                const SizedBox(height: 36),

                // Trust Badge Card
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0FDF4),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFDCFCE7)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: const BoxDecoration(
                          color: Color(0xFFDCFCE7),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.shield_rounded,
                            color: Color(0xFF16A34A), size: 20),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: const [
                            Text(
                              'Your number is safe with us',
                              style: TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 13,
                                color: Color(0xFF15803D),
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'We use secure encryption to protect your information.',
                              style: TextStyle(
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
                ),

                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCREEN 3: Profile Details ("Almost there! 🎉")
  // ─────────────────────────────────────────────────────────────────────────
  Widget _buildStep2ProfileDetails() {
    return Column(
      children: [
        // Top Nav: Back
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => _goToPage(1),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFEEEEEE)),
                  ),
                  child: const Icon(Icons.arrow_back_rounded,
                      size: 20, color: Color(0xFF1A1A1A)),
                ),
              ),
            ],
          ),
        ),

        Expanded(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 22),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 3D Avatar Illustration
                Center(
                  child: Image.asset(
                    'assets/profile_illustration.jpg',
                    height: 115,
                    fit: BoxFit.contain,
                  ),
                ),
                const SizedBox(height: 12),

                // Heading & Subtitle
                Row(
                  children: const [
                    Text(
                      'Almost there! ',
                      style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 24,
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                    Text('🎉', style: TextStyle(fontSize: 22)),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Tell us a little about yourself\nto complete your account.',
                  style: TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 13.5,
                    color: Color(0xFF777777),
                    height: 1.35,
                  ),
                ),

                const SizedBox(height: 22),

                // Full Name
                _fieldLabel('Full Name'),
                _inputBox(
                  controller: fullName,
                  hint: 'Enter your full name',
                  icon: Icons.person_outline_rounded,
                  error: _nameError,
                ),

                const SizedBox(height: 16),

                // Email (Optional)
                _fieldLabel('Email (Optional)'),
                _inputBox(
                  controller: email,
                  hint: 'Enter your email address',
                  icon: Icons.mail_outline_rounded,
                  keyboardType: TextInputType.emailAddress,
                  error: _emailError,
                ),

                const SizedBox(height: 16),

                // City Selector
                _fieldLabel('City'),
                GestureDetector(
                  onTap: _showCitySheet,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: _cityError != null
                            ? Colors.red.shade400
                            : const Color(0xFFE2E2E2),
                        width: 1.2,
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.location_city_rounded,
                            size: 20, color: Color(0xFF888888)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            selectedCity?.title ?? 'Select your city',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Medium',
                              fontSize: 14.5,
                              color: selectedCity != null
                                  ? const Color(0xFF1A1A1A)
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
                if (_cityError != null) ...[
                  const SizedBox(height: 4),
                  Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: Text(
                      _cityError!,
                      style: TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 12,
                        color: Colors.red.shade500,
                      ),
                    ),
                  ),
                ],

                const SizedBox(height: 14),

                // Referral Code Accordion
                Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFFFBFBFB),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFEEEEEE)),
                  ),
                  child: Column(
                    children: [
                      GestureDetector(
                        onTap: () => setState(
                            () => _referralExpanded = !_referralExpanded),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 13),
                          child: Row(
                            children: [
                              const Icon(Icons.sell_outlined,
                                  size: 18, color: Color(0xFF777777)),
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
                                _referralExpanded
                                    ? Icons.keyboard_arrow_up_rounded
                                    : Icons.keyboard_arrow_down_rounded,
                                color: const Color(0xFF777777),
                                size: 20,
                              ),
                            ],
                          ),
                        ),
                      ),
                      AnimatedSize(
                        duration: const Duration(milliseconds: 250),
                        curve: Curves.easeInOut,
                        child: _referralExpanded
                            ? Padding(
                                padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                                child: Container(
                                  padding:
                                      const EdgeInsets.symmetric(horizontal: 12),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                        color: const Color(0xFFE2E2E2)),
                                  ),
                                  child: TextField(
                                    controller: referralCode,
                                    textCapitalization:
                                        TextCapitalization.characters,
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
                ),

                const SizedBox(height: 16),

                // Terms & Conditions Checkbox
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    SizedBox(
                      width: 24,
                      height: 24,
                      child: Checkbox(
                        value: _termsAccepted,
                        activeColor: const Color(0xFFFF5722),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(4)),
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
                                color: Color(0xFFFF5722),
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
                                color: Color(0xFFFF5722),
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

                const SizedBox(height: 24),

                // Create Account CTA Button
                GestureDetector(
                  onTap: _isCreatingAccount ? null : _handleCreateAccount,
                  child: Container(
                    width: double.infinity,
                    height: 52,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFF6B35), Color(0xFFFA4500)],
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                      ),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFF642F).withOpacity(0.35),
                          blurRadius: 14,
                          offset: const Offset(0, 5),
                        ),
                      ],
                    ),
                    child: Center(
                      child: _isCreatingAccount
                          ? const SpinKitThreeBounce(
                              color: Colors.white, size: 20)
                          : Row(
                              mainAxisSize: MainAxisSize.min,
                              children: const [
                                Text(
                                  'Create Account',
                                  style: TextStyle(
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 16,
                                    color: Colors.white,
                                  ),
                                ),
                                SizedBox(width: 8),
                                Icon(Icons.arrow_forward_rounded,
                                    size: 18, color: Colors.white),
                              ],
                            ),
                    ),
                  ),
                ),

                const SizedBox(height: 20),

                // Already have an account? Sign In
                Center(
                  child: RichText(
                    text: TextSpan(
                      text: 'Already have an account? ',
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 14,
                        color: Color(0xFF777777),
                      ),
                      children: [
                        TextSpan(
                          text: 'Sign In',
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            color: Color(0xFFFF5722),
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
          ),
        ),
      ],
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
          color: Color(0xFF1A1A1A),
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
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: error != null ? Colors.red.shade400 : const Color(0xFFE2E2E2),
              width: 1.2,
            ),
          ),
          child: Row(
            children: [
              Icon(icon, size: 20, color: const Color(0xFF888888)),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: controller,
                  keyboardType: keyboardType,
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 14.5,
                    color: Color(0xFF1A1A1A),
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
// City Selector Bottom Sheet (with Search & Keyboard-Safe Constraint)
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
  void didUpdateWidget(covariant _CitySheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.cityList != widget.cityList) {
      final q = _search.text.toLowerCase();
      setState(() {
        _filtered = widget.cityList
            .where((c) => c.title.toLowerCase().contains(q))
            .toList();
      });
    }
  }

  @override
  void dispose() {
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
            const SizedBox(height: 16),
            const Text(
              'Select your city',
              style: TextStyle(
                color: Color(0xFF1A1A1A),
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 14),

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

            // City list
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
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                      leading: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF4EE),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.location_city_rounded,
                            size: 18, color: Color(0xFFFF642F)),
                      ),
                      title: Text(
                        city.title,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 15,
                          color: Color(0xFF1A1A1A),
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

// ─────────────────────────────────────────────────────────────────────────────
// OTP Strategy for autofill
// ─────────────────────────────────────────────────────────────────────────────
class _OtpStrategy extends OTPStrategy {
  @override
  Future<String> listenForCode() {
    return Future.delayed(
      const Duration(seconds: 25),
      () => '',
    );
  }
}
