// ignore_for_file: avoid_print

import 'package:goParcel/theme/widgets/app_top_bar.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../../utils/colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';

class Loream extends StatefulWidget {
  final String title;
  final String description;
  const Loream({super.key, required this.title, required this.description});
  @override
  State<Loream> createState() => _LoreamState();
}

class _LoreamState extends State<Loream> {

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(backgroundColor: AppPalette.current.canvas,
      appBar: AppTopBar(title: widget.title),
      body: Container(
        height: Get.height,
        width: Get.width,
        decoration: BoxDecoration(
          color: AppPalette.current.canvas,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.all(10),
          physics: BouncingScrollPhysics(),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              HtmlWidget(
                onLoadingBuilder: (context, element, loadingProgress) {
                  return SizedBox(
                    height: MediaQuery.of(context).size.height,
                    width: MediaQuery.of(context).size.width,
                    child: Center(child: CircularProgressIndicator(color: AppPalette.current.brand)),
                  );
                },
                widget.description,
                textStyle: TextStyle(
                  color: AppPalette.current.ink,
                  fontFamily: "Gilroy",
                  fontSize: 17,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
