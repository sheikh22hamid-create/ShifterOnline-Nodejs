// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';

// मुख्य Theme Color - इसे change करके app का primary color बदल सकते हैं
Color linercolor = const Color(0xffFF6B35); // Changed from blue to orange

Color litelinercolor = const Color(0xffFF6B35).withOpacity(0.2); // Updated to match new primary color

Color lightbgcolor = const Color(0xFFF7F7F7);

Color greaycolor = const Color(0xff636977); // = AppPalette.light.inkSubtle (redesign 2026-11-16)

Color whitecolor = Colors.white;

Color blackcolor = Colors.black;

Color lightpinkcolor = const Color(0XFFFFE5E8);

Color orangecolor = const Color(0xffE68C00);

Color pnkcolor = const Color(0xffFFE5E8);

Color pbordercolor = const Color(0xffDEE3E7);

Color greencolor = const Color(0xff04D80D);

Color lightgrey = const Color(0xffD8D8D8);

Color bluecolor = const Color(0xff133BB7);

class ColorNotifier with ChangeNotifier {
  bool isDark = false;
  set setIsDark(value) {
    isDark = value ?? false;
    notifyListeners();
  }

  get getIsDark => isDark;
  get getBgColor => isDark ? const Color(0xFF252525) : const Color(0xffFFFFFF);
  get text => isDark ? const Color(0xffFFFFFF) : const Color(0xff15171C);
  get lightBgColor => isDark ?  const Color(0xff030303) : Color(0xFFF7F7F7);
  get getContainer => isDark ? const Color(0xff323233) : Colors.white;
  get getlightContainer => isDark ? const Color(0xff6F6F70) : const Color(0xffE5EBFC);
  get getimag => isDark ? const Color(0xFF79797A) : Color(0xffF2F4F9);//Colors.grey.shade200;
  get appBlueColor => isDark ? Colors.white : Color(0xFFFF6B35); // Updated to match new primary color
  get bordecolor => isDark ? const Color(0xff414141) : const Color(0xffE8E8E8);
  get lightThemColor => isDark ? Color(0xFF252525): Color(0xFFF5F8FD);
  get darklinercolor => isDark ? Color(0xffFFFFFF) : Color(0xffFF6B35); // Updated to match new primary color
}

ColorNotifier notifier = ColorNotifier();
