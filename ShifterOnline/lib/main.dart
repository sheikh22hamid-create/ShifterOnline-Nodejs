import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:goParcel/Api/Config.dart';
import 'package:goParcel/Language/language_string.dart';
import 'package:goParcel/firebase_options.dart';
import 'package:goParcel/screens/home/chatscreen.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/splashscreen/splashscreen.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/Language/language_config.dart';
import 'package:onesignal_flutter/onesignal_flutter.dart';
import 'package:provider/provider.dart';

// Global FCM Token variable
String fcmToken = "";

void main() async {
  await GetStorage.init();
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  initPlatformState();
  await permission();
  requestPermission();
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]).then((_) { 
    runApp(MyApp());
  });
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  
  @override
  void initState() {
    NotificationService.initialize(context);
    super.initState();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (context) => ColorNotifier(),
        ),
      ],
      child: GetMaterialApp(
        themeMode: ThemeMode.light,
        translations: LocalString(),
        theme: ThemeData(
          fontFamily: "Gilroy_Regular",
          useMaterial3: false,
          splashColor: Colors.transparent,
          hoverColor: Colors.transparent,
          highlightColor: Colors.transparent,
        ),
        debugShowCheckedModeBanner: false,
        home: SplashScreen(),
        locale: resolveAppLocale(getdata.read("lan2")?.toString()),
        fallbackLocale: fallbackAppLocale,
      ),
    );
  }
}

Future<void> initPlatformState() async {
  OneSignal.Debug.setLogLevel(OSLogLevel.verbose);
  OneSignal.initialize(Config.oneSignel);
  OneSignal.Notifications.requestPermission(true).then((value) {
    debugPrint("Signal value:- $value");
  });
}



permission() async{
  LocationPermission permission;
  permission = await Geolocator.checkPermission();
  permission = await Geolocator.requestPermission();
  if (permission == LocationPermission.denied) {
    if (Platform.isAndroid) {
      SystemNavigator.pop();
    } else if (Platform.isIOS) {
      exit(0);
    }
  }
}

Future<String> getDeviceId() async {
  DeviceInfoPlugin deviceInfo = DeviceInfoPlugin();
  try {
    if (Platform.isAndroid) {
      AndroidDeviceInfo androidInfo = await deviceInfo.androidInfo;
      return androidInfo.id;
    } else if (Platform.isIOS) {
      IosDeviceInfo iosInfo = await deviceInfo.iosInfo;
      return iosInfo.identifierForVendor ?? "";
    }
  } catch (e) {
    debugPrint("Failed to get device ID: $e");
  }
  return "";
}
