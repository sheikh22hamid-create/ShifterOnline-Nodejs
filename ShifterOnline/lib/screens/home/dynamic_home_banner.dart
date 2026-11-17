import 'package:flutter/material.dart';

import '../../Api/config.dart';

/// Renders the banner collection returned by home_data.php.
///
/// The backend currently returns the already-filtered `banner` array. If a
/// status field is present, we still enforce status == 1 before rendering.
class DynamicHomeBanner extends StatelessWidget {
  const DynamicHomeBanner({
    super.key,
    required this.banners,
  });

  final List<dynamic> banners;

  List<Map<String, dynamic>> get _activeBanners {
    return banners
        .whereType<Map>()
        .map((banner) => Map<String, dynamic>.from(banner))
        .where(_isActive)
        .toList();
  }

  bool _isActive(Map<String, dynamic> banner) {
    final status = banner['status'];
    // The current response omits status because the backend filters it.
    if (status == null) return true;
    return status == 1 || status == '1' || status == true;
  }

  String _imageUrl(String value) {
    return Config.resolveImageUrl(value);
  }

  @override
  Widget build(BuildContext context) {
    final activeBanners = _activeBanners;
    if (activeBanners.isEmpty) return const SizedBox.shrink();

    final imagePath = activeBanners.first['img']?.toString().trim() ?? '';
    if (imagePath.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 15),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: AspectRatio(
          aspectRatio: 2.85,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0xFFFFF4EC),
              border: Border.all(color: const Color(0xFFFFE2D2)),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFE85E2A).withOpacity(.10),
                  blurRadius: 16,
                  offset: const Offset(0, 7),
                ),
              ],
            ),
            child: Image.network(
              _imageUrl(imagePath),
              fit: BoxFit.contain,
              alignment: Alignment.center,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
              loadingBuilder: (context, child, progress) {
                if (progress == null) return child;
                return const _BannerSkeleton();
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _BannerSkeleton extends StatelessWidget {
  const _BannerSkeleton();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(
        color: Color(0xFFFFF4EC),
      ),
      child: SizedBox.expand(),
    );
  }
}
