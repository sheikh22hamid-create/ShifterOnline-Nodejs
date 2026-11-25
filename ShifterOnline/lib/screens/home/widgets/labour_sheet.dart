import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/app_sheet.dart';
import '../../../theme/widgets/app_buttons.dart';

/// Loading/Unloading ("saaman uthana") declaration sheet — spec 2026-11-24, Phase 1 Model A.
///
/// The customer declares WHAT is lifted and WHERE (per-leg: pickup side + drop side), the
/// server prices it from that declaration (never computed here), and the result is shown back on
/// the vehicle card as one locked total. This sheet only COLLECTS the declaration and returns it as
/// `{ mode, heavyItem, legs:[{role,size,floor,lift}| {role,qty,access}] }` — the exact shape the
/// backend fare-estimate / order endpoints consume. Returns null if the customer backs out, or an
/// empty-legs map `{removed:true}` to clear a previous declaration.
///
/// Option vocab is fixed Phase-1 and MUST match the backend (labourPricing.js):
///   home leg:  size ∈ small|medium|large,  floor ∈ ground|f1_2|f3plus,  lift ∈ bool
///   shop leg:  qty  ∈ q15|q15_40|q40plus,  access ∈ shutter|stack_inside|loft_basement
/// Over-cap (large / 3rd-floor+ / 40+ items / basement-loft / heavy item) is decided server-side.
Future<Map<String, dynamic>?> showLabourSheet(
  BuildContext context, {
  Map<String, dynamic>? initial,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _LabourSheet(initial: initial),
  );
}

class _LabourSheet extends StatefulWidget {
  const _LabourSheet({this.initial});
  final Map<String, dynamic>? initial;

  @override
  State<_LabourSheet> createState() => _LabourSheetState();
}

class _LabourSheetState extends State<_LabourSheet> {
  // 'home' (Ghar) or 'shop' (Dukaan).
  String _mode = 'home';
  bool _heavyItem = false;

  // Per-leg selections, keyed by role. Defaults = the lightest (cheapest) option so a quick
  // customer who taps nothing still gets a valid, honest minimum rather than a blank.
  final Map<String, String> _size = {'pickup': 'small', 'drop': 'small'};
  final Map<String, String> _floor = {'pickup': 'ground', 'drop': 'ground'};
  final Map<String, bool> _lift = {'pickup': false, 'drop': false};
  final Map<String, String> _qty = {'pickup': 'q15', 'drop': 'q15'};
  final Map<String, String> _access = {'pickup': 'shutter', 'drop': 'shutter'};

  @override
  void initState() {
    super.initState();
    _hydrate(widget.initial);
  }

  void _hydrate(Map<String, dynamic>? initial) {
    if (initial == null) return;
    final mode = initial['mode'];
    if (mode == 'shop' || mode == 'home') _mode = mode as String;
    _heavyItem = initial['heavyItem'] == true;
    final legs = initial['legs'];
    if (legs is List) {
      for (final leg in legs.whereType<Map>()) {
        final role = leg['role'] == 'drop' ? 'drop' : 'pickup';
        if (leg['size'] is String) _size[role] = leg['size'] as String;
        if (leg['floor'] is String) _floor[role] = leg['floor'] as String;
        if (leg['lift'] is bool) _lift[role] = leg['lift'] as bool;
        if (leg['qty'] is String) _qty[role] = leg['qty'] as String;
        if (leg['access'] is String) _access[role] = leg['access'] as String;
      }
    }
  }

  Map<String, dynamic> _buildDeclaration() {
    List<Map<String, dynamic>> legs;
    if (_mode == 'home') {
      legs = ['pickup', 'drop']
          .map((role) => {'role': role, 'size': _size[role], 'floor': _floor[role], 'lift': _lift[role]})
          .toList();
    } else {
      legs = ['pickup', 'drop']
          .map((role) => {'role': role, 'qty': _qty[role], 'access': _access[role]})
          .toList();
    }
    return {'mode': _mode, 'heavyItem': _heavyItem, 'legs': legs};
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return SafeArea(
      top: false,
      child: AppSheet(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.82),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(Icons.inventory_2_rounded, color: p.brand, size: 22),
                  const SizedBox(width: AppSpace.s),
                  Expanded(child: Text('Saaman uthana (Loading / Unloading)'.tr, style: AppText.section(p.ink))),
                ],
              ),
              const SizedBox(height: AppSpace.xs),
              Text(
                'Bataiye kya aur kahan uthana hai — driver ko pehle se clarity milegi aur keemat lock ho jayegi.'.tr,
                style: AppText.caption(p.inkSubtle),
              ),
              const SizedBox(height: AppSpace.m),
              _modeToggle(p),
              const SizedBox(height: AppSpace.m),
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _legCard(p, role: 'pickup', label: 'Pickup wali jagah'.tr),
                      const SizedBox(height: AppSpace.m),
                      _legCard(p, role: 'drop', label: 'Drop wali jagah'.tr),
                      const SizedBox(height: AppSpace.m),
                      _heavyToggle(p),
                      const SizedBox(height: AppSpace.s),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpace.s),
              Row(
                children: [
                  if (widget.initial != null) ...[
                    Expanded(
                      child: AppSecondaryButton(
                        label: 'Hata do'.tr,
                        onPressed: () => Navigator.pop(context, {'removed': true}),
                      ),
                    ),
                    const SizedBox(width: AppSpace.m),
                  ],
                  Expanded(
                    flex: 2,
                    child: AppPrimaryButton(
                      label: 'Keemat dekho'.tr,
                      onPressed: () => Navigator.pop(context, _buildDeclaration()),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _modeToggle(AppPalette p) {
    Widget seg(String value, String label, IconData icon) {
      final sel = _mode == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _mode = value),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              color: sel ? p.brand : p.canvas,
              borderRadius: BorderRadius.circular(AppRadius.input),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 18, color: sel ? p.onBrand : p.inkMuted),
                const SizedBox(width: 6),
                Text(label, style: AppText.bodyStrong(sel ? p.onBrand : p.inkMuted).copyWith(fontSize: 14)),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        seg('home', 'Ghar / Flat'.tr, Icons.home_rounded),
        const SizedBox(width: AppSpace.s),
        seg('shop', 'Dukaan / Godown'.tr, Icons.store_rounded),
      ],
    );
  }

  Widget _legCard(AppPalette p, {required String role, required String label}) {
    return Container(
      padding: const EdgeInsets.all(AppSpace.m),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: p.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppText.bodyStrong(p.ink)),
          const SizedBox(height: AppSpace.s),
          if (_mode == 'home') ..._homeLeg(p, role) else ..._shopLeg(p, role),
        ],
      ),
    );
  }

  List<Widget> _homeLeg(AppPalette p, String role) {
    return [
      _fieldLabel(p, 'Saaman ka size'.tr),
      _pills(p, current: _size[role]!, onPick: (v) => setState(() => _size[role] = v), options: const [
        _Opt('small', 'Chhota', Icons.backpack_rounded),
        _Opt('medium', 'Medium', Icons.inventory_2_rounded),
        _Opt('large', 'Bada', Icons.weekend_rounded),
      ]),
      const SizedBox(height: AppSpace.s),
      _fieldLabel(p, 'Manzil (floor)'.tr),
      _pills(p, current: _floor[role]!, onPick: (v) => setState(() => _floor[role] = v), options: const [
        _Opt('ground', 'Ground', Icons.door_front_door_rounded),
        _Opt('f1_2', '1-2', Icons.stairs_rounded),
        _Opt('f3plus', '3+', Icons.apartment_rounded),
      ]),
      const SizedBox(height: AppSpace.s),
      Row(
        children: [
          Icon(Icons.elevator_rounded, size: 18, color: p.inkMuted),
          const SizedBox(width: 6),
          Expanded(child: Text('Lift chaalu hai?'.tr, style: AppText.body(p.inkMuted))),
          Switch(
            value: _lift[role]!,
            activeColor: p.brand,
            onChanged: (v) => setState(() => _lift[role] = v),
          ),
        ],
      ),
    ];
  }

  List<Widget> _shopLeg(AppPalette p, String role) {
    return [
      _fieldLabel(p, 'Kitne saaman / box'.tr),
      _pills(p, current: _qty[role]!, onPick: (v) => setState(() => _qty[role] = v), options: const [
        _Opt('q15', '≤15', Icons.inventory_rounded),
        _Opt('q15_40', '15-40', Icons.inventory_2_rounded),
        _Opt('q40plus', '40+', Icons.warehouse_rounded),
      ]),
      const SizedBox(height: AppSpace.s),
      _fieldLabel(p, 'Pahunch (access)'.tr),
      _pills(p, current: _access[role]!, onPick: (v) => setState(() => _access[role] = v), options: const [
        _Opt('shutter', 'Shutter tak', Icons.storefront_rounded),
        _Opt('stack_inside', 'Andar rakhna', Icons.move_to_inbox_rounded),
        _Opt('loft_basement', 'Loft/Basement', Icons.unfold_more_rounded),
      ]),
    ];
  }

  Widget _heavyToggle(AppPalette p) {
    return GestureDetector(
      onTap: () => setState(() => _heavyItem = !_heavyItem),
      child: Container(
        padding: const EdgeInsets.all(AppSpace.m),
        decoration: BoxDecoration(
          color: _heavyItem ? p.warningTint : p.canvas,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: _heavyItem ? p.warning : p.line),
        ),
        child: Row(
          children: [
            Icon(Icons.fitness_center_rounded, size: 18, color: _heavyItem ? p.warning : p.inkMuted),
            const SizedBox(width: AppSpace.s),
            Expanded(
              child: Text(
                'Bhaari saaman hai? (fridge, almirah, cement, washing machine...)'.tr,
                style: AppText.caption(_heavyItem ? p.warning : p.inkMuted),
              ),
            ),
            Icon(_heavyItem ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                size: 20, color: _heavyItem ? p.warning : p.inkSubtle),
          ],
        ),
      ),
    );
  }

  Widget _fieldLabel(AppPalette p, String text) =>
      Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(text, style: AppText.caption(p.inkSubtle)));

  Widget _pills(AppPalette p, {required String current, required ValueChanged<String> onPick, required List<_Opt> options}) {
    return Row(
      children: [
        for (final o in options) ...[
          Expanded(
            child: GestureDetector(
              onTap: () => onPick(o.value),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: current == o.value ? p.brandTint : p.canvas,
                  borderRadius: BorderRadius.circular(AppRadius.input),
                  border: Border.all(color: current == o.value ? p.brand : p.line, width: current == o.value ? 1.4 : 1),
                ),
                child: Column(
                  children: [
                    Icon(o.icon, size: 20, color: current == o.value ? p.brandText : p.inkMuted),
                    const SizedBox(height: 4),
                    Text(o.label.tr,
                        textAlign: TextAlign.center,
                        style: AppText.small(current == o.value ? p.brandText : p.inkMuted)),
                  ],
                ),
              ),
            ),
          ),
          if (o != options.last) const SizedBox(width: AppSpace.s),
        ],
      ],
    );
  }
}

class _Opt {
  const _Opt(this.value, this.label, this.icon);
  final String value;
  final String label;
  final IconData icon;
}
