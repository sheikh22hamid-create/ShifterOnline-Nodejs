import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'language_config.dart';
import 'package:provider/provider.dart';

class LanguageScreen extends StatefulWidget {
  const LanguageScreen({super.key});

  @override
  State<LanguageScreen> createState() => _LanguageScreenState();
}

class _LanguageScreenState extends State<LanguageScreen> {
 // Selected row is derived from the saved language code, so it stays
  // correct for users who picked a language from the old (international) list.
  int _value = appLanguageIndex(getdata.read("lan2")?.toString());

  final List<AppLanguage> locale = appLanguages;

  updateLanguage(Locale locale) {
    save("lan1", locale.countryCode);
    save("lan2", locale.languageCode);
    debugPrint("------- lan1 ------- ${getdata.read("lan1")}");
    debugPrint("------- lan2 ------- ${getdata.read("lan2")}");
    Get.updateLocale(locale);
    Get.offAll(Bottombar(tabIndex: 3));
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: appbar(tital: "Language".tr),
      body: Container(
        width: Get.width,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: SizedBox(
          height: Get.size.height,
          width: Get.size.width,
          child: SingleChildScrollView(
            physics: BouncingScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(left: 15, top: 10),
                  child: Text(
                    "Suggested".tr,
                    style: TextStyle(
                      fontSize: 18,
                      color: notifier.text,
                      fontFamily: "Gilroy_Bold",
                    ),
                  ),
                ),
                SizedBox(height: 10),
                ListView.separated(
                  itemCount: locale.length,
                  shrinkWrap: true,
                  padding: EdgeInsets.symmetric(horizontal: 15),
                  physics: NeverScrollableScrollPhysics(),
                  itemBuilder: (context, index) {
                    return InkWell(
                      onTap: () {
                        setState(() {
                          _value = index;
                          updateLanguage(locale[index].locale);
                        });
                      },
                      child: languageWidget(
                        name: locale[index].name,
                        color: _value == index
                          ? notifier.darklinercolor
                          : notifier.getBgColor,
                        value: index,
                        radio: Radio(
                          value: index,
                          fillColor: WidgetStatePropertyAll(linercolor),
                          groupValue: _value,
                          hoverColor: linercolor,
                          onChanged: (value4) {
                            setState(() {});
                          },
                        ),
                      ),
                    );
                  }, separatorBuilder: (BuildContext context, int index) => SizedBox(height: 10),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget languageWidget({
    String? name,
    int? value,
    void Function(int?)? onChanged,
    radio,required Color color,
  }) {
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Padding(
        padding: EdgeInsets.only(left: 15),
        child: Row(
          children: [
            Text(
              name ?? "",
              style: TextStyle(
                fontSize: 16,
                color: notifier.text,
                fontFamily: 'Gilroy_Medium',
              ),
            ),
            Spacer(),
            radio,
          ],
        ),
      ),
    );
  }
}