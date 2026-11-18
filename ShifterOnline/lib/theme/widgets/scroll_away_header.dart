import 'package:flutter/material.dart';

/// Cards/header that scroll away above a list (Wallet tab), so a small phone still has room for the list.
/// `body` is usually a ListView without its own controller; NestedScrollView links the two scrolls.
class ScrollAwayHeader extends StatelessWidget {
  const ScrollAwayHeader({super.key, required this.header, required this.body});

  final List<Widget> header;
  final Widget body;

  @override
  Widget build(BuildContext context) {
    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) => [
        SliverToBoxAdapter(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: header),
        ),
      ],
      body: body,
    );
  }
}
