import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:in_app_update/in_app_update.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

/// Checks Google Play for a newer version on each fresh launch and offers a
/// dismissible "Update Available" popup. Never blocks app start: any failure
/// (sideloaded install, no network, Play unavailable) silently shows nothing.
class AppUpdateService {
  AppUpdateService._();

  static Future<bool>? _check;
  static bool _prompted = false;

  /// Starts the Play Store check (once per process) without waiting for it.
  static void start() {
    if (!Platform.isAndroid) return;
    _check ??= _isUpdateAvailable();
  }

  /// Waits for the check and shows the popup at most once per app session.
  static Future<void> promptIfAvailable() async {
    if (_prompted || _check == null) return;
    try {
      final available =
          await _check!.timeout(const Duration(seconds: 8), onTimeout: () => false);
      if (!available || _prompted) return;
      _prompted = true;
      await Get.dialog(const _UpdateDialog());
    } catch (e) {
      debugPrint('AppUpdateService prompt failed: $e');
    }
  }

  static Future<bool> _isUpdateAvailable() async {
    try {
      final info = await InAppUpdate.checkForUpdate();
      return info.updateAvailability == UpdateAvailability.updateAvailable;
    } catch (e) {
      debugPrint('AppUpdateService check failed: $e');
      return false;
    }
  }

  static Future<void> openPlayStore() async {
    final id = (await PackageInfo.fromPlatform()).packageName;
    final market = Uri.parse('market://details?id=$id');
    final web = Uri.parse('https://play.google.com/store/apps/details?id=$id');
    if (await canLaunchUrl(market) &&
        await launchUrl(market, mode: LaunchMode.externalApplication)) {
      return;
    }
    await launchUrl(web, mode: LaunchMode.externalApplication);
  }
}

class _UpdateDialog extends StatelessWidget {
  const _UpdateDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      titlePadding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
      title: Row(
        children: [
          const Expanded(
            child: Text('Update Available',
                style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 18)),
          ),
          IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'Close',
            onPressed: () => Get.back(),
          ),
        ],
      ),
      content: const Text(
        'A new version of the app is available. Please update to get the latest improvements and features.',
        style: TextStyle(fontFamily: 'Gilroy_Regular', fontSize: 15),
      ),
      actions: [
        TextButton(onPressed: () => Get.back(), child: const Text('Cancel')),
        ElevatedButton(
          onPressed: () {
            Get.back();
            AppUpdateService.openPlayStore();
          },
          child: const Text('Update App'),
        ),
      ],
    );
  }
}
