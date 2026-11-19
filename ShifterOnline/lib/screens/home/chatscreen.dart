// ignore_for_file: deprecated_member_use

import 'package:goParcel/theme/app_tokens.dart';
import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_phone_direct_caller/flutter_phone_direct_caller.dart';
import 'package:flutter_svg/svg.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/services/notification_router.dart';
import 'package:goParcel/utils/notification_target.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:googleapis_auth/auth_io.dart';
import '../../firebase_service_account.dart'; // local only, gitignored - holds the Firebase service account key
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'package:goParcel/main.dart';


bool isChatScreenOpen = false; // Track chat screen state

class Chat extends StatefulWidget {
  final String receiverId;
  final String receiverMobile;
  final String receiverName;
  final String receiverImage;
  const Chat({
    super.key,
    required this.receiverId,
    required this.receiverMobile,
    required this.receiverName,
    required this.receiverImage,
  });

  @override
  State<Chat> createState() => _ChatState();
}

class _ChatState extends State<Chat> {
  var uid = getdata.read("Uid");

  bool isLoading = false;

  final TextEditingController _controller = TextEditingController();
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  String getChatId({required String user1, required String user2}) {
    List<String> ids = [user1, user2];
    ids.sort();
    return "${ids[0]}_${ids[1]}";
  }

  Future<String?> getReceiverToken(String receiverId) async {
    try {
      // Try CustomerParcel collection first (for customer app)
      DocumentSnapshot? userDoc = await FirebaseFirestore.instance.collection('CustomerParcel').doc(receiverId).get();
      if (userDoc.exists && userDoc.data() != null) {
        debugPrint("-------------- token from CustomerParcel ------------- ${userDoc["token"]}");
        return userDoc["token"];
      }
      
      // If not found, try RiderParcel collection (for rider/driver app)
      userDoc = await FirebaseFirestore.instance.collection('RiderParcel').doc(receiverId).get();
      if (userDoc.exists && userDoc.data() != null) {
        debugPrint("-------------- token from RiderParcel ------------- ${userDoc["token"]}");
        return userDoc["token"];
      }
      
      debugPrint("❌ Token not found for receiverId: $receiverId");
      return null;
    } catch (e) {
      debugPrint("❌ Error getting receiver token: $e");
      return null;
    }
  }

  void sendMessage() async {
    if (_controller.text.isNotEmpty) {
      String senderId = uid;
      String chatId = getChatId(user1: widget.receiverId, user2: senderId);

      debugPrint("============= chatId ======== $chatId");

      await _firestore
          .collection('Parcelchats')
          .doc(chatId)
          .collection('messages')
          .add({
        'message': _controller.text,
        'senderId': senderId,
        'receiverId': widget.receiverId,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });


      String? receiverToken = await getReceiverToken(widget.receiverId);
      debugPrint("----------- receiverToken ------------- $receiverToken");

      if (receiverToken != null) {
        sendPushNotification(receiverToken, _controller.text, "${getdata.read("UserLogin")["name"]}");
      }
      setState(() {
        _controller.clear();
        isLoading = true;
      });

    }
  }
  
  void sendPushNotification(String receiverToken, String message, String senderName) async {
    try {
      var body = {
        "message": {  // Wrap inside "message"
          "token": receiverToken,  // Device token instead of "to"
          "notification": {
            "title": senderName,
            "body": message,
          },
          "data": { // Custom data
            "click_action": "FLUTTER_NOTIFICATION_CLICK",
            "receiverId": uid,
          }
        }
      };

      debugPrint("+++++++++++++++++ Config.firebaseKey :---- ${Config.firebaseKey}");
      debugPrint("+++++++++++++++++ Using projectID :---- ${Config.projectID}");
      debugPrint("+++++++++++++++++ Sender FCM token :---- $fcmToken");

      var response =  await http.post(
        Uri.parse('https://fcm.googleapis.com/v1/projects/${Config.projectID}/messages:send'),
        headers: <String, String>{ 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${Config.firebaseKey}',
        },
        body: jsonEncode(body),
      );
      debugPrint("---------- url ---------- https://fcm.googleapis.com/v1/projects/${Config.projectID}/messages:send");
      debugPrint("--------- body ---------- $body");
      debugPrint("-------- headers -------- ${response.headers}");
      debugPrint("-------- respons -------- ${response.body}");
    } catch (e) {
      debugPrint("Error sending push notification: $e");
    }
  }
  
  @override
  void initState() {
    super.initState();
    isChatScreenOpen = true; // Mark chat screen as open
    debugPrint("------------- is chatScreen Open :----- $isChatScreenOpen");
  }

  @override
  void dispose() {
    isChatScreenOpen = false; // Mark chat screen as closed
    debugPrint("------------- is chatScreen Open :----- $isChatScreenOpen");
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    String chatId = getChatId(user1: widget.receiverId, user2: uid);
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: AppPalette.current.brand,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: AppPalette.current.brand,
        titleSpacing: 0,
        leadingWidth: 30,
        title: ListTile(
          leading: ClipOval(
            child: Config.isValidImageUrl(widget.receiverImage)
                ? Image.network(
                    Config.resolveImageUrl(widget.receiverImage),
                    height: 40,
                    width: 40,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => CircleAvatar(
                      backgroundColor: AppPalette.current.onBrand.withValues(alpha: 0.15),
                      child: Icon(Icons.person, color: AppPalette.current.onBrand),
                    ),
                  )
                : CircleAvatar(
                    backgroundColor: AppPalette.current.onBrand.withValues(alpha: 0.15),
                    child: Icon(Icons.person, color: AppPalette.current.onBrand),
                  ),
          ),
          title: Text(
            widget.receiverName,
            style: TextStyle(
              color: AppPalette.current.onBrand,
              fontFamily: "Gilroy_Bold",
            ),
          ),
        ),
        actions: [
          InkWell(
            onTap: () async {
              await FlutterPhoneDirectCaller.callNumber(widget.receiverMobile);
            },
            child: Container(
              margin: EdgeInsets.only(right: 10),
              padding: EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppPalette.current.onBrand.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: Center(child: Icon(Icons.call, size: 20, color: AppPalette.current.onBrand)),
            ),
          ),
        ],
      ),
      body: Container(
        height: Get.height,
        width: Get.width,
        padding: EdgeInsets.only(top: 4),
        decoration: BoxDecoration(
          color: AppPalette.current.canvas,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Column(
          children: [
            Expanded(
              child: StreamBuilder(
                stream: _firestore
                    .collection('Parcelchats')
                    .doc(chatId)
                    .collection('messages')
                    .orderBy('timestamp', descending: true)
                    .snapshots(),
                builder: (context, AsyncSnapshot<QuerySnapshot> snapshot) {
                  if (!snapshot.hasData) return Center(child: CircularProgressIndicator(color: AppPalette.current.brand));
                  return snapshot.data!.docs.isEmpty
                  ? Center(
                      child: Image.asset(
                        "assets/emptyOrder.png",
                        height: Get.height / 5,
                      ),
                    )
                  : ListView(
                    physics: BouncingScrollPhysics(),
                    padding: EdgeInsets.only(bottom: 0, left: 10,right: 10),
                    reverse: true,
                    children: snapshot.data!.docs.map((doc) {
                      bool isMe = doc['senderId'] == uid;
                      var timestamp = doc['timestamp']; // Fetching from Firestore

                      DateTime dateTime;
                      if (timestamp is Timestamp) {
                        dateTime = timestamp.toDate(); // Correct way to convert Firestore Timestamp
                      } else if (timestamp is int) {
                        dateTime = DateTime.fromMillisecondsSinceEpoch(timestamp); // Handle int timestamp
                      } else {
                        dateTime = DateTime.now(); // Default fallback (optional)
                      }
                      return Align(
                        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                        child: Padding(
                          padding: EdgeInsets.symmetric(vertical: 8),
                          child: Column(
                            crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                            children: [
                              Container(
                                padding: EdgeInsets.symmetric(vertical: 5, horizontal: 10),
                                constraints: BoxConstraints(
                                  maxWidth: Get.width / 1.5
                                ),
                                decoration: BoxDecoration(
                                  color: isMe ? AppPalette.current.brand : AppPalette.current.surface,
                                  borderRadius: BorderRadius.only(
                                    bottomLeft: Radius.circular(isMe ? 10 : 0),
                                    bottomRight: Radius.circular(isMe ? 0 : 10),
                                    topLeft: Radius.circular(10),
                                    topRight: Radius.circular(10),
                                  ),
                                ),
                                child: Text(
                                 "${doc['message']}",
                                  style: TextStyle(
                                    color: isMe ? AppPalette.current.onBrand : AppPalette.current.ink,
                                    fontSize: 17,
                                    fontFamily: "Gilroy_Medium",
                                  ),
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                DateFormat('hh:mm a').format(dateTime),
                                style: TextStyle(
                                  color: AppPalette.current.inkMuted,
                                    fontFamily: "Gilroy_Medium",
                                    fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }).toList(),
                  );
                },
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 10,vertical: 5),
              child: textfild(
                fillColor: AppPalette.current.surface,
                controller: _controller,
                hintText: "Message...".tr,
                onChanged: (value) {
                  setState(() {
                    _controller.text = value;
                  });
                },
                suffixIcon: _controller.text.isEmpty
                ? SizedBox()
                : InkWell(
                  onTap: () {
                    if (_controller.text.isNotEmpty) {
                      sendMessage();
                    }
                  },
                  child: Padding(
                    padding: EdgeInsets.all(8),
                    child: SvgPicture.asset(
                      "assets/send.svg",
                      color: AppPalette.current.brand,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FirebaseAccesstoken {
  static String firebaseMessageScope = "https://www.googleapis.com/auth/firebase.messaging";

  Future<String> getAccessToken() async {
    final credentials = ServiceAccountCredentials.fromJson(firebaseServiceAccountJson);
    debugPrint("+++++++++++++++++1:---- $credentials");
    try{
      final client = await clientViaServiceAccount(credentials, [firebaseMessageScope]);
      debugPrint("+++++++++++++++++2:---- ${client.credentials.accessToken.data}");

      final accessToken = client.credentials.accessToken.data;
      Config.firebaseKey = accessToken;
      debugPrint("+++++++++++++++++3:---- ${Config.firebaseKey}");
      return accessToken;

    }catch(e){
      debugPrint("Error --${e.toString()}");
      return "";
    }

  }
}

final FirebaseMessaging _firebaseMessaging = FirebaseMessaging.instance;

class NotificationService {
  static final FirebaseMessaging _firebaseMessaging = FirebaseMessaging.instance;
  static final FlutterLocalNotificationsPlugin _flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

  /// 🔹 Initialize Notifications (FCM & Local)
  static Future<void> initialize(BuildContext context) async {
    if (Platform.isIOS) {
      await _registerForRemoteNotifications();
    }

    // ✅ Request permission for notifications
    NotificationSettings settings = await _firebaseMessaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      debugPrint("🔔 Notifications Allowed");
    } else {
      debugPrint("🚫 Notifications Denied");
      return;
    }

    // ✅ Ensure APNS Token is available before getting FCM token (iOS only)
    if (Platform.isIOS) {
      await _ensureAPNSToken();
    }

    // ✅ Get FCM Token
    String? token = await _firebaseMessaging.getToken();
    if (token != null) {
      fcmToken = token; // Set global FCM token
      debugPrint("📌 FCM Token: $token");
    } else {
      debugPrint("❌ Failed to get FCM token");
    }

    // ✅ Handle Token Refresh
    _firebaseMessaging.onTokenRefresh.listen((newToken) {
      fcmToken = newToken; // Update global FCM token
      debugPrint("🔄 FCM Token Refreshed: $newToken");
    });

    // ✅ Configure iOS foreground notifications
    if (Platform.isIOS) {
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
    }

    // ✅ Initialize Local Notifications
    const AndroidInitializationSettings androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    final DarwinInitializationSettings iosSettings = DarwinInitializationSettings();
    final InitializationSettings initializationSettings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );

    await _flutterLocalNotificationsPlugin.initialize(
      initializationSettings,
      onDidReceiveNotificationResponse: (NotificationResponse response) {
        debugPrint("📩 Notification Clicked: ${response.payload}");
        _handleNotificationClick(response.payload);
      },
    );

    // ✅ Listen for FCM messages when app is in foreground
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      debugPrint("📩 Foreground Message: ${message.notification?.title}");
      if (message.data['type'] == 'trip_milestone' || !_isChatScreenOpen()) {
        showNotification(message);
      }
    });

    // ✅ Handle notification tap when app is in background
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      debugPrint("📩 Opened App via Notification: ${message.data}");
      _navigateToChat(message.data);
    });

    // ✅ Handle notification tap when app is terminated
    RemoteMessage? initialMessage = await _firebaseMessaging.getInitialMessage();
    if (initialMessage != null) {
      debugPrint("📩 App opened from terminated state via notification");
      _navigateToChat(initialMessage.data);
    }
  }

  /// 🔹 Register for Remote Notifications (iOS)
  static Future<void> _registerForRemoteNotifications() async {
    await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );
  }

  /// 🔹 Ensure APNS Token is available (iOS only)
  static Future<void> _ensureAPNSToken() async {
    if (!Platform.isIOS) return;

    int retryCount = 0;
    String? apnsToken;

    while (apnsToken == null && retryCount < 5) {
      apnsToken = await _firebaseMessaging.getAPNSToken();
      if (apnsToken != null) break;
      
      await Future.delayed(Duration(seconds: 2 * (retryCount + 1))); // Exponential backoff
      retryCount++;
    }

    if (apnsToken != null) {
      debugPrint("✅ APNS Token Retrieved: $apnsToken");
    } else {
      debugPrint("❌ Failed to get APNS token after retries");
    }
  }

  /// 🔹 Show Local Notification (Foreground)
  static final Set<String> _shownTripEvents = <String>{};
  static Future<void> showNotification(RemoteMessage message) async {
    final eventId = message.data['event_id']?.toString();
    if (message.data['type'] == 'trip_milestone' && eventId != null) {
      if (!_shownTripEvents.add(eventId)) return;
      if (_shownTripEvents.length > 200) _shownTripEvents.remove(_shownTripEvents.first);
    }
    const AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
      'high_importance_channel',
      'High Importance Notifications',
      importance: Importance.max,
      priority: Priority.high,
    );

    const NotificationDetails platformDetails = NotificationDetails(android: androidDetails);

    // Prepare payload
    String? payload = message.data.isNotEmpty ? jsonEncode(message.data) : null;

    await _flutterLocalNotificationsPlugin.show(
      eventId == null ? 0 : eventId.hashCode & 0x7fffffff,
      message.notification?.title,
      message.notification?.body,
      platformDetails,
      payload: payload,
    );
  }

  /// 🔹 Handle notification click and navigate to chat
  static void _handleNotificationClick(String? payload) {
    if (payload != null && payload.isNotEmpty) {
      try {
        Map<String, dynamic> data = jsonDecode(payload);
        _navigateToChat(data);
      } catch (e) {
        debugPrint("❌ Error decoding JSON payload: $e");
      }
    }
  }

  /// 🔹 Navigate to chat screen
  static void _navigateToChat(Map<String, dynamic> data) {
    try {
      // Ride, payment and wallet notifications open the screen for their own event and booking (never the chat page);
      // only a real chat message (a receiverId and no ride type) continues below. See NotificationRouter.
      final target = resolveNotificationTarget(data);
      if (target.screen != NotificationScreen.chat) {
        NotificationRouter.handleTap(data);
        return;
      }
      String receiverId = data['receiverId'] ?? "";
      String receiverName = data['receiverName'] ?? "";
      String receiverMobile = data['receiverMobile'] ?? "";
      String receiverImage = data['receiverImage'] ?? "";

      if (receiverId.isNotEmpty) {
        Get.to(Chat(
          receiverId: receiverId,
          receiverMobile: receiverMobile,
          receiverName: receiverName,
          receiverImage: receiverImage,
        ));
      } else {
        debugPrint("❌ Invalid receiver data, cannot navigate to chat.");
      }
    } catch (e) {
      debugPrint("❌ Error navigating to chat: $e");
    }
  }

  /// 🔹 Check if chat screen is open
  static bool _isChatScreenOpen() {
    return isChatScreenOpen; // Use global variable to track chat screen state
  }
}

// ------------------------------------------------------------------
 // Request notification permission (for iOS)
  void requestPermission() async {
    NotificationSettings settings = await _firebaseMessaging.requestPermission(
      alert: true,
      announcement: false,
      badge: true,
      carPlay: false,
      criticalAlert: false,
      provisional: false,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      debugPrint("Notification permission granted");
    } else {
      debugPrint("Notification permission denied");
    }
  }
