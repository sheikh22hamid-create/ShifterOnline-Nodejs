import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import '../../Api/Api_wrapper.dart';
import '../../services/settlement_api_service.dart';
import '../../utils/Colors.dart';
import '../../utils/receiver_pay_options.dart';

/// Lets the booker fix a wrongly entered receiver number. Returns true when the number was
/// changed (the caller should refresh the order), false/null otherwise.
Future<bool?> showChangeReceiverNumberDialog(
  BuildContext context, {
  required int uid,
  required int orderId,
}) {
  return showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _ChangeReceiverNumberDialog(uid: uid, orderId: orderId),
  );
}

class _ChangeReceiverNumberDialog extends StatefulWidget {
  final int uid;
  final int orderId;
  const _ChangeReceiverNumberDialog({required this.uid, required this.orderId});

  @override
  State<_ChangeReceiverNumberDialog> createState() => _ChangeReceiverNumberDialogState();
}

class _ChangeReceiverNumberDialogState extends State<_ChangeReceiverNumberDialog> {
  final TextEditingController _controller = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    final mobile = normalizeIndianMobile(_controller.text);
    if (mobile.isEmpty) {
      setState(() => _error = "Enter a valid 10-digit mobile number.".tr);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final res = await SettlementApiService.changeReceiverPhone(
      uid: widget.uid,
      orderId: widget.orderId,
      mobile: mobile,
    );
    if (!mounted) return;
    final ok = res['Result'] == 'true' || res['Result'] == true;
    if (!ok) {
      setState(() {
        _saving = false;
        _error = SettlementApiService.friendlyErrorMessage(
            res['code']?.toString(), res['ResponseMsg']?.toString());
      });
      return;
    }
    ApiWrapper.showToastMessage(receiverNumberUpdatedKey(res['link_sent']).tr);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text("Change receiver number".tr,
          style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "Enter the correct 10-digit mobile number. The payment link goes to this number.".tr,
            style: const TextStyle(fontFamily: "Gilroy_Medium", fontSize: 13),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            enabled: !_saving,
            keyboardType: TextInputType.phone,
            maxLength: 14,
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
            decoration: InputDecoration(
              counterText: '',
              prefixText: '+91 ',
              errorText: _error,
              border: const OutlineInputBorder(),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: Text("Cancel".tr),
        ),
        TextButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: linercolor),
                )
              : Text("Update number".tr),
        ),
      ],
    );
  }
}
