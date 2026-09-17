import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../Api/config.dart';
import '../../utils/colors.dart';

class VehicleDetailsScreen extends StatelessWidget {
  final Map<String, dynamic> category;
  final List<String> notes;

  const VehicleDetailsScreen({super.key, required this.category, this.notes = const []});

  String _text(dynamic value) => value?.toString().trim() ?? '';

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);

    final catName = _text(category['cat_name']).isEmpty ? 'Vehicle' : _text(category['cat_name']);
    final detailImage = _text(category['detail_image']).isNotEmpty ? _text(category['detail_image']) : _text(category['cat_img']);
    final maxLoad = _text(category['max_load_kg']);
    final maxDimensions = _text(category['max_dimensions']);

    final allNotes = <String>[
      ...notes,
      if (maxLoad.isNotEmpty || maxDimensions.isNotEmpty)
        'Loading capacity:' +
            (maxLoad.isNotEmpty ? ' Max Load: $maxLoad kg' : '') +
            (maxDimensions.isNotEmpty ? '  Max Size: $maxDimensions' : ''),
    ];

    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppBar(
        backgroundColor: notifier.lightBgColor,
        elevation: 0,
        iconTheme: IconThemeData(color: notifier.text),
        title: Text(catName, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 18)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
        children: [
          if (detailImage.isNotEmpty)
            Container(
              height: 180,
              decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(16)),
              child: FadeInImage.assetNetwork(
                placeholder: 'assets/loading.gif',
                image: '${Config.nodeImageURLPath}$detailImage',
                fit: BoxFit.contain,
                imageErrorBuilder: (_, __, ___) => Icon(Icons.local_shipping_outlined, color: greaycolor, size: 56),
              ),
            ),
          const SizedBox(height: 18),

          if (maxDimensions.isNotEmpty) ...[
            Builder(builder: (context) {
              // maxDimensions is formatted server-side as "L x W x H unit"
              // (see orderAvailabilityController.formatVehicleSpecs) - split
              // on the literal " x " separator, then strip the trailing unit
              // off the last (height) part. Plain index checks, not
              // elementAtOrNull (that's package:collection, not core Dart).
              final parts = maxDimensions.split(' x ');
              final length = parts.isNotEmpty ? parts[0] : '';
              final width = parts.length > 1 ? parts[1] : '';
              final heightWithUnit = parts.length > 2 ? parts[2] : '';
              final heightParts = heightWithUnit.split(' ');
              final height = heightParts.isNotEmpty ? heightParts[0] : '';
              return Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                _dimensionStat('Length', length),
                _dimensionStat('Width', width),
                _dimensionStat('Height', height),
              ]);
            }),
            const SizedBox(height: 18),
          ],

          if (maxLoad.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              decoration: BoxDecoration(border: Border.all(color: notifier.bordecolor), borderRadius: BorderRadius.circular(14)),
              child: Column(children: [
                Text('$maxLoad KG', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 26)),
                const SizedBox(height: 2),
                Text('MAX LOAD CAPACITY', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Bold', fontSize: 11, letterSpacing: 0.5)),
              ]),
            ),
          const SizedBox(height: 18),

          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            _badge(Icons.verified_user_outlined, 'Safe & Secure'),
            _badge(Icons.bolt_outlined, 'Fast Delivery'),
            _badge(Icons.account_balance_wallet_outlined, 'Affordable'),
          ]),
          const SizedBox(height: 18),

          if (allNotes.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(14)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var i = 0; i < allNotes.length; i++)
                  Padding(
                    padding: EdgeInsets.only(bottom: i == allNotes.length - 1 ? 0 : 12),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      CircleAvatar(radius: 11, backgroundColor: linercolor, child: Text('${i + 1}', style: TextStyle(color: Colors.white, fontSize: 11, fontFamily: 'Gilroy_Bold'))),
                      const SizedBox(width: 10),
                      Expanded(child: Text(allNotes[i], style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 13, height: 1.35))),
                    ]),
                  ),
              ]),
            ),
        ],
      ),
    );
  }

  Widget _dimensionStat(String label, String value) => Column(children: [
        Text(value, style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 18)),
        Text(label, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
      ]);

  Widget _badge(IconData icon, String label) => Column(children: [
        CircleAvatar(radius: 20, backgroundColor: linercolor, child: Icon(icon, color: Colors.white, size: 18)),
        const SizedBox(height: 6),
        Text(label, textAlign: TextAlign.center, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 11)),
      ]);
}
