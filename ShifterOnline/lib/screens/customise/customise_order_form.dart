// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_buttons.dart';
import '../../theme/widgets/app_top_bar.dart';
import '../../theme/widgets/route_marker.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../home/home.dart'; // pickupiteam: the vehicle categories already loaded for the home screen
import '../home/location_search_screen.dart';
import 'customise_api.dart';
import 'customise_order_detail.dart';
import 'customise_ui.dart';

class _Place {
  _Place(this.address, this.lat, this.lng);
  final String address;
  final double lat;
  final double lng;
}

/// One extra stop. Each stop keeps its own details; nothing is shared with the pickup, drop or another stop.
class _StopDraft {
  _Place? place;
  String kind = 'drop';
  final goods = TextEditingController();
  final floor = TextEditingController(text: '0');
  final carry = TextEditingController(text: '0');
  final helpers = TextEditingController(text: '0');
  final loadMin = TextEditingController(text: '0');
  final unloadMin = TextEditingController(text: '0');
  final waitMin = TextEditingController(text: '0');
  final notes = TextEditingController();

  void dispose() {
    for (final c in [goods, floor, carry, helpers, loadMin, unloadMin, waitMin, notes]) {
      c.dispose();
    }
  }
}

class CustomiseOrderForm extends StatefulWidget {
  const CustomiseOrderForm({super.key});

  @override
  State<CustomiseOrderForm> createState() => _CustomiseOrderFormState();
}

class _CustomiseOrderFormState extends State<CustomiseOrderForm> {
  _Place? _pickup;
  _Place? _drop;
  bool _pickupExact = true;
  final List<_StopDraft> _stops = [];

  final _goodsDesc = TextEditingController();
  final _qty = TextEditingController(text: '1');
  final _weight = TextEditingController();
  final _len = TextEditingController();
  final _wid = TextEditingController();
  final _hgt = TextEditingController();
  final _packing = TextEditingController();

  final _pFloor = TextEditingController(text: '0');
  final _pCarry = TextEditingController(text: '0');
  final _pHelpers = TextEditingController(text: '0');
  final _pLoad = TextEditingController(text: '0');
  final _pWait = TextEditingController(text: '0');
  final _pNotes = TextEditingController();

  final _dFloor = TextEditingController(text: '0');
  final _dCarry = TextEditingController(text: '0');
  final _dHelpers = TextEditingController(text: '0');
  final _dUnload = TextEditingController(text: '0');
  final _dWait = TextEditingController(text: '0');
  final _dNotes = TextEditingController();

  final _fare = TextEditingController();

  late DateTime _start;
  late DateTime _expiry;
  int? _categoryId; // null = any vehicle
  bool _saving = false;

  List<Map<String, dynamic>> get _categories => [
        for (final c in pickupiteam.whereType<Map>())
          if ((c['id'] ?? '').toString().isNotEmpty && (c['cat_name'] ?? '').toString().isNotEmpty) Map<String, dynamic>.from(c),
      ];

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _start = now.add(const Duration(minutes: 10));
    _expiry = _start.add(const Duration(hours: 3));
    _fare.addListener(_onFareChanged);
  }

  void _onFareChanged() {
    if (mounted) setState(() {}); // the bottom button shows the price as it is typed
  }

  @override
  void dispose() {
    for (final c in [_goodsDesc, _qty, _weight, _len, _wid, _hgt, _packing, _pFloor, _pCarry, _pHelpers, _pLoad, _pWait, _pNotes, _dFloor, _dCarry, _dHelpers, _dUnload, _dWait, _dNotes, _fare]) {
      c.dispose();
    }
    for (final s in _stops) {
      s.dispose();
    }
    super.dispose();
  }

  /// Same search + "pin on the map" flow as the normal booking form (LocationSearchScreen), without the
  /// sender/receiver contact step. [kind] is 'Pickup', 'Drop' or 'Stop'. The coordinates returned are the
  /// exact pin the customer confirmed and are passed on untouched.
  Future<_Place?> _pickPlace(String kind, {int stopIndex = 0}) async {
    try {
      final result = await Get.to<Map<String, dynamic>>(
        () => LocationSearchScreen(locationType: kind, stopIndex: stopIndex, locationOnly: true),
      );
      if (result == null) return null;
      final lat = double.tryParse('${result['lat_map']}');
      final lng = double.tryParse('${result['long_map']}');
      final address = (result['address'] ?? '').toString().trim();
      if (lat == null || lng == null || (lat == 0 && lng == 0)) {
        tostmsg('Could not read that location. Please pick another one.');
        return null;
      }
      return _Place(address.isNotEmpty ? address : 'Selected location', lat, lng);
    } catch (e) {
      debugPrint('Customise place pick failed: $e');
      tostmsg('Error selecting location. Please try again.');
      return null;
    }
  }

  Future<DateTime?> _pickDateTime(DateTime initial) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(now) ? now : initial,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  // The app runs on India time; the server reads a time without an offset the same way, but send the offset anyway.
  String _iso(DateTime t) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${t.year}-${two(t.month)}-${two(t.day)}T${two(t.hour)}:${two(t.minute)}:00+05:30';
  }

  String _show(DateTime t) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(t.day)}/${two(t.month)}/${t.year}  ${two(t.hour)}:${two(t.minute)}';
  }

  int _int(TextEditingController c) => int.tryParse(c.text.trim()) ?? 0;

  /// Plain-words list of what is still missing; empty when the form can be sent.
  List<String> _problems() {
    final out = <String>[];
    if (_pickup == null) out.add('Choose the pickup location');
    if (_drop == null) out.add('Choose the drop location');
    for (var i = 0; i < _stops.length; i++) {
      if (_stops[i].place == null) out.add('Choose the location of stop ${i + 1}, or remove it');
    }
    if (_goodsDesc.text.trim().isEmpty) out.add('Tell us what goods are being moved');
    if ((int.tryParse(_qty.text.trim()) ?? 0) < 1) out.add('Enter how many items there are');
    if ((double.tryParse(_weight.text.trim()) ?? 0) <= 0) out.add('Enter the total weight of the goods in kg');
    final fare = double.tryParse(_fare.text.trim());
    if (fare == null || fare <= 0) out.add('Enter the price you want to pay');
    if (_start.isBefore(DateTime.now())) out.add('Bargaining start time cannot be in the past');
    if (!_expiry.isAfter(_start)) out.add('Expiry time must be after the start time');
    return out;
  }

  Map<String, dynamic> _payload() {
    double? opt(TextEditingController c) => double.tryParse(c.text.trim());
    return {
      'pickup': {'lat': _pickup!.lat, 'lng': _pickup!.lng, 'address': _pickup!.address, 'exact': _pickupExact},
      'drop': {'lat': _drop!.lat, 'lng': _drop!.lng, 'address': _drop!.address},
      'stops': [
        for (final s in _stops)
          {
            'lat': s.place!.lat, 'lng': s.place!.lng, 'address': s.place!.address, 'kind': s.kind,
            'goods_desc': s.goods.text.trim(), 'floor': _int(s.floor), 'carry_m': _int(s.carry), 'helpers': _int(s.helpers),
            'load_min': _int(s.loadMin), 'unload_min': _int(s.unloadMin), 'wait_min': _int(s.waitMin), 'notes': s.notes.text.trim(),
          },
      ],
      'goods': {
        'description': _goodsDesc.text.trim(), 'quantity': _int(_qty), 'weight_kg': opt(_weight),
        'length_cm': opt(_len), 'width_cm': opt(_wid), 'height_cm': opt(_hgt), 'packing_notes': _packing.text.trim(),
      },
      'pickup_handling': {
        'floor': _int(_pFloor), 'carry_m': _int(_pCarry), 'helpers': _int(_pHelpers), 'load_min': _int(_pLoad), 'wait_min': _int(_pWait), 'notes': _pNotes.text.trim(),
      },
      'drop_handling': {
        'floor': _int(_dFloor), 'carry_m': _int(_dCarry), 'helpers': _int(_dHelpers), 'unload_min': _int(_dUnload), 'wait_min': _int(_dWait), 'notes': _dNotes.text.trim(),
      },
      if (_categoryId != null) 'category_id': _categoryId,
      'initial_fare': double.parse(_fare.text.trim()),
      'bargain_start_at': _iso(_start),
      'expires_at': _iso(_expiry),
    };
  }

  Future<void> _submit() async {
    final problems = _problems();
    if (problems.isNotEmpty) {
      tostmsg(problems.join('\n'));
      return;
    }
    setState(() => _saving = true);
    try {
      final res = await CustomiseApi.create(_payload());
      if (!mounted) return;
      if (CustomiseApi.ok(res)) {
        final id = int.tryParse('${res['order_id']}') ?? 0;
        tostmsg('Your Customise Order is posted.');
        Get.off(() => CustomiseOrderDetail(orderId: id));
      } else {
        tostmsg(CustomiseApi.message(res));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // --- small widgets ----------------------------------------------------------------------------------------------

  Widget _row2(Widget a, Widget b) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)]);

  Widget _timeTile(String label, DateTime value, ValueChanged<DateTime> onPicked) {
    final p = AppPalette.current;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: p.canvas,
        borderRadius: BorderRadius.circular(AppRadius.input),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.input),
          onTap: () async {
            final picked = await _pickDateTime(value);
            if (picked != null) setState(() => onPicked(picked));
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            child: Row(children: [
              Icon(Icons.schedule_rounded, size: 20, color: p.brandText),
              const SizedBox(width: 10),
              Expanded(child: Text(label.tr, style: AppText.body(p.inkMuted).copyWith(fontSize: 14))),
              Text(_show(value), style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
              const SizedBox(width: 4),
              Icon(Icons.edit_outlined, size: 16, color: p.inkSubtle),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) {
    final p = AppPalette.current;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      selectedColor: p.brandTint,
      labelStyle: AppText.bodyStrong(selected ? p.brandText : p.ink).copyWith(fontSize: 13),
      side: BorderSide(color: selected ? p.brand : p.line),
      backgroundColor: p.surface,
      showCheckmark: false,
      onSelected: (_) => onTap(),
    );
  }

  /// Quick "keep offers open for…" choices; the exact close time can still be picked above.
  Widget _windowChips() {
    final current = _expiry.difference(_start).inMinutes;
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final h in const [1, 3, 6, 12])
        _chip('$h ${(h == 1 ? 'hour' : 'hours').tr}', current == h * 60,
            () => setState(() => _expiry = _start.add(Duration(hours: h)))),
    ]);
  }

  Widget _stopCard(int index) {
    final p = AppPalette.current;
    final s = _stops[index];
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 4, 4, 12),
      decoration: BoxDecoration(border: Border.all(color: p.line), borderRadius: BorderRadius.circular(AppRadius.input)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${'Stop'.tr} ${index + 1}', style: AppText.bodyStrong(p.ink))),
          IconButton(
            tooltip: 'Remove stop'.tr,
            icon: Icon(Icons.delete_outline_rounded, color: p.danger),
            onPressed: () => setState(() => _stops.removeAt(index).dispose()),
          ),
        ]),
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            CustomisePlaceTile(
              marker: RouteMarker.stop(index + 1, size: 22),
              placeholder: 'Choose stop location',
              address: s.place?.address,
              onTap: () async {
                final picked = await _pickPlace('Stop', stopIndex: index);
                if (picked != null) setState(() => s.place = picked);
              },
            ),
            Wrap(spacing: 8, children: [
              for (final k in const [['pickup', 'Pick up here'], ['drop', 'Drop here'], ['both', 'Both']])
                _chip(k[1].tr, s.kind == k[0], () => setState(() => s.kind = k[0])),
            ]),
            const SizedBox(height: 10),
            CustomiseField(label: 'Goods at this stop', controller: s.goods),
            CustomiseMore(
              title: 'Stop details',
              subtitle: 'Floor, helpers, time and notes (optional)',
              children: [
                _row2(CustomiseField(label: 'Floor', controller: s.floor, number: true),
                    CustomiseField(label: 'Carry distance (m)', controller: s.carry, number: true)),
                _row2(CustomiseField(label: 'Helpers', controller: s.helpers, number: true),
                    CustomiseField(label: 'Loading (min)', controller: s.loadMin, number: true)),
                _row2(CustomiseField(label: 'Unloading (min)', controller: s.unloadMin, number: true),
                    CustomiseField(label: 'Waiting (min)', controller: s.waitMin, number: true)),
                CustomiseField(label: 'Notes for this stop', controller: s.notes, lines: 2),
              ],
            ),
          ]),
        ),
      ]),
    );
  }

  String? get _categoryName {
    if (_categoryId == null) return null;
    for (final c in _categories) {
      if (int.tryParse('${c['id']}') == _categoryId) return '${c['cat_name']}';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final p = AppPalette.current;
    final cats = _categories;
    final fare = double.tryParse(_fare.text.trim());
    final inputBorder =
        OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.input), borderSide: BorderSide(color: p.line));
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(title: 'New Customise Order'.tr, subtitle: 'Name your price, drivers respond'.tr),
      bottomNavigationBar: Material(
        color: p.surface,
        elevation: 8,
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            child: _saving
                ? SizedBox(height: 52, child: Center(child: CircularProgressIndicator(color: p.brand)))
                : AppPrimaryButton(
                    label: 'Post order'.tr,
                    trailing: fare != null && fare > 0 ? '₹${_fare.text.trim()}' : null,
                    onPressed: _submit,
                  ),
          ),
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 24),
        children: [
          // 1. Route
          CustomiseSection(step: 1, title: 'Where', subtitle: 'Pickup, drop and any stops on the way', children: [
            CustomisePlaceTile(
              marker: const RouteMarker.pickup(size: 22),
              placeholder: 'Choose pickup location',
              address: _pickup?.address,
              onTap: () async {
                final picked = await _pickPlace('Pickup');
                if (picked != null) setState(() => _pickup = picked);
              },
            ),
            SwitchListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('Pickup point is exact'.tr, style: AppText.body(p.ink).copyWith(fontSize: 14)),
              subtitle: Text(
                  (_pickupExact
                          ? 'The driver goes to this exact spot.'
                          : 'Approximate: you will confirm the exact spot with the driver.')
                      .tr,
                  style: AppText.caption(p.inkMuted)),
              value: _pickupExact,
              activeColor: p.brand,
              onChanged: (v) => setState(() => _pickupExact = v),
            ),
            for (var i = 0; i < _stops.length; i++) _stopCard(i),
            CustomisePlaceTile(
              marker: const RouteMarker.drop(size: 22),
              placeholder: 'Choose drop location',
              address: _drop?.address,
              onTap: () async {
                final picked = await _pickPlace('Drop');
                if (picked != null) setState(() => _drop = picked);
              },
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: _stops.length >= 5 ? null : () => setState(() => _stops.add(_StopDraft())),
                icon: Icon(Icons.add_location_alt_outlined, color: _stops.length >= 5 ? p.inkSubtle : p.brandText),
                label: Text('Add a stop'.tr,
                    style: AppText.bodyStrong(_stops.length >= 5 ? p.inkSubtle : p.brandText).copyWith(fontSize: 14)),
              ),
            ),
          ]),

          // 2. Goods
          CustomiseSection(step: 2, title: 'What are you moving?', subtitle: 'Helps drivers come with the right vehicle', children: [
            CustomiseField(label: 'Goods', controller: _goodsDesc, lines: 2, hint: 'e.g. 2 sofas and a dining table'),
            _row2(CustomiseField(label: 'Number of items', controller: _qty, number: true),
                CustomiseField(label: 'Total weight (kg)', controller: _weight, number: true, decimal: true)),
            CustomiseMore(
              icon: Icons.straighten_rounded,
              title: 'Size and packing',
              subtitle: 'Optional',
              children: [
                Text('Size of the largest item'.tr, style: AppText.caption(p.inkMuted)),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: CustomiseField(label: 'Length cm', controller: _len, number: true, decimal: true)),
                  const SizedBox(width: 8),
                  Expanded(child: CustomiseField(label: 'Width cm', controller: _wid, number: true, decimal: true)),
                  const SizedBox(width: 8),
                  Expanded(child: CustomiseField(label: 'Height cm', controller: _hgt, number: true, decimal: true)),
                ]),
                CustomiseField(
                    label: 'Packing and handling needs', controller: _packing, lines: 2, hint: 'Fragile, needs wrapping, keep upright…'),
              ],
            ),
            CustomiseMore(
              icon: Icons.local_shipping_outlined,
              title: 'Vehicle',
              subtitle: _categoryName ?? 'Any vehicle',
              children: [
                DropdownButtonFormField<int?>(
                  value: _categoryId,
                  isExpanded: true,
                  dropdownColor: p.surface,
                  style: AppText.body(p.ink).copyWith(fontSize: 14),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: p.surface,
                    isDense: true,
                    border: inputBorder,
                    enabledBorder: inputBorder,
                  ),
                  items: [
                    DropdownMenuItem<int?>(value: null, child: Text('Any vehicle'.tr)),
                    for (final c in cats) DropdownMenuItem<int?>(value: int.tryParse('${c['id']}'), child: Text('${c['cat_name']}')),
                  ],
                  onChanged: (v) => setState(() => _categoryId = v),
                ),
                const SizedBox(height: 6),
                Text('Drivers are still checked against the weight and size of your goods.'.tr, style: AppText.caption(p.inkMuted)),
                const SizedBox(height: 8),
              ],
            ),
          ]),

          // 3. Price and timing
          CustomiseSection(step: 3, title: 'Your price', subtitle: 'Drivers can accept it or send you their own price', children: [
            CustomiseField(label: 'Price you want to pay', controller: _fare, number: true, decimal: true, prefix: '₹ ', big: true),
            _timeTile('Offers open from', _start, (v) => _start = v),
            _timeTile('Offers close at', _expiry, (v) => _expiry = v),
            Text('Keep offers open for'.tr, style: AppText.caption(p.inkMuted)),
            const SizedBox(height: 8),
            _windowChips(),
          ]),

          // Optional handling
          CustomiseSection(
            title: 'Extra help (optional)',
            subtitle: 'Floors, helpers and waiting time. Leave as it is if not needed',
            children: [
              CustomiseMore(
                icon: Icons.north_east_rounded,
                title: 'At pickup',
                subtitle: 'Floor, helpers, loading time',
                children: [
                  _row2(CustomiseField(label: 'Floor', controller: _pFloor, number: true),
                      CustomiseField(label: 'Carry distance (m)', controller: _pCarry, number: true)),
                  _row2(CustomiseField(label: 'Helpers needed', controller: _pHelpers, number: true),
                      CustomiseField(label: 'Loading time (min)', controller: _pLoad, number: true)),
                  CustomiseField(label: 'Waiting time (min)', controller: _pWait, number: true),
                  CustomiseField(label: 'Loading instructions', controller: _pNotes, lines: 2),
                ],
              ),
              CustomiseMore(
                icon: Icons.south_east_rounded,
                title: 'At drop',
                subtitle: 'Floor, helpers, unloading time',
                children: [
                  _row2(CustomiseField(label: 'Floor', controller: _dFloor, number: true),
                      CustomiseField(label: 'Carry distance (m)', controller: _dCarry, number: true)),
                  _row2(CustomiseField(label: 'Helpers needed', controller: _dHelpers, number: true),
                      CustomiseField(label: 'Unloading time (min)', controller: _dUnload, number: true)),
                  CustomiseField(label: 'Waiting time (min)', controller: _dWait, number: true),
                  CustomiseField(label: 'Unloading instructions', controller: _dNotes, lines: 2),
                ],
              ),
            ],
          ),
          const CustomiseHowItWorks(),
        ],
      ),
    );
  }
}
