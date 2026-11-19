import 'app_tokens.dart';

/// Google Maps style for dark mode (a calm night map, so the map does not flash white in dark theme).
const String kDarkMapStyle = '[{"elementType":"geometry","stylers":[{"color":"#1f2126"}]},'
    '{"elementType":"labels.icon","stylers":[{"visibility":"off"}]},'
    '{"elementType":"labels.text.fill","stylers":[{"color":"#9aa0a6"}]},'
    '{"elementType":"labels.text.stroke","stylers":[{"color":"#1f2126"}]},'
    '{"featureType":"poi","elementType":"geometry","stylers":[{"color":"#26292f"}]},'
    '{"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#1d2b24"}]},'
    '{"featureType":"road","elementType":"geometry","stylers":[{"color":"#33373e"}]},'
    '{"featureType":"road","elementType":"geometry.stroke","stylers":[{"color":"#212328"}]},'
    '{"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#454a52"}]},'
    '{"featureType":"transit","elementType":"geometry","stylers":[{"color":"#2a2d33"}]},'
    '{"featureType":"water","elementType":"geometry","stylers":[{"color":"#0f1a24"}]}]';

/// Style for the current theme: the dark style in dark mode, Google's default otherwise.
String? currentMapStyle() => AppPalette.current == AppPalette.dark ? kDarkMapStyle : null;
