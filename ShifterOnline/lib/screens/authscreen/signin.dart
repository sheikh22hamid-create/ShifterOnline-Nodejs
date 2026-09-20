// ignore_for_file: deprecated_member_use, unused_local_variable

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
import 'widgets/delivery_login_hero.dart';

// ─────────────────────────────────────────────────────────────────────────────
// SignIn — Modern OTP-based login (2-step: Mobile → Verify OTP)
// Animated override sheet: tapping "Enter mobile number" slides the Welcome
// Back card all the way to the top, hiding the orange section behind it.
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

  // Focus & expansion state for sliding sheet over orange hero
  final FocusNode _numberFocus = FocusNode();
  bool _isWelcomeExpanded = false;

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

    number.addListener(() {
      if (mounted) setState(() {});
    });

    // Expand sheet smoothly when text field gains focus
    _numberFocus.addListener(() {
      if (_numberFocus.hasFocus && !_isWelcomeExpanded) {
        if (mounted) setState(() => _isWelcomeExpanded = true);
      }
    });
  }

  void _initOtp() {
    _otpInteractor = OTPInteractor();
    _otpCtrl = OTPTextEditController(
      codeLength: 6,
      onCodeReceive: (receivedCode) {
        debugPrint('OTPTextEditController onCodeReceive: $receivedCode');
        _applyExtractedOtp(receivedCode);
      },
      otpInteractor: _otpInteractor,
    );
  }

  /// Extracts 6 digits from any SMS text and fills the OTP input
  void _applyExtractedOtp(String rawText) {
    if (rawText.isEmpty) return;
    final exp = RegExp(r'\b\d{6}\b');
    final match = exp.stringMatch(rawText) ?? RegExp(r'\d{6}').stringMatch(rawText);
    if (match != null && match.length == 6) {
      debugPrint('Extracted 6-digit OTP: $match');
      _otpCtrl.text = match;
      if (mounted) {
        setState(() => _otpAutoFilled = true);
        Future.delayed(const Duration(milliseconds: 400), () {
          if (mounted && _otpCtrl.text.length == 6 && !_isVerifying && _currentStep == 1) {
            _handleVerifyOtp();
          }
        });
      }
    }
  }

  /// Actively starts SMS Retriever & SMS User Consent listeners when OTP is sent
  void _startListeningForOtp() {
    try {
      listenForCode();
    } catch (e) {
      debugPrint('SmsAutoFill listenForCode error: $e');
    }

    try {
      _otpCtrl.startListenUserConsent((smsBody) {
        debugPrint('startListenUserConsent incoming SMS: $smsBody');
        final exp = RegExp(r'\b\d{6}\b');
        final match = exp.stringMatch(smsBody ?? '') ?? RegExp(r'\d{6}').stringMatch(smsBody ?? '') ?? '';
        if (match.isNotEmpty) {
          _applyExtractedOtp(match);
        }
        return match;
      });
    } catch (e) {
      debugPrint('startListenUserConsent error: $e');
    }
  }

  @override
  void codeUpdated() {
    debugPrint('CodeAutoFill codeUpdated callback: $code');
    if (code != null && code!.isNotEmpty && mounted) {
      _applyExtractedOtp(code!);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pageController.dispose();
    number.dispose();
    _numberFocus.dispose();
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
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
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
        if (mounted) setState(() => _canResend = true);
      } else {
        if (mounted) setState(() => _countdown--);
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

    // Send OTP via backend
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

    _numberFocus.unfocus();
    setState(() => _isWelcomeExpanded = false);

    _startTimer();
    _startListeningForOtp();

    _pageController.nextPage(
      duration: const Duration(milliseconds: 400),
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

    final loginRes = await ApiWrapper.dataPostNode(
      Config.nodeLoginByOtp,
      {
        'mobile': mobile,
        'ccode': '+91',
        'fcm_token': fcmToken,
        'device_id': deviceId,
      },
    );
    if (!mounted) return;
    setState(() => _isVerifying = false);

    if (loginRes == null || loginRes['Result'] != 'true') {
      // User doesn't exist → redirect to signup
      ApiWrapper.showToastMessage(
          loginRes?['ResponseMsg'] ?? 'Account not found. Please create an account.');
      Get.off(() => SignUp(type: widget.paymenttype));
      return;
    }

    // ── Save session ──────────────────────────────────────────────────────────
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
      name     : loginRes['UserLogin']['name'] ?? '',
      uid      : loginRes['UserLogin']['id'].toString(),
      proPicPath: loginRes['UserLogin']['r_img'] ?? '',
    );

    tostmsg(loginRes['ResponseMsg'] ?? 'Login successful');

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
      setState(() => _otpAutoFilled = false);
      _startTimer();
      _startListeningForOtp();
    }
    ApiWrapper.showToastMessage(otpRes?['ResponseMsg'] ?? 'OTP resent');
  }

  // ── Pop handling ──────────────────────────────────────────────────────────────
  void _handlePop() {
    if (_isWelcomeExpanded) {
      _numberFocus.unfocus();
      setState(() => _isWelcomeExpanded = false);
      return;
    }
    if (_currentStep == 1) {
      _timer?.cancel();
      _pageController.previousPage(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
      setState(() {
        _currentStep = 0;
        _otpAutoFilled = false;
        _otpCtrl.clear();
      });
    } else if (Navigator.canPop(context)) {
      Get.back();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final bool isKeyboardOpen = MediaQuery.of(context).viewInsets.bottom > 0;
    final bool isExpanded = _isWelcomeExpanded || _numberFocus.hasFocus || isKeyboardOpen;

    return PopScope(
      canPop: _currentStep == 0 && !isExpanded,
      onPopInvoked: (didPop) {
        if (!didPop) _handlePop();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        resizeToAvoidBottomInset: false, // Stack-based sliding sheet controls inset
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
  // STEP 0 — Mobile Entry
  // The White Card sheet slides up OVER the orange hero on click/focus/drag,
  // completely hiding the orange section behind it.
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildStep0MobileEntry() {
    final bool isPhoneValid = number.text.trim().length == 10 &&
        RegExp(r'^[6-9][0-9]{9}$').hasMatch(number.text.trim());
    final bool isKeyboardOpen = MediaQuery.of(context).viewInsets.bottom > 0;
    final bool isExpanded = _isWelcomeExpanded || _numberFocus.hasFocus || isKeyboardOpen;

    final double topSafe = MediaQuery.of(context).padding.top;
    final double heroHeight = DeliveryLoginHero.heightFor(
      MediaQuery.sizeOf(context).width,
      MediaQuery.textScalerOf(context).scale(1),
    ) + topSafe;
    final double normalTop = heroHeight - 28.0;
    final double expandedTop = topSafe + 8.0;

    return GestureDetector(
      onTap: () {
        if (_numberFocus.hasFocus || _isWelcomeExpanded) {
          _numberFocus.unfocus();
          setState(() => _isWelcomeExpanded = false);
        }
      },
      behavior: HitTestBehavior.translucent,
      child: Stack(
        children: [
          // The existing white sheet remains the frontmost interactive layer.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: heroHeight + 10,
            child: DeliveryLoginHero(
              active: _currentStep == 0 && !isExpanded,
            ),
          ),
          // ── Layer 2 (Front): White Card Sheet (Overrides & covers orange section) ──
          AnimatedPositioned(
            duration: const Duration(milliseconds: 360),
            curve: Curves.easeOutCubic,
            top: isExpanded ? expandedTop : normalTop,
            left: 0,
            right: 0,
            bottom: 0,
            child: GestureDetector(
              onVerticalDragUpdate: (details) {
                if (details.primaryDelta != null) {
                  if (details.primaryDelta! > 7 && isExpanded) {
                    _numberFocus.unfocus();
                    setState(() => _isWelcomeExpanded = false);
                  } else if (details.primaryDelta! < -7 && !isExpanded) {
                    _numberFocus.requestFocus();
                    setState(() => _isWelcomeExpanded = true);
                  }
                }
              },
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(isExpanded ? 24 : 32),
                    topRight: Radius.circular(isExpanded ? 24 : 32),
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x28000000),
                      blurRadius: 16,
                      offset: Offset(0, -4),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(isExpanded ? 24 : 32),
                    topRight: Radius.circular(isExpanded ? 24 : 32),
                  ),
                  child: Column(
                    children: [
                      // Top drag handle / collapse button
                      GestureDetector(
                        onTap: () {
                          if (isExpanded) {
                            _numberFocus.unfocus();
                            setState(() => _isWelcomeExpanded = false);
                          } else {
                            _numberFocus.requestFocus();
                            setState(() => _isWelcomeExpanded = true);
                          }
                        },
                        behavior: HitTestBehavior.opaque,
                        child: Container(
                          padding: const EdgeInsets.only(top: 10, bottom: 8),
                          width: double.infinity,
                          alignment: Alignment.center,
                          child: isExpanded
                              ? Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF3F4F6),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: const [
                                      Icon(Icons.keyboard_arrow_down_rounded,
                                          size: 18, color: Color(0xFF6B7280)),
                                      SizedBox(width: 4),
                                      Text(
                                        'Swipe down to view header',
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 11.5,
                                          color: Color(0xFF6B7280),
                                        ),
                                      ),
                                    ],
                                  ),
                                )
                              : Container(
                                  width: 42,
                                  height: 4.5,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFD1D5DB),
                                    borderRadius: BorderRadius.circular(3),
                                  ),
                                ),
                        ),
                      ),

                      // Scrollable content inside the sheet
                      Expanded(
                        child: SingleChildScrollView(
                          physics: const BouncingScrollPhysics(),
                          padding: EdgeInsets.only(
                            left: 20,
                            right: 20,
                            top: 4,
                            bottom: MediaQuery.of(context).viewInsets.bottom + 20,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 10),

                              // Heading
                              const Text(
                                'Welcome Back 👋',
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 26,
                                  color: Color(0xFF111827),
                                  height: 1.2,
                                ),
                              ),
                              const SizedBox(height: 5),
                              const Text(
                                'Sign in to continue your delivery journey',
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 13.5,
                                  color: Color(0xFF6B7280),
                                ),
                              ),
                              const SizedBox(height: 22),

                              // Mobile Number label
                              const Text(
                                'Mobile Number',
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 13.5,
                                  color: Color(0xFF1F2937),
                                ),
                              ),
                              const SizedBox(height: 8),

                              // Phone input box
                              Container(
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFAFAFA),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: _numberError != null
                                        ? Colors.red.shade400
                                        : const Color(0xFFE5E7EB),
                                    width: 1.2,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                                      child: Row(
                                        children: const [
                                          Text('🇮🇳', style: TextStyle(fontSize: 19)),
                                          SizedBox(width: 8),
                                          Text(
                                            '+91',
                                            style: TextStyle(
                                              fontFamily: 'Gilroy_Bold',
                                              fontSize: 15,
                                              color: Color(0xFF111827),
                                            ),
                                          ),
                                          SizedBox(width: 4),
                                          Icon(Icons.keyboard_arrow_down_rounded,
                                              size: 18, color: Color(0xFF6B7280)),
                                        ],
                                      ),
                                    ),
                                    Container(width: 1, height: 26, color: const Color(0xFFE5E7EB)),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: TextFormField(
                                        controller: number,
                                        focusNode: _numberFocus,
                                        onTap: () {
                                          if (!_isWelcomeExpanded) {
                                            setState(() => _isWelcomeExpanded = true);
                                          }
                                        },
                                        keyboardType: TextInputType.number,
                                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                        maxLength: 10,
                                        onChanged: (_) {
                                          if (_numberError != null) {
                                            setState(() => _numberError = null);
                                          }
                                        },
                                        style: const TextStyle(
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 15,
                                          color: Color(0xFF111827),
                                        ),
                                        decoration: const InputDecoration(
                                          hintText: 'Enter mobile number',
                                          hintStyle: TextStyle(
                                            fontFamily: 'Gilroy_Medium',
                                            fontSize: 14,
                                            color: Color(0xFF9CA3AF),
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
                                const SizedBox(height: 6),
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

                              // Continue button
                              GestureDetector(
                                onTap: (!isPhoneValid || _isSendingOtp) ? null : _handleContinue,
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 200),
                                  width: double.infinity,
                                  height: 52,
                                  decoration: BoxDecoration(
                                    gradient: isPhoneValid
                                        ? const LinearGradient(
                                            colors: [Color(0xFFFF5C22), Color(0xFFFA4500)],
                                            begin: Alignment.centerLeft,
                                            end: Alignment.centerRight,
                                          )
                                        : null,
                                    color: isPhoneValid ? null : const Color(0xFFCFD6DC),
                                    borderRadius: BorderRadius.circular(14),
                                    boxShadow: isPhoneValid
                                        ? [
                                            BoxShadow(
                                              color: const Color(0xFFFA4500).withOpacity(0.32),
                                              blurRadius: 14,
                                              offset: const Offset(0, 5),
                                            ),
                                          ]
                                        : null,
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
                                    text: 'By continuing, you agree to our\n',
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 11.5,
                                      color: Color(0xFF6B7280),
                                      height: 1.4,
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

                              const SizedBox(height: 24),

                              // Create Account link
                              Center(
                                child: GestureDetector(
                                  onTap: () => Get.to(() => SignUp(type: widget.paymenttype)),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: const [
                                      Text(
                                        'New to Shifter Online? ',
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Medium',
                                          fontSize: 14,
                                          color: Color(0xFF4B5563),
                                        ),
                                      ),
                                      Text(
                                        'Create Account',
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 14,
                                          color: Color(0xFFFA4500),
                                        ),
                                      ),
                                      SizedBox(width: 4),
                                      Icon(Icons.arrow_forward_rounded,
                                          size: 15, color: Color(0xFFFA4500)),
                                    ],
                                  ),
                                ),
                              ),

                              const SizedBox(height: 24),

                              // Environmental / Mission card at bottom
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF0FDF4),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: const Color(0xFFDCFCE7)),
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: const BoxDecoration(
                                        color: Color(0xFFDCFCE7),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.eco_rounded,
                                          color: Color(0xFF16A34A), size: 20),
                                    ),
                                    const SizedBox(width: 12),
                                    const Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            'Delivering a better tomorrow',
                                            style: TextStyle(
                                              fontFamily: 'Gilroy_Bold',
                                              fontSize: 12.5,
                                              color: Color(0xFF166534),
                                            ),
                                          ),
                                          SizedBox(height: 2),
                                          Text(
                                            'For a smarter, cleaner and more connected city.',
                                            style: TextStyle(
                                              fontFamily: 'Gilroy_Medium',
                                              fontSize: 11,
                                              color: Color(0xFF4B5563),
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
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1 — OTP Verification (matching right reference design)
  // ─────────────────────────────────────────────────────────────────────────────
  Widget _buildStep1OtpVerify() {
    final bool isOtpComplete = _otpCtrl.text.trim().length == 6;

    return SafeArea(
      child: Column(
        children: [
          // Top bar: ShifterOnline logo
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: Image.asset(
                        'assets/logo1.png',
                        height: 30,
                        width: 30,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: const [
                        Text(
                          'ShifterOnline',
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 16,
                            color: Color(0xFF111827),
                            fontWeight: FontWeight.w800,
                            height: 1.1,
                          ),
                        ),
                        Text(
                          'Delivery Made Simple',
                          style: TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 9.5,
                            color: Color(0xFF6B7280),
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
                left: 22,
                right: 22,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const SizedBox(height: 16),

                  // 3D OTP Illustration
                  Image.asset(
                    'assets/otp_illustration.jpg',
                    height: 175,
                    fit: BoxFit.contain,
                  ),

                  const SizedBox(height: 24),

                  // Heading
                  const Text(
                    'Verify your number',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 24,
                      color: Color(0xFF111827),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'We have sent a 6-digit OTP to',
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 13.5,
                      color: Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '+91 ${number.text.trim()}',
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 15,
                          color: Color(0xFF111827),
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

                  const SizedBox(height: 28),

                  // 6-Digit Pinput OTP input
                  Pinput(
                    controller: _otpCtrl,
                    length: 6,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    onChanged: (pin) {
                      setState(() {});
                      if (pin.length == 6) {
                        _handleVerifyOtp();
                      }
                    },
                    onCompleted: (pin) {
                      _handleVerifyOtp();
                    },
                    defaultPinTheme: PinTheme(
                      width: 50,
                      height: 54,
                      textStyle: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 20,
                        color: Color(0xFF111827),
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE5E7EB), width: 1.5),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.04),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                    ),
                    focusedPinTheme: PinTheme(
                      width: 50,
                      height: 54,
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
                        color: const Color(0xFFECFDF5),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFA7F3D0)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(2),
                            decoration: const BoxDecoration(
                              color: Color(0xFF059669),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.check, size: 13, color: Colors.white),
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'OTP detected and filled automatically',
                              style: TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 12.5,
                                color: Color(0xFF065F46),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const Icon(Icons.auto_awesome_rounded,
                              size: 16, color: Color(0xFF059669)),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 22),

                  // Resend countdown row
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        "Didn't receive OTP?",
                        style: TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 13,
                          color: Color(0xFF6B7280),
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
                                : const Color(0xFF9CA3AF),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 28),

                  // Verify & Continue button
                  GestureDetector(
                    onTap: (!isOtpComplete || _isVerifying) ? null : _handleVerifyOtp,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      width: double.infinity,
                      height: 52,
                      decoration: BoxDecoration(
                        gradient: isOtpComplete
                            ? const LinearGradient(
                                colors: [Color(0xFFFF5C22), Color(0xFFFA4500)],
                                begin: Alignment.centerLeft,
                                end: Alignment.centerRight,
                              )
                            : null,
                        color: isOtpComplete ? null : const Color(0xFFCFD6DC),
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: isOtpComplete
                            ? [
                                BoxShadow(
                                  color: const Color(0xFFFA4500).withOpacity(0.35),
                                  blurRadius: 14,
                                  offset: const Offset(0, 5),
                                ),
                              ]
                            : null,
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

                  const SizedBox(height: 22),

                  // Security reassurance card
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFF3F4F6)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDCFCE7),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.shield_outlined,
                              color: Color(0xFF16A34A), size: 22),
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
                                  color: Color(0xFF111827),
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'We use secure encryption to protect your information.',
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 11.5,
                                  color: Color(0xFF6B7280),
                                  height: 1.35,
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

}
