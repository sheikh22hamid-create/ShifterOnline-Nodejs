import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:provider/provider.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';

/// Referral-points statement: current balance, lifetime earned / used and the
/// full log (signup / referral rewards, ride discounts, refunds, admin credits).
/// Fed by POST wallet/points-history - the same data the admin panel's
/// "Points log" shows, scoped to this customer.
class ReferralPointsScreen extends StatefulWidget {
  const ReferralPointsScreen({super.key});

  @override
  State<ReferralPointsScreen> createState() => _ReferralPointsScreenState();
}

class _ReferralPointsScreenState extends State<ReferralPointsScreen> {
  static const int _pageSize = 50;
  final GetStorage _storage = GetStorage();
  final ScrollController _scroll = ScrollController();

  int _balance = 0;
  int _earned = 0;
  int _used = 0;
  final List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  bool _failed = false;
  int _page = 1;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_hasMore && !_loadingMore && _scroll.position.pixels >= _scroll.position.maxScrollExtent - 200) {
        _load(page: _page + 1);
      }
    });
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({int page = 1}) async {
    final login = _storage.read('UserLogin');
    if (login is! Map) {
      setState(() { _loading = false; _failed = true; });
      return;
    }
    if (page > 1) setState(() => _loadingMore = true);
    final response = await ApiWrapper.dataPostNode(Config.nodeWalletPointsHistory, {
      'mobile': login['mobile'],
      'wallet_type': 'user',
      'page': page,
      'limit': _pageSize,
    });
    if (!mounted) return;
    final ok = response is Map && (response['Result'] == true || response['Result'] == 'true');
    setState(() {
      _loading = false;
      _loadingMore = false;
      if (!ok) {
        if (page == 1) _failed = true;
        return;
      }
      _failed = false;
      _balance = int.tryParse(response['points_balance'].toString()) ?? 0;
      _earned = int.tryParse(response['total_earned'].toString()) ?? 0;
      _used = int.tryParse(response['total_used'].toString()) ?? 0;
      final data = (response['data'] is List) ? List<Map<String, dynamic>>.from((response['data'] as List).map((e) => Map<String, dynamic>.from(e as Map))) : <Map<String, dynamic>>[];
      if (page == 1) _rows.clear();
      _rows.addAll(data);
      _page = page;
      _hasMore = data.length >= _pageSize;
    });
  }

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: linercolor,
        centerTitle: true,
        iconTheme: IconThemeData(color: whitecolor),
        title: Text('Referral Points'.tr, style: TextStyle(color: whitecolor, fontFamily: 'Gilroy_Bold')),
      ),
      body: Container(
        width: Get.width,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: const BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
        ),
        child: _loading
            ? Center(child: CircularProgressIndicator(color: notifier.darklinercolor))
            : _failed
                ? _message(notifier, 'Could not load your points history. Pull back and try again.'.tr, retry: true)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      controller: _scroll,
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                      children: [
                        _summaryCard(),
                        const SizedBox(height: 18),
                        Text('History'.tr, style: TextStyle(color: notifier.text, fontSize: 18, fontFamily: 'Gilroy_Bold')),
                        const SizedBox(height: 8),
                        if (_rows.isEmpty)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 40),
                            child: _message(notifier, 'No points activity yet.'.tr),
                          )
                        else
                          ..._rows.map((r) => _rowTile(notifier, r)),
                        if (_loadingMore)
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Center(child: CircularProgressIndicator(color: notifier.darklinercolor)),
                          ),
                      ],
                    ),
                  ),
      ),
    );
  }

  Widget _message(ColorNotifier notifier, String text, {bool retry = false}) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(text, textAlign: TextAlign.center, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium')),
          if (retry) ...[
            const SizedBox(height: 12),
            TextButton(onPressed: () { setState(() { _loading = true; }); _load(); }, child: Text('Retry'.tr)),
          ],
        ],
      ),
    );
  }

  Widget _summaryCard() {
    Widget stat(String label, int value, Color color) => Expanded(
          child: Column(
            children: [
              Text('$value', style: TextStyle(color: color, fontSize: 18, fontFamily: 'Gilroy_Bold')),
              const SizedBox(height: 2),
              Text(label.tr, style: const TextStyle(color: Colors.white70, fontSize: 12, fontFamily: 'Gilroy_Medium')),
            ],
          ),
        );
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: linercolor,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: linercolor.withOpacity(0.3), blurRadius: 12, offset: const Offset(0, 6))],
      ),
      child: Column(
        children: [
          Text('Available points'.tr, style: const TextStyle(color: Colors.white70, fontSize: 13, fontFamily: 'Gilroy_Medium')),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.stars_rounded, color: Colors.amber, size: 28),
              const SizedBox(width: 8),
              Text('$_balance', style: const TextStyle(color: Colors.white, fontSize: 32, fontFamily: 'Gilroy_Bold')),
            ],
          ),
          const SizedBox(height: 16),
          Row(children: [
            stat('Earned', _earned, const Color(0xFF86EFAC)),
            Container(width: 1, height: 28, color: Colors.white24),
            stat('Used', _used, const Color(0xFFFCA5A5)),
          ]),
        ],
      ),
    );
  }

  Widget _rowTile(ColorNotifier notifier, Map<String, dynamic> r) {
    final points = int.tryParse(r['points'].toString()) ?? 0;
    final credit = points >= 0;
    final color = credit ? const Color(0xFF00C853) : const Color(0xFFE53935);
    final note = (r['note'] ?? '').toString().trim();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle),
            child: Icon(credit ? Icons.add_rounded : Icons.remove_rounded, color: color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text((r['source_label'] ?? 'Points').toString().tr, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 14)),
                if (note.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(note, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12)),
                ],
                const SizedBox(height: 4),
                Text((r['created_at'] ?? '').toString(), style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('${credit ? '+' : ''}$points', style: TextStyle(color: color, fontFamily: 'Gilroy_Bold', fontSize: 16)),
              const SizedBox(height: 2),
              Text('${'Balance'.tr}: ${r['balance_after']}', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
            ],
          ),
        ],
      ),
    );
  }
}
