import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/section_header.dart';

class HomeVehicle {
  const HomeVehicle({required this.name, this.imageUrl, this.subtitle});

  final String name;
  final String? imageUrl;
  final String? subtitle;
}

/// Horizontal vehicle cards on Home. Every card opens the existing vehicle selection (no pre-selection).
class HomeVehicleRow extends StatelessWidget {
  const HomeVehicleRow({super.key, required this.vehicles, required this.onTap});

  final List<HomeVehicle> vehicles;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (vehicles.isEmpty) return const SizedBox.shrink();
    final p = AppPalette.current;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: 'Choose a vehicle'.tr),
        const SizedBox(height: AppSpace.s),
        SizedBox(
          height: 156,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: vehicles.length,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (context, i) {
              final v = vehicles[i];
              return PressableScale(
                onTap: onTap,
                child: Container(
                  width: 136,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: p.surface,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: p.line),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        height: 82,
                        width: double.infinity,
                        color: p.canvas,
                        padding: const EdgeInsets.all(8),
                        child: _VehicleImage(url: v.imageUrl),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(v.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                            if (v.subtitle != null && v.subtitle!.isNotEmpty)
                              Text(v.subtitle!,
                                  maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption(p.inkSubtle)),
                          ],
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
    );
  }
}

class _VehicleImage extends StatelessWidget {
  const _VehicleImage({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final placeholder = Icon(Icons.local_shipping_outlined, size: 40, color: p.brand);
    if (url == null || url!.isEmpty) return Center(child: placeholder);
    return Image.network(
      url!,
      fit: BoxFit.contain,
      cacheWidth: 300,
      errorBuilder: (_, __, ___) => Center(child: placeholder),
    );
  }
}
