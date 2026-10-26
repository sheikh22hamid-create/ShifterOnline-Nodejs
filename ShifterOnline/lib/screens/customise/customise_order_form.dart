// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_google_places_hoc081098/flutter_google_places_hoc081098.dart';
import 'package:get/get.dart';
import 'package:google_maps_webservice/places.dart';
import 'package:provider/provider.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import '../home/home.dart'; // pickupiteam: the vehicle categories already loaded for the home screen
import 'customise_api.dart';
import 'customise_order_detail.dart';

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

  Future<_Place?> _pickPlace() async {
    try {
      final p = await PlacesAutocomplete.show(
        context: context,
        apiKey: Config.googleApikey,
        mode: Mode.overlay,
        types: ['address'],
        strictbounds: false,
        components: [Component(Component.country, 'IN')],
        onError: (err) => debugPrint('Place search error: $err'),
      );
      final id = p?.placeId;
      if (p == null || id == null) return null;
      final details = await GoogleMapsPlaces(apiKey: Config.googleApikey).getDetailsByPlaceId(id);
      final loc = details.result.geometry?.location;
      if (loc == null) {
        tostmsg('Could not read that location. Please pick another one.');
        return null;
      }
      return _Place(p.description ?? details.result.formattedAddress ?? '', loc.lat, loc.lng);
    } catch (e) {
      debugPrint('Customise place search failed: $e');
      tostmsg('Error searching location. Please try again.');
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

  Widget _card(String title, List<Widget> children) => Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: notifier.getContainer, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 15)),
          const SizedBox(height: 10),
          ...children,
        ]),
      );

  Widget _input(String label, TextEditingController c, {bool number = false, bool decimal = false, int lines = 1, String? hint}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          controller: c,
          maxLines: lines,
          keyboardType: number ? (decimal ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.number) : TextInputType.text,
          inputFormatters: number ? [FilteringTextInputFormatter.allow(RegExp(decimal ? r'[0-9.]' : r'[0-9]'))] : null,
          style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium'),
          decoration: InputDecoration(labelText: label, hintText: hint, border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)), isDense: true),
        ),
      );

  Widget _row2(Widget a, Widget b) => Row(children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)]);

  Widget _placeTile(String label, _Place? place, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(border: Border.all(color: greaycolor.withOpacity(0.4)), borderRadius: BorderRadius.circular(10)),
          child: Text(place?.address ?? label, style: TextStyle(color: place == null ? greaycolor : notifier.text, fontFamily: 'Gilroy_Medium')),
        ),
      );

  Widget _timeTile(String label, DateTime value, ValueChanged<DateTime> onPicked) => InkWell(
        onTap: () async {
          final picked = await _pickDateTime(value);
          if (picked != null) setState(() => onPicked(picked));
        },
        child: Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(border: Border.all(color: greaycolor.withOpacity(0.4)), borderRadius: BorderRadius.circular(10)),
          child: Row(children: [
            Icon(Icons.schedule, size: 18, color: linercolor),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium'))),
            Text(_show(value), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold')),
          ]),
        ),
      );

  Widget _stopCard(int index) {
    final s = _stops[index];
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(border: Border.all(color: linercolor.withOpacity(0.4)), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('Stop ${index + 1}', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold'))),
          IconButton(
            icon: const Icon(Icons.delete_outline, color: Colors.red),
            onPressed: () => setState(() => _stops.removeAt(index).dispose()),
          ),
        ]),
        _placeTile('Choose stop location', s.place, () async {
          final p = await _pickPlace();
          if (p != null) setState(() => s.place = p);
        }),
        Wrap(spacing: 8, children: [
          for (final k in const [['pickup', 'Pick up here'], ['drop', 'Drop here'], ['both', 'Both']])
            ChoiceChip(label: Text(k[1]), selected: s.kind == k[0], onSelected: (_) => setState(() => s.kind = k[0])),
        ]),
        const SizedBox(height: 10),
        _input('Goods at this stop', s.goods),
        _row2(_input('Floor', s.floor, number: true), _input('Carry distance (m)', s.carry, number: true)),
        _row2(_input('Helpers', s.helpers, number: true), _input('Loading (min)', s.loadMin, number: true)),
        _row2(_input('Unloading (min)', s.unloadMin, number: true), _input('Waiting (min)', s.waitMin, number: true)),
        _input('Notes for this stop', s.notes, lines: 2),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final cats = _categories;
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        backgroundColor: linercolor,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(icon: const Icon(Icons.arrow_back_ios, color: Colors.white), onPressed: () => Get.back()),
        title: const Text('Customise Order', style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold', fontSize: 18)),
      ),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(color: notifier.lightBgColor, borderRadius: const BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24))),
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(16, 20, 16, MediaQuery.of(context).viewInsets.bottom + 28),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _card('Route', [
              _placeTile('Choose pickup location', _pickup, () async {
                final p = await _pickPlace();
                if (p != null) setState(() => _pickup = p);
              }),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('Pickup point is exact', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium')),
                subtitle: Text(_pickupExact ? 'The driver goes to this exact spot.' : 'Approximate: you will confirm the exact spot with the driver.', style: TextStyle(color: greaycolor, fontSize: 12)),
                value: _pickupExact,
                activeColor: linercolor,
                onChanged: (v) => setState(() => _pickupExact = v),
              ),
              for (var i = 0; i < _stops.length; i++) _stopCard(i),
              TextButton.icon(
                onPressed: _stops.length >= 5 ? null : () => setState(() => _stops.add(_StopDraft())),
                icon: const Icon(Icons.add_location_alt_outlined),
                label: const Text('Add a stop'),
              ),
              _placeTile('Choose drop location', _drop, () async {
                final p = await _pickPlace();
                if (p != null) setState(() => _drop = p);
              }),
            ]),
            _card('Goods', [
              _input('What are you moving?', _goodsDesc, lines: 2, hint: 'e.g. 2 sofas and a dining table'),
              _row2(_input('Number of items', _qty, number: true), _input('Total weight (kg)', _weight, number: true, decimal: true)),
              Text('Size of the largest item (optional)', style: TextStyle(color: greaycolor, fontSize: 12)),
              const SizedBox(height: 6),
              Row(children: [
                Expanded(child: _input('Length cm', _len, number: true, decimal: true)),
                const SizedBox(width: 8),
                Expanded(child: _input('Width cm', _wid, number: true, decimal: true)),
                const SizedBox(width: 8),
                Expanded(child: _input('Height cm', _hgt, number: true, decimal: true)),
              ]),
              _input('Packing and handling needs', _packing, lines: 2, hint: 'Fragile, needs wrapping, keep upright…'),
            ]),
            _card('At pickup', [
              _row2(_input('Floor', _pFloor, number: true), _input('Carry distance (m)', _pCarry, number: true)),
              _row2(_input('Helpers needed', _pHelpers, number: true), _input('Loading time (min)', _pLoad, number: true)),
              _input('Waiting time (min)', _pWait, number: true),
              _input('Loading instructions', _pNotes, lines: 2),
            ]),
            _card('At drop', [
              _row2(_input('Floor', _dFloor, number: true), _input('Carry distance (m)', _dCarry, number: true)),
              _row2(_input('Helpers needed', _dHelpers, number: true), _input('Unloading time (min)', _dUnload, number: true)),
              _input('Waiting time (min)', _dWait, number: true),
              _input('Unloading instructions', _dNotes, lines: 2),
            ]),
            _card('Vehicle (optional)', [
              DropdownButtonFormField<int?>(
                value: _categoryId,
                isExpanded: true,
                decoration: InputDecoration(border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)), isDense: true),
                items: [
                  const DropdownMenuItem<int?>(value: null, child: Text('Any vehicle')),
                  for (final c in cats) DropdownMenuItem<int?>(value: int.tryParse('${c['id']}'), child: Text('${c['cat_name']}')),
                ],
                onChanged: (v) => setState(() => _categoryId = v),
              ),
              const SizedBox(height: 6),
              Text('Drivers are still checked against the weight and size of your goods.', style: TextStyle(color: greaycolor, fontSize: 12)),
            ]),
            _card('Your price and timing', [
              _input('Your offered price (₹)', _fare, number: true, decimal: true),
              _timeTile('Bargaining starts', _start, (v) => _start = v),
              _timeTile('Offers close (expiry)', _expiry, (v) => _expiry = v),
              Text('Drivers can accept your price or send their own until the expiry time.', style: TextStyle(color: greaycolor, fontSize: 12)),
            ]),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: linercolor, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                onPressed: _saving ? null : _submit,
                child: _saving
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('Post Customise Order', style: TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold', fontSize: 16)),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
