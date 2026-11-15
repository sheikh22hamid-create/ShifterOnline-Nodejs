import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../services/gst_api_service.dart';
import '../../utils/colors.dart';
import '../../utils/gstin_format.dart';

/// Optional GST Details card on the booking-confirm screen (spec 2026-11-15).
///
///  * GST is never required: with nothing entered (or the card ignored) the booking is exactly as before.
///  * A typed GSTIN is checked on the phone (format / check digit) and then verified by the server; only a valid one shows
///    the business details. An invalid one shows a red message and nothing is filled in.
///  * A verified GSTIN is saved to this customer's profile by the server and filled in on their next booking. They can
///    change it, remove it, or leave it off for just this booking.
///  * [onChanged] reports the verified details to attach to the booking, or null when none should be.
class GstDetailsSection extends StatefulWidget {
  const GstDetailsSection({super.key, required this.uid, required this.onChanged});

  final Object? uid;
  final ValueChanged<Map<String, dynamic>?> onChanged;

  @override
  State<GstDetailsSection> createState() => _GstDetailsSectionState();
}

class _GstDetailsSectionState extends State<GstDetailsSection> {
  final TextEditingController _input = TextEditingController();
  Map<String, dynamic>? _details; // the verified (saved) details, if any
  bool _include = true; // attach them to this booking
  bool _editing = false;
  bool _checking = false;
  bool _unavailable = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSaved();
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _loadSaved() async {
    final uid = widget.uid;
    if (uid == null || uid.toString().isEmpty || uid.toString() == '0') return;
    final saved = await GstApiService.profile(uid);
    if (!mounted || saved == null) return;
    setState(() => _details = saved);
    widget.onChanged(saved); // autofilled from this customer's own saved details
  }

  Future<void> _verify() async {
    final typed = normalizeGstin(_input.text);
    final local = gstinProblem(typed);
    if (local != null) {
      setState(() {
        _error = local;
        _unavailable = false;
      });
      return;
    }
    final uid = widget.uid;
    if (uid == null) return;
    setState(() {
      _checking = true;
      _error = null;
      _unavailable = false;
    });
    final result = await GstApiService.verify(uid, typed);
    if (!mounted) return;
    if (result.valid && result.details != null) {
      setState(() {
        _checking = false;
        _editing = false;
        _details = result.details;
        _include = true;
      });
      widget.onChanged(result.details);
    } else {
      setState(() {
        _checking = false;
        _error = result.message.isEmpty ? 'This GSTIN could not be verified.' : result.message;
        _unavailable = result.unavailable;
      });
    }
  }

  Future<void> _remove() async {
    final uid = widget.uid;
    if (uid != null) await GstApiService.remove(uid);
    if (!mounted) return;
    setState(() {
      _details = null;
      _editing = false;
      _include = true;
      _error = null;
      _input.clear();
    });
    widget.onChanged(null);
  }

  void _startEditing() {
    setState(() {
      _editing = true;
      _error = null;
      _input.text = (_details?['gstin'] ?? '').toString();
    });
  }

  BoxDecoration _box(ColorNotifier notifier, {bool active = false}) => BoxDecoration(
        color: active ? linercolor.withOpacity(.06) : notifier.getBgColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: active ? linercolor : notifier.bordecolor),
      );

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);

    if (_editing) return _editor(notifier);
    final details = _details;
    if (details == null) return _prompt(notifier);
    return _summary(notifier, details);
  }

  Widget _prompt(ColorNotifier notifier) {
    return InkWell(
      onTap: () => setState(() => _editing = true),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: _box(notifier),
        child: Row(children: [
          Icon(Icons.receipt_long_outlined, color: greaycolor, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Add GST details (optional)'.tr, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 13)),
              Text('Get a GST invoice for this booking'.tr, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
            ]),
          ),
          Icon(Icons.chevron_right, color: greaycolor, size: 18),
        ]),
      ),
    );
  }

  Widget _editor(ColorNotifier notifier) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: _box(notifier, active: true),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('GST details (optional)'.tr, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 13))),
          InkWell(
            onTap: _checking ? null : () => setState(() { _editing = false; _error = null; }),
            child: Icon(Icons.close, color: greaycolor, size: 18),
          ),
        ]),
        const SizedBox(height: 8),
        TextField(
          controller: _input,
          enabled: !_checking,
          maxLength: 17, // room for a pasted number with spaces; the real limit is checked on verify
          textCapitalization: TextCapitalization.characters,
          autocorrect: false,
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 -]'))],
          style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 14, letterSpacing: 1),
          decoration: InputDecoration(
            counterText: '',
            hintText: '22AAAAA0000A1Z5',
            isDense: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
            errorText: _error,
            errorMaxLines: 3,
          ),
          onChanged: (_) { if (_error != null) setState(() => _error = null); },
          onSubmitted: (_) => _verify(),
        ),
        const SizedBox(height: 6),
        Text(
          _unavailable ? 'You can still book without GST details.'.tr : 'Leave this empty to book without GST. Your GSTIN is verified before it is used.'.tr,
          style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _checking ? null : _verify,
            style: ElevatedButton.styleFrom(backgroundColor: linercolor, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
            child: _checking
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text('Verify GSTIN'.tr, style: const TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold')),
          ),
        ),
      ]),
    );
  }

  Widget _summary(ColorNotifier notifier, Map<String, dynamic> d) {
    String field(String key) => (d[key] ?? '').toString().trim();
    final state = field('state');
    final stateCode = field('state_code');
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: _box(notifier, active: _include),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.verified_outlined, color: _include ? linercolor : greaycolor, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Text('GST invoice details'.tr, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 13))),
          Switch(
            value: _include,
            activeColor: linercolor,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            onChanged: (v) {
              setState(() => _include = v);
              widget.onChanged(v ? _details : null);
            },
          ),
        ]),
        Text(field('legal_name'), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 13)),
        if (field('trade_name').isNotEmpty && field('trade_name') != field('legal_name'))
          Text(field('trade_name'), style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
        Text('GSTIN: ${field('gstin')}', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
        if (field('address').isNotEmpty) Text(field('address'), style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
        if (state.isNotEmpty) Text(stateCode.isEmpty ? state : '$state ($stateCode)', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
        if (!_include)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Not added to this booking'.tr, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
          ),
        const SizedBox(height: 4),
        Row(children: [
          TextButton(onPressed: _startEditing, child: Text('Change'.tr, style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold'))),
          TextButton(onPressed: _remove, child: Text('Remove'.tr, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Bold'))),
        ]),
      ]),
    );
  }
}
