import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:get/get.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/customewidget/customwidgets.dart';
import 'signin.dart';
import 'verification.dart';
import 'widgets/profile_form_widgets.dart';

/// Profile details for a brand-new customer, shown right after Sign In's OTP
/// step found no account. The OTP is already verified server-side (valid for
/// 10 minutes), so this page only collects details and registers.
class CompleteProfile extends StatefulWidget {
  final String mobile;
  final String? type;

  /// Test seams. Defaults: GET cities from Node; register via [singUpApi]
  /// (which saves the session and opens Home on success).
  final Future<List<CityModel>> Function()? loadCities;

  /// Returns null on success, or the server's failure message.
  final Future<String?> Function(Map<String, String> form)? submit;

  /// Called when register says the OTP is no longer verified.
  final VoidCallback? onSessionExpired;

  const CompleteProfile({
    super.key,
    required this.mobile,
    this.type,
    this.loadCities,
    this.submit,
    this.onSessionExpired,
  });

  @override
  State<CompleteProfile> createState() => _CompleteProfileState();
}

class _CompleteProfileState extends State<CompleteProfile> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _referral = TextEditingController();
  final _referralFocus = FocusNode();

  List<CityModel> _cities = [];
  bool _citiesLoading = true;
  CityModel? _city;
  bool _referralOpen = false;
  bool _submitting = false;
  ProfileFormErrors _errors = const ProfileFormErrors();

  @override
  void initState() {
    super.initState();
    _loadCities();
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _referral.dispose();
    _referralFocus.dispose();
    super.dispose();
  }

  Future<void> _loadCities() async {
    final list = await (widget.loadCities ?? _fetchCities)();
    if (!mounted) return;
    setState(() {
      _cities = list;
      _citiesLoading = false;
    });
  }

  static Future<List<CityModel>> _fetchCities() async {
    final val = await ApiWrapper.dataGetNode(Config.nodeCities);
    if (val == null || val['Result'] != 'true' || val['CityData'] is! List) {
      return [];
    }
    return (val['CityData'] as List)
        .map((e) => CityModel(id: e['id'].toString(), title: e['title'].toString()))
        .toList();
  }

  Future<String?> _register(Map<String, String> form) async {
    String? failMsg;
    final ok = await singUpApi(
      context,
      name: form['name']!,
      email: form['email']!,
      ccode: '+91',
      mobile: widget.mobile,
      password: '',
      cityId: form['city_id']!,
      refferalCode: form['referral']!,
      ptype: widget.type,
      onFailMessage: (m) => failMsg = m,
    );
    return ok ? null : (failMsg ?? 'Registration failed');
  }

  void _sessionExpired() {
    tostmsg('Session expired, please verify your number again');
    Get.offAll(() => SignIn(paymenttype: widget.type));
  }

  Future<void> _handleSubmit() async {
    if (_submitting) return;
    FocusScope.of(context).unfocus();
    final errors = validateProfileForm(name: _name.text, email: _email.text, city: _city);
    setState(() => _errors = errors);
    if (!errors.ok) return;

    setState(() => _submitting = true);
    final failMsg = await (widget.submit ?? _register)({
      'name': _name.text.trim(),
      'email': _email.text.trim(),
      'city_id': _city!.id,
      'referral': _referral.text.trim(),
    });
    if (!mounted) return;
    if (failMsg == null) return; // registered; singUpApi already navigated
    setState(() => _submitting = false);
    if (RegExp(r'verify OTP', caseSensitive: false).hasMatch(failMsg)) {
      (widget.onSessionExpired ?? _sessionExpired)();
    }
  }

  void _openCitySheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CitySheet(
        cityList: _cities,
        isLoading: _citiesLoading,
        onSelect: (c) => setState(() {
          _city = c;
          _errors = ProfileFormErrors(name: _errors.name, email: _errors.email);
        }),
      ),
    );
  }

  void _openWeb(String url, String title) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SizedBox(
        height: MediaQuery.of(ctx).size.height * 0.88,
        child: Column(children: [
          ListTile(
            title: Text(title,
                style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16)),
            trailing: IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: () => Navigator.pop(ctx)),
          ),
          const Divider(height: 1),
          Expanded(
            child: WebViewWidget(
              controller: WebViewController()
                ..setJavaScriptMode(JavaScriptMode.unrestricted)
                ..loadRequest(Uri.parse(url)),
            ),
          ),
        ]),
      ),
    );
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8, left: 2),
        child: Text(text,
            style: const TextStyle(
                fontFamily: 'Gilroy_Bold', fontSize: 13.5, color: Color(0xFF1F2937))),
      );

  Widget _input({
    required Key key,
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    String? error,
    TextInputType? keyboardType,
    TextCapitalization caps = TextCapitalization.none,
  }) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        decoration: BoxDecoration(
          color: AuthTokens.inputFill,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
              color: error != null ? Colors.red.shade400 : const Color(0xFFE5E7EB),
              width: 1.2),
        ),
        child: Row(children: [
          const SizedBox(width: 14),
          Icon(icon, size: 20, color: const Color(0xFF9CA3AF)),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              key: key,
              controller: controller,
              keyboardType: keyboardType,
              textCapitalization: caps,
              style: const TextStyle(
                  fontFamily: 'Gilroy_Medium', fontSize: 15, color: Color(0xFF111827)),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: const TextStyle(
                    fontFamily: 'Gilroy_Medium', fontSize: 14, color: Color(0xFF9CA3AF)),
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 15),
              ),
            ),
          ),
        ]),
      ),
      if (error != null)
        Padding(
          padding: const EdgeInsets.only(top: 6, left: 4),
          child: Text(error,
              style: TextStyle(
                  fontFamily: 'Gilroy_Medium', fontSize: 12, color: Colors.red.shade500)),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    const link = TextStyle(
      color: AuthTokens.primary,
      fontFamily: 'Gilroy_Bold',
      decoration: TextDecoration.underline,
      decorationColor: AuthTokens.primary,
    );

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 16, 0),
            child: Row(children: [
              IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: Color(0xFF111827)),
                onPressed: () => Get.back(),
              ),
            ]),
          ),
          Expanded(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Complete your profile',
                    style: TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 26,
                        color: Color(0xFF111827),
                        height: 1.2)),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFECFDF5),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.verified_rounded, size: 16, color: Color(0xFF059669)),
                    const SizedBox(width: 6),
                    Text('+91 ${widget.mobile} verified',
                        style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 13,
                            color: Color(0xFF065F46))),
                  ]),
                ),
                const SizedBox(height: 8),
                const Text('A few details and you are ready to book.',
                    style: TextStyle(
                        fontFamily: 'Gilroy_Medium', fontSize: 13.5, color: Color(0xFF6B7280))),
                const SizedBox(height: 24),
                _label('Full Name'),
                _input(
                  key: const Key('cp-name'),
                  controller: _name,
                  hint: 'Enter your full name',
                  icon: Icons.person_outline_rounded,
                  error: _errors.name,
                  caps: TextCapitalization.words,
                ),
                const SizedBox(height: 16),
                _label('Email (Optional)'),
                _input(
                  key: const Key('cp-email'),
                  controller: _email,
                  hint: 'Enter your email address',
                  icon: Icons.mail_outline_rounded,
                  error: _errors.email,
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 16),
                _label('City'),
                CitySelector(selectedCity: _city, error: _errors.city, onTap: _openCitySheet),
                const SizedBox(height: 16),
                ReferralAccordion(
                  expanded: _referralOpen,
                  controller: _referral,
                  focusNode: _referralFocus,
                  onToggle: () => setState(() => _referralOpen = !_referralOpen),
                ),
                const SizedBox(height: 28),
                GestureDetector(
                  key: const Key('cp-submit'),
                  onTap: _submitting ? null : _handleSubmit,
                  child: Container(
                    width: double.infinity,
                    height: 52,
                    decoration: BoxDecoration(
                      color: AuthTokens.primaryLight,
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: AuthTokens.cta,
                    ),
                    child: Center(
                      child: _submitting
                          ? const SpinKitThreeBounce(color: Color(0xFF1A0B04), size: 20)
                          : const Row(mainAxisSize: MainAxisSize.min, children: [
                              Text('Create Account',
                                  style: TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 16,
                                      color: Color(0xFF1A0B04))),
                              SizedBox(width: 8),
                              Icon(Icons.arrow_forward_rounded,
                                  size: 18, color: Color(0xFF1A0B04)),
                            ]),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Center(
                  child: RichText(
                    textAlign: TextAlign.center,
                    text: TextSpan(
                      text: 'By creating an account you agree to our\n',
                      style: const TextStyle(
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 11.5,
                          color: Color(0xFF6B7280),
                          height: 1.4),
                      children: [
                        TextSpan(
                          text: 'Terms and Conditions',
                          style: link,
                          recognizer: TapGestureRecognizer()
                            ..onTap = () => _openWeb(
                                'https://shifteronline.com/terms_conditions.php',
                                'Terms and Conditions'),
                        ),
                        const TextSpan(text: ' and '),
                        TextSpan(
                          text: 'Privacy Policy',
                          style: link,
                          recognizer: TapGestureRecognizer()
                            ..onTap = () => _openWeb(
                                'https://shifteronline.com/privacy_policy.php',
                                'Privacy Policy'),
                        ),
                        const TextSpan(text: '.'),
                      ],
                    ),
                  ),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
