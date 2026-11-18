import 'package:flutter/material.dart';

/// Everything under the search card on drop search (current location, saved places, results / recents)
/// scrolls as ONE list, so a small phone with the keyboard open never squeezes the results to zero height.
class SearchResultsPane extends StatelessWidget {
  const SearchResultsPane({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: children,
    );
  }
}
