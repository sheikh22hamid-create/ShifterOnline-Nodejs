import 'package:flutter/material.dart';

import '../app_tokens.dart';

enum _MarkerKind { pickup, drop, stop }

/// Porter-style route dot used on every booking screen: green ↑ pickup, red ↓ drop, grey numbered stop.
class RouteMarker extends StatelessWidget {
  const RouteMarker.pickup({super.key, this.size = 24})
      : _kind = _MarkerKind.pickup,
        number = 0;
  const RouteMarker.drop({super.key, this.size = 24})
      : _kind = _MarkerKind.drop,
        number = 0;
  const RouteMarker.stop(this.number, {super.key, this.size = 24}) : _kind = _MarkerKind.stop;

  final _MarkerKind _kind;
  final int number;
  final double size;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final color = switch (_kind) {
      _MarkerKind.pickup => p.success,
      _MarkerKind.drop => p.danger,
      _MarkerKind.stop => p.inkSubtle,
    };
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: switch (_kind) {
        _MarkerKind.pickup => Icon(Icons.arrow_upward_rounded, size: size * 0.65, color: Colors.white),
        _MarkerKind.drop => Icon(Icons.arrow_downward_rounded, size: size * 0.65, color: Colors.white),
        _MarkerKind.stop => Text('$number',
            textScaler: TextScaler.noScaling,
            style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold', fontSize: size * 0.5, height: 1)),
      },
    );
  }
}
