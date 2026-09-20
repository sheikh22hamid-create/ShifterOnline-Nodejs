// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:developer';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:get/get.dart';
import 'package:goParcel/auth_firebase.dart';
import 'package:goParcel/main.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:onesignal_flutter/onesignal_flutter.dart';
import 'package:otp_autofill/otp_autofill.dart';
import 'package:pinput/pinput.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sms_autofill/sms_autofill.dart';
import 'package:get_storage/get_storage.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../bottombar.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../../utils/node_socket_manager.dart';
import 'signup.dart';

// ─────────────────────────────────────────────────────────────────────────────
// SignIn — Modern OTP-based login (2-step: Mobile → Verify OTP)
// ─────────────────────────────────────────────────────────────────────────────
class SignIn extends StatefulWidget {
  final String? paymenttype;
  final String? type;
  const SignIn({super.key, this.paymenttype, this.type});

  @override
  State<SignIn> createState() => _SignInState();
}

class _SignInState extends State<SignIn> with CodeAutoFill {
  late final PageController _pageController;
  int _currentStep = 0; // 0 = Mobile entry, 1 = OTP verification
  ColorNotifier notifier = ColorNotifier();
  final getdata = GetStorage();

  // ── Controllers ─────────────────────────────────────────────────────────────
  final TextEditingController number = TextEditingController();
  late OTPTextEditController _otpCtrl;
  late OTPInteractor _otpInteractor;

  // ── State ────────────────────────────────────────────────────────────────────
  bool _isSendingOtp = false;
  bool _isVerifying  = false;
  bool _otpAutoFilled = false;
  String? _numberError;

  Timer? _timer;
  int  _countdown  = 24;
  bool _canResend  = false;

  FirebaseAuthService authService = FirebaseAuthService();

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _initOtp();
    _initializeFCM();
    _setDarkMode();
  }

  void _initOtp() {
    listenForCode();
    _otpInteractor = OTPInteractor();
    _otpCtrl = OTPTextEditController(
      codeLength: 6,
      onCodeReceive: (code) {
        debugPrint('OTP received: $code');
        if (mounted) setState(() => _otpAutoFilled = true);
      },
      otpInteractor: _otpInteractor,
    )..startListenUserConsent((code) {
        final exp = RegExp(r'(\d{6})');
        final match = exp.stringMatch(code ?? '') ?? '';
        if (match.isNotEmpty && mounted) {
          setState(() => _otpAutoFilled = true);
        }
        return match;
      });
  }

  @override
  void codeUpdated() {
    if (code != null && code!.length == 6) {
      _otpCtrl.text = code!;
      if (mounted) setState(() => _otpAutoFilled = true);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pageController.dispose();
    number.dispose();
    _otpCtrl.dispose();
    cancel();
    super.dispose();
  }

  // ── FCM ──────────────────────────────────────────────────────────────────────
  Future<void> _initializeFCM() async {
    try {
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true, badge: true, sound: true, provisional: false,
      );
      if (settings.authorizationStatus == AuthorizationStatus.authorized) {
        final token = await FirebaseMessaging.instance.getToken();
        if (token != null) fcmToken = token;
        FirebaseMessaging.instance.onTokenRefresh.listen((t) => fcmToken = t);
        FirebaseMessaging.onMessage.listen(_showLocalNotification);
      }
    } catch (e) {
      debugPrint('FCM init error: $e');
    }
  }

  void _showLocalNotification(RemoteMessage message) {
    if (message.notification != null) {
      Get.snackbar(
        message.notification!.title ?? 'Notification',
        message.notification!.body ?? '',
        snackPosition: SnackPosition.TOP,
        duration: const Duration(seconds: 3),
        backgroundColor: Colors.black87,
        colorText: Colors.white,
      );
    }
  }

  Future<void> _setDarkMode() async {
    final prefs = await SharedPreferences.getInstance();
    notifier.setIsDark = prefs.getBool('isDark');
  }

  // ── WebView ──────────────────────────────────────────────────────────────────
  void _showWebViewDialog(String url, String title) {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadRequest(Uri.parse(url));
    showDialog(
      context: context,
      builder: (_) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(15),
          child: SizedBox(
            height: Get.height * 0.8,
            width: Get.width * 0.9,
            child: Column(
              children: [
                AppBar(
                  title: Text(title,
                      style: const TextStyle(fontSize: 16, fontFamily: 'Gilroy_Bold', color: Colors.black)),
                  backgroundColor: Colors.white,
                  elevation: 0,
                  iconTheme: const IconThemeData(color: Colors.black),
                  leading: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(context),
                  ),
                ),
                Expanded(child: WebViewWidget(controller: controller)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── OTP Timer ─────────────────────────────────────────────────────────────────
  void _startTimer() {
    _countdown = 24;
    _canResend  = false;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_countdown == 0) {
        t.cancel();
        setState(() => _canResend = true);
      } else {
        setState(() => _countdown--);
      }
    });
  }

  // ── Step 0: Send OTP ──────────────────────────────────────────────────────────
  Future<void> _handleContinue() async {
    final mobile = number.text.trim();
    if (mobile.isEmpty) {
      setState(() => _numberError = 'Please enter your mobile number');
      return;
    }
    if (!RegExp(r'^[6-9][0-9]{9}$').hasMatch(mobile)) {
      setState(() => _numberError = 'Enter a valid 10-digit mobile number');
      return;
    }
    setState(() { _numberError = null; _isSendingOtp = true; });

    // Send OTP
    final otpRes = await ApiWrapper.dataPostNode(
      Config.nodeSendOtp,
      {'mobile': mobile},
    );
    if (!mounted) return;
    setState(() => _isSendingOtp = false);

    if (otpRes == null || otpRes['Result'] != 'true') {
      setState(() => _numberError = otpRes?['ResponseMsg'] ?? 'Failed to send OTP');
      return;
    }

    _startTimer();
    _pageController.nextPage(
      duration: const Duration(milliseconds: 420),
      curve: Curves.easeInOut,
    );
    setState(() => _currentStep = 1);
  }

  // ── Step 1: Verify OTP + Login ────────────────────────────────────────────────
  Future<void> _handleVerifyOtp() async {
    final otp    = _otpCtrl.text.trim();
    final mobile = number.text.trim();
    if (otp.length < 6) {
      ApiWrapper.showToastMessage('Please enter the 6-digit OTP');
      return;
    }
    setState(() => _isVerifying = true);

    // Step A – verify OTP
    final verifyRes = await ApiWrapper.dataPostNode(
      Config.nodeVerifyOtp,
      {'mobile': mobile, 'otp': otp, 'device_id': await getDeviceId()},
    );
    if (!mounted) return;
    if (verifyRes == null || verifyRes['Result'] != 'true') {
      setState(() => _isVerifying = false);
      ApiWrapper.showToastMessage(verifyRes?['ResponseMsg'] ?? 'Invalid OTP');
      return;
    }

    // Step B – login by OTP (no password required)
    if (fcmToken.isEmpty) {
      try {
        final t = await FirebaseMessaging.instance.getToken();
        if (t != null) fcmToken = t;
      } catch (_) {}
    }
    final String deviceId = await getDeviceId();
    final loginRes = await ApiWrapper.dataPostNode(Config.nodeLoginByOtp, {
      'mobile'    : mobile,
      'ccode'     : '+91',
      'fcm_token' : fcmToken.isNotEmpty ? fcmToken : '',
      'device_id' : deviceId,
    });
    if (!mounted) return;
    setState(() => _isVerifying = false);

    if (loginRes == null || loginRes['Result'] != 'true') {
      // User doesn't exist → redirect to signup
      ApiWrapper.showToastMessage(
          loginRes?['ResponseMsg'] ?? 'Account not found. Please create an account.');
      Get.off(() => SignUp(type: widget.paymenttype));
      return;
    }

    // ── Save session (identical to old handelSignIN) ──────────────────────────
    log(loginRes.toString(), name: 'loginByOtp');
    getdata.remove('UserLogin');
    save('Uid', loginRes['UserLogin']['id'].toString());
    NodeSocketManager.instance
        .connectCustomer(int.tryParse(loginRes['UserLogin']['id'].toString()) ?? 0);

    initPlatformState();
    OneSignal.User.addTags({'userid': '${loginRes["UserLogin"]["id"]}'});

    save('UserLogin', loginRes['UserLogin']);
    save('firstLogin', true);

    authService.singInAndStoreData(
      name     : getdata.read('UserLogin')['name'],
      uid      : getdata.read('UserLogin')['id'].toString(),
      proPicPath: getdata.read('UserLogin')['r_img'] ?? '',
    );

    tostmsg(loginRes['ResponseMsg']);

    if (widget.paymenttype == 'payment' || widget.paymenttype == 'BuyAnything') {
      Get.back();
    } else {
      Get.offAll(() => const Bottombar());
    }
  }

  // ── Resend OTP ────────────────────────────────────────────────────────────────
  Future<void> _handleResend() async {
    if (!_canResend) return;
    final otpRes = await ApiWrapper.dataPostNode(
      Config.nodeSendOtp,
      {'mobile': number.text.trim()},
    );
    if (!mounted) return;
    if (otpRes?['Result'] == 'true') {
      _otpCtrl.text = '';
      _startTimer();
    }
    ApiWrapper.showToastMessage(otpRes?['ResponseMsg'] ?? 'OTP resent');
  }

  // ── Pop handling ──────────────────────────────────────────────────────────────
  void _handlePop() {
    if (_currentStep == 1) {
      _timer?.cancel();
      _pageController.previousPage(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
      setState(() => _currentStep = 0);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return PopScope(
      canPop: _currentStep == 0,
      onPopInvoked: (didPop) { if (!didPop) _handlePop(); },
      child: Scaffold(
        backgroundColor: Colors.white,
        resizeToAvoidBottomInset: true,
        body: PageView(
          controller: _pageController,
          physics: const NeverScrollableScrollPhysics(),
          children: [
            _buildStep0MobileEntry(),
            _buildStep1OtpVerify(),
          ],
        ),
      ),
    );
  }

   // ─────────────────────────────────────────────────────────────────────────────
  // STEP 0 — Mobile Entry (Perfect UI & Fixed Scroll)
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildStep0MobileEntry() {
    return SafeArea(
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        // viewInsets.bottom yahan use nahi kar rahe, Scaffold khud handle kar raha hai
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minHeight: Get.height - MediaQuery.of(context).padding.top - MediaQuery.of(context).padding.bottom,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Orange Hero Section ──────────────────────────────────────────────
              Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFFFF6B35), Color(0xFFFA4500)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Top row: logo
                      Row(
                        children: [
                          // Logo pill
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(20),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withOpacity(0.08),
                                  blurRadius: 4,
                                  offset: const Offset(0, 1),
                                ),
                              ],
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(6),
                                  child: Image.asset(
                                    'assets/logo1.png',
                                    height: 26,
                                    width: 26,
                                    fit: BoxFit.cover,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: const [
                                    Text(
                                      'Shifter Online',
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Bold',
                                        fontSize: 13.5,
                                        color: Color(0xFF1A1A1A),
                                        height: 1.1,
                                      ),
                                    ),
                                    Text(
                                      'Delivery Made Simple',
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 8.5,
                                        color: Color(0xFF777777),
                                        height: 1.1,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 14),

                      // Hero content: text left + mascot right
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          // Left: text
                          Expanded(
                            flex: 5,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Enjoy Delivery\nexperience with\nShifter Online.',
                                  style: TextStyle(
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 22,
                                    color: Colors.white,
                                    height: 1.25,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'Anything you want,\nDelivered locally.',
                                  style: TextStyle(
                                    fontFamily: 'Gilroy_Medium',
                                    fontSize: 13,
                                    color: Colors.white70,
                                    height: 1.4,
                                  ),
                                ),
                                const SizedBox(height: 16),
                                // Icon badges row
                                Row(
                                  children: [
                                    _heroBadge(Icons.local_shipping_rounded, 'Fast'),
                                    const SizedBox(width: 12),
                                    _heroBadge(Icons.shield_outlined, 'Safe'),
                                    const SizedBox(width: 12),
                                    _heroBadge(Icons.location_on_outlined, 'Local'),
                                  ],
                                ),
                                const SizedBox(height: 20),
                              ],
                            ),
                          ),
                          // Right: mascot
                          Expanded(
                            flex: 4,
                            child: ClipRRect(
                              borderRadius: const BorderRadius.only(
                                topLeft: Radius.circular(16),
                                topRight: Radius.circular(16),
                              ),
                              child: Image.asset(
                                'assets/signin_hero_mascot.jpg',
                                height: Get.height * 0.22, // 👈 Dynamic height for perfect fit
                                fit: BoxFit.cover,
                                alignment: Alignment.topCenter,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              // ── White Card Section ───────────────────────────────────────────────
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(28),
                    topRight: Radius.circular(28),
                  ),
                  boxShadow: [ // 👈 Elevated premium shadow
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 10,
                      offset: const Offset(0, -4),
                    ),
                  ],
                ),
                padding: const EdgeInsets.only(
                  left: 20,
                  right: 20,
                  top: 24,
                  bottom: 40,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Orange accent line
                    Container(
                      width: 36,
                      height: 3,
                      decoration: BoxDecoration(
                        color: const Color(0xFFFA4500),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Heading
                    const Text(
                      'Welcome Back 👋',
                      style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 26,
                        color: Color(0xFF1A1A1A),
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Sign in to continue to Shifter Online',
                      style: TextStyle(
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 13.5,
                        color: Color(0xFF888888),
                      ),
                    ),
                    const SizedBox(height: 22),

                    // Mobile Number label
                    const Text(
                      'Mobile Number',
                      style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 13.5,
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Phone input
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
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
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
                          Container(width: 1, height: 24, color: const Color(0xFFE0E0E0)),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              controller: number,
                              autofocus: true, // 👈 Auto-open keyboard
                              keyboardType: TextInputType.number,
                              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                              maxLength: 10,
                              onChanged: (_) {
                                setState(() { // 👈 setState to update button color
                                  if (_numberError != null) {
                                    _numberError = null;
                                  }
                                });
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
                                contentPadding: EdgeInsets.symmetric(vertical: 14),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    if (_numberError != null) ...[
                      const SizedBox(height: 5),
                      Text(
                        _numberError!,
                        style: TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 12,
                          color: Colors.red.shade500,
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),

                    // Continue button (Smart Disabled State)
                    GestureDetector(
                      onTap: (number.text.length == 10 && !_isSendingOtp) ? _handleContinue : null,
                      child: Container(
                        width: double.infinity,
                        height: 54,
                        decoration: BoxDecoration(
                          // 👈 If 10 digits, Orange gradient. Else, Grey gradient.
                          gradient: number.text.length == 10
                              ? const LinearGradient(
                                  colors: [Color(0xFFFF6B35), Color(0xFFFA4500)],
                                  begin: Alignment.centerLeft,
                                  end: Alignment.centerRight,
                                )
                              : const LinearGradient(
                                  colors: [Color(0xFFE0E0E0), Color(0xFFCCCCCC)],
                                  begin: Alignment.centerLeft,
                                  end: Alignment.centerRight,
                                ),
                          borderRadius: BorderRadius.circular(14),
                          boxShadow: number.text.length == 10 // 👈 Shadow only when active
                              ? [
                                  BoxShadow(
                                    color: const Color(0xFFFF642F).withOpacity(0.35),
                                    blurRadius: 14,
                                    offset: const Offset(0, 5),
                                  ),
                                ]
                              : [],
                        ),
                        child: Center(
                          child: _isSendingOtp
                              ? const SpinKitThreeBounce(color: Colors.white, size: 20)
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
                          text: 'By continuing, you agree to our ',
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 11.5,
                            color: Color(0xFF888888),
                          ),
                          children: [
                            TextSpan(
                              text: 'Terms and Conditions',
                              style: const TextStyle(
                                color: Color(0xFFFA4500),
                                fontFamily: 'Gilroy_Bold',
                                decoration: TextDecoration.underline,
                                decorationColor: Color(0xFFFA4500),
                              ),
                              recognizer: TapGestureRecognizer()
                                ..onTap = () => _showWebViewDialog(
                                      'https://shifteronline.com/terms_conditions.php',
                                      'Terms and Conditions'),
                            ),
                            const TextSpan(text: ' and '),
                            TextSpan(
                              text: 'Privacy Policy',
                              style: const TextStyle(
                                color: Color(0xFFFA4500),
                                fontFamily: 'Gilroy_Bold',
                                decoration: TextDecoration.underline,
                                decorationColor: Color(0xFFFA4500),
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

                    const SizedBox(height: 22),

                    // OR divider
                    Row(
                      children: [
                        const Expanded(child: Divider(color: Color(0xFFE8E8E8), thickness: 1)),
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 12),
                          child: Text(
                            'OR',
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 12,
                              color: Color(0xFFAAAAAA),
                            ),
                          ),
                        ),
                        const Expanded(child: Divider(color: Color(0xFFE8E8E8), thickness: 1)),
                      ],
                    ),

                    const SizedBox(height: 18),

                    // Create Account link
                    Center(
                      child: RichText(
                        text: TextSpan(
                          text: 'New to Shifter Online? ',
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 14,
                            color: Color(0xFF666666),
                          ),
                          children: [
                            TextSpan(
                              text: 'Create Account',
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 14,
                                color: Color(0xFFFA4500),
                              ),
                              recognizer: TapGestureRecognizer()
                                ..onTap = () => Get.to(() => SignUp(type: widget.paymenttype)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1 — OTP Verification (reference right screen)
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildStep1OtpVerify() {
    return SafeArea(
      child: Column(
        children: [
          // Top: back + logo
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                GestureDetector(
                  onTap: _handlePop,
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
                const SizedBox(width: 12),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: Image.asset(
                        'assets/logo1.png',
                        height: 28,
                        width: 28,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: const [
                        Text(
                          'Shifter Online',
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 14,
                            color: Color(0xFF1A1A1A),
                            height: 1.1,
                          ),
                        ),
                        Text(
                          'Delivery Made Simple',
                          style: TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 9,
                            color: Color(0xFF777777),
                            height: 1.1,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),

          Expanded(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const SizedBox(height: 20),

                  // OTP Illustration
                  Image.asset(
                    'assets/otp_illustration.jpg',
                    height: 180,
                    fit: BoxFit.contain,
                  ),

                  const SizedBox(height: 28),

                  // Heading
                  const Text(
                    'Verify your number',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 24,
                      color: Color(0xFF1A1A1A),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'We have sent a 6-digit OTP to',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 13.5,
                      color: Color(0xFF888888),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '+91 ${number.text}',
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15,
                          color: Color(0xFF1A1A1A),
                        ),
                      ),
                      const SizedBox(width: 6),
                      GestureDetector(
                        onTap: _handlePop,
                        child: const Icon(Icons.edit_outlined,
                            size: 16, color: Color(0xFFFA4500)),
                      ),
                    ],
                  ),

                  const SizedBox(height: 30),

                  // Pinput OTP boxes
                  Pinput(
                    controller: _otpCtrl,
                    length: 6,
                    keyboardType: TextInputType.number,
                    defaultPinTheme: PinTheme(
                      width: 52,
                      height: 56,
                      textStyle: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 20,
                        color: Color(0xFF1A1A1A),
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFDDDDDD), width: 1.5),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.05),
                            blurRadius: 6,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                    ),
                    focusedPinTheme: PinTheme(
                      width: 52,
                      height: 56,
                      textStyle: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 20,
                        color: Color(0xFFFA4500),
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFFA4500), width: 2),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFFFA4500).withOpacity(0.12),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Auto-fill indicator banner matching reference mockup
                  if (_otpAutoFilled || _otpCtrl.text.length == 6) ...[
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8F7F0),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFBBE8D3)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(3),
                            decoration: const BoxDecoration(
                              color: Color(0xFF00A86B),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.check, size: 12, color: Colors.white),
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'OTP detected and filled automatically',
                              style: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 12.5,
                                color: Color(0xFF0B7B50),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const Icon(Icons.auto_awesome_rounded, size: 16, color: Color(0xFF00A86B)),
                        ],
                      ),
                    ),
                  ],

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
                          color: Color(0xFF888888),
                        ),
                      ),
                      GestureDetector(
                        onTap: _canResend ? _handleResend : null,
                        child: Text(
                          _canResend ? 'Resend OTP' : 'Resend in ${_countdown}s',
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 13,
                            color: _canResend
                                ? const Color(0xFFFA4500)
                                : const Color(0xFFAAAAAA),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 28),

                  // Verify & Continue button
                  GestureDetector(
                    onTap: _isVerifying ? null : _handleVerifyOtp,
                    child: Container(
                      width: double.infinity,
                      height: 54,
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
                            ? const SpinKitThreeBounce(color: Colors.white, size: 20)
                            : Row(
                                mainAxisSize: MainAxisSize.min,
                                children: const [
                                  Text(
                                    'Verify & Continue',
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

                  // Security note
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF7F7F7),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE8F5E9),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.lock_outline_rounded,
                              color: Color(0xFF43A047), size: 22),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Your number is safe with us',
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 13,
                                  color: Color(0xFF1A1A1A),
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'We use secure encryption to protect your information.',
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 11.5,
                                  color: Color(0xFF888888),
                                  height: 1.4,
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
            ),
          ),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hero badge widget (icon + label below in white circle)
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _heroBadge(IconData icon, String label) {
    return Column(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.22),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withOpacity(0.4), width: 1),
          ),
          child: Icon(icon, color: Colors.white, size: 22),
        ),
        const SizedBox(height: 5),
        Text(
          label,
          style: const TextStyle(
            fontFamily: 'Gilroy_Bold',
            fontSize: 11,
            color: Colors.white,
          ),
        ),
      ],
    );
  }
}