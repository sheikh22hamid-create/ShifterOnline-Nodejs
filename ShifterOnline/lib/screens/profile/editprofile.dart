// ignore_for_file: prefer_typing_uninitialized_variables

import 'dart:convert';
import 'dart:developer';
import 'dart:io';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../../utils/colors.dart';
import '../../../utils/customewidget/customwidgets.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';

import '../home/home.dart';
import '../../theme/app_tokens.dart';
import '../../theme/widgets/app_buttons.dart';
import '../../theme/widgets/app_top_bar.dart';

class EditProfile extends StatefulWidget {
  const EditProfile({super.key});

  @override
  State<EditProfile> createState() => _EditProfileState();
}

class _EditProfileState extends State<EditProfile> {
  TextEditingController number = TextEditingController();
  TextEditingController fullname = TextEditingController();
  TextEditingController email = TextEditingController();
  String? path;
  String networkimage = "";
  String? base64Image;
  var userdata;

  final ImagePicker imgpicker = ImagePicker();
  PickedFile? imageFile;
  List imageList = [];

  bool isLoding = false;

  @override
  void initState() {
    super.initState();
    number = TextEditingController(text: "${getdata.read("UserLogin")["mobile"]}");
    fullname = TextEditingController(text: "${getdata.read("UserLogin")["name"]}");
    email = TextEditingController(text: "${getdata.read("UserLogin")["email"]}");
    networkimage = "${getdata.read("UserLogin")["r_img"]}";
    debugPrint("========== image path ========== $path");
    setState(() {});
  }

  //! network base64Image
  networkimageconvert() {
    if (!Config.isValidImageUrl(networkimage)) return;
    (() async {
      http.Response response = await http.get(
        Uri.parse(Config.resolveImageUrl(networkimage)),
      );
      if (mounted) {
        setState(() {
          base64Image = const Base64Encoder().convert(response.bodyBytes);
          debugPrint(base64Image);
        });
      }
    })();
  }

  bool get _changed =>
      getdata.read("UserLogin")["mobile"] != number.text ||
      getdata.read("UserLogin")["name"] != fullname.text ||
      getdata.read("UserLogin")["email"] != email.text ||
      path != null;

  void _onSave() {
    if (!_changed) return;
    if ((RegExp(r"^[a-zA-Z0-9.a-zA-Z0-9.!#$%&'*+-/=?^_`{|}~]+@[a-zA-Z0-9]+\.[a-zA-Z]+").hasMatch(email.text))) {
      // saveProfile uploads the new photo itself once the details are saved (only when one was picked).
      saveProfile();
    } else {
      tostmsg("Please enter valid email address".tr);
    }
  }

  Widget _field({
    required String label,
    required String hint,
    required TextEditingController controller,
    required IconData icon,
    required TextInputType keyboardType,
  }) {
    final p = AppPalette.current;
    final border = OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.input), borderSide: BorderSide(color: p.line));
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppText.caption(p.inkMuted).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 12.5)),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            readOnly: isLoding,
            keyboardType: keyboardType,
            onChanged: (_) => setState(() {}),
            style: AppText.body(p.ink).copyWith(fontSize: 15),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: AppText.body(p.inkSubtle).copyWith(fontSize: 15),
              prefixIcon: Icon(icon, color: p.inkMuted, size: 20),
              filled: true,
              fillColor: p.surface,
              border: border,
              enabledBorder: border,
              focusedBorder: border.copyWith(borderSide: BorderSide(color: p.brand, width: 1.5)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _avatar() {
    final p = AppPalette.current;
    final name = fullname.text.trim();
    final initials = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w[0].toUpperCase()).join();
    Widget fallback() => Container(
          color: p.brandTint,
          alignment: Alignment.center,
          child: Text(initials.isEmpty ? 'S' : initials, style: AppText.title(p.brandText).copyWith(fontSize: 36)),
        );
    final Widget image = path != null
        ? Image.file(File(path.toString()), fit: BoxFit.cover)
        : Config.isValidImageUrl(networkimage)
            ? Image.network(Config.resolveImageUrl(networkimage), fit: BoxFit.cover, errorBuilder: (_, __, ___) => fallback())
            : fallback();
    return Semantics(
      button: true,
      label: 'Change photo'.tr,
      child: GestureDetector(
        onTap: () {
          if (!isLoding) _openGallery(context);
        },
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 112,
              height: 112,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: p.surface, width: 4),
                boxShadow: AppShadow.card,
              ),
              child: ClipOval(child: image),
            ),
            Positioned(
              right: 0,
              bottom: 2,
              child: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: p.brand,
                  shape: BoxShape.circle,
                  border: Border.all(color: p.surface, width: 3),
                ),
                child: Icon(Icons.camera_alt_rounded, size: 17, color: p.onBrand),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    final p = AppPalette.current;
    final changed = _changed;
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppTopBar(title: "Edit Profile".tr, subtitle: "Your name, number and email".tr),
      bottomNavigationBar: Material(
        color: p.surface,
        child: Padding(
          padding: EdgeInsets.fromLTRB(
              16, 10, 16, MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).padding.bottom + 10),
          child: isLoding
              ? SizedBox(height: 52, child: Center(child: SpinKitThreeBounce(color: p.brand, size: 25.0)))
              : AppPrimaryButton(
                  label: (changed ? "Save changes" : "No changes yet").tr,
                  onPressed: changed ? _onSave : null,
                ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
        children: [
          Center(child: _avatar()),
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              onPressed: isLoding ? null : () => _openGallery(context),
              child: Text("Change photo".tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 4),
            decoration: BoxDecoration(
              color: p.surface,
              borderRadius: BorderRadius.circular(AppRadius.card),
              boxShadow: AppShadow.card,
            ),
            child: Column(
              children: [
                _field(
                  label: "Full Name".tr,
                  hint: "Enter your name".tr,
                  controller: fullname,
                  icon: Icons.person_outline_rounded,
                  keyboardType: TextInputType.name,
                ),
                _field(
                  label: "Phone Number".tr,
                  hint: "Enter your number".tr,
                  controller: number,
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.number,
                ),
                _field(
                  label: "Email".tr,
                  hint: "Enter your Email".tr,
                  controller: email,
                  icon: Icons.mail_outline_rounded,
                  keyboardType: TextInputType.emailAddress,
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.receipt_long_outlined, size: 16, color: p.inkSubtle),
              const SizedBox(width: 6),
              Expanded(
                child: Text("Booking receipts and trip invoices are sent to this email.".tr,
                    style: AppText.caption(p.inkSubtle).copyWith(fontSize: 12.5, height: 1.35)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _openGallery(BuildContext context) async {
    final pickedFile =
        await ImagePicker().pickImage(source: ImageSource.gallery);
    if (pickedFile != null) {
      path = pickedFile.path;
      setState(() {});
      File imageFile = File(path.toString());
      List<int> imageBytes = imageFile.readAsBytesSync();
      base64Image = base64Encode(imageBytes);
      debugPrint("---------- base64Image ------------ $base64Image");
      setState(() {});
    }
  }

  saveProfile() {
    var uid = getdata.read("Uid") ?? "";
    var body = {
      "fname": fullname.text.toString(),
      "email": email.text.toString(),
      "mobile": number.text.toString(),
      "uid": uid,
    };

    isLoding = true;
    setState(() {});

    log(body.toString(), name: "Save Update ======== >>>>> ");
    ApiWrapper.dataPostNode(Config.nodeProfileUpdate, body).then((val) {
      log(val.toString());
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
          save("UserLogin", val["UserLogin"]);
          
          // If there's a new image, upload it
          if (base64Image != null && base64Image!.isNotEmpty) {
            imageupload(base64Image);
          } else {
            Get.back();
            ApiWrapper.showToastMessage(val["ResponseMsg"]);
            isLoding = false;
            setState(() {});
          }
        } else {
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
          isLoding = false;
          setState(() {});
        }
      }
    });
  }

  imageupload(String? base64image) {
    var uid = getdata.read("Uid") ?? "";
    var body = {"uid": uid, "img": base64image};

    isLoding = true;
    setState(() {});
    log(body.toString(), name: "----------- image upload body ---------");
    
    ApiWrapper.dataPostNode(Config.nodeProfileImage, body).then((val) {
      log(val.toString(), name: "----------- image upload response ---------");
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          // Update the local storage with new image data
          var userData = getdata.read("UserLogin");
          userData["r_img"] = val["UserLogin"]["r_img"];
          save("UserLogin", userData);
          
          Get.back();
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
          isLoding = false;
          setState(() {});
        } else {
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
          isLoding = false;
          setState(() {});
        }
      } else {
        ApiWrapper.showToastMessage("Image upload failed".tr);
        isLoding = false;
        setState(() {});
      }
    });
  }
}
