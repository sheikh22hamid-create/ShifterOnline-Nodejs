import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/booking_guidelines.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

const _items = [
  (icon: Icons.engineering_outlined, text: 'Fare does not include loading / unloading labour charges.'),
  (icon: Icons.toll_outlined, text: 'Toll, state taxes & parking charges to be borne by customer.'),
  (icon: Icons.block_outlined, text: 'No toxic, hazardous, illegal, or explosive items permitted.'),
];

void main() {
  testWidgets('renders the title and every item', (tester) async {
    await tester.pumpWidget(_host(const BookingGuidelines(title: 'Important Booking Guidelines', items: _items)));
    expect(find.text('Important Booking Guidelines'), findsOneWidget);
    for (final i in _items) {
      expect(find.text(i.text), findsOneWidget);
    }
  });

  testWidgets('uses the warning tint', (tester) async {
    await tester.pumpWidget(_host(const BookingGuidelines(title: 'x', items: _items)));
    final c = tester.widgetList<Container>(
        find.descendant(of: find.byType(BookingGuidelines), matching: find.byType(Container))).first;
    expect((c.decoration as BoxDecoration).color, AppPalette.light.warningTint);
  });

  testWidgets('long texts at width 320, textScale 1.3 do not overflow', (tester) async {
    await tester.pumpWidget(_host(const BookingGuidelines(title: 'महत्वपूर्ण बुकिंग दिशानिर्देश', items: _items),
        width: 320, textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
