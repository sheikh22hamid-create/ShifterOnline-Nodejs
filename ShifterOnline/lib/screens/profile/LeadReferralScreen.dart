// ignore_for_file: file_names, use_build_context_synchronously

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:get_storage/get_storage.dart';
import 'package:intl/intl.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';

class LeadReferralScreen extends StatefulWidget {
  const LeadReferralScreen({super.key});

  @override
  State<LeadReferralScreen> createState() => _LeadReferralScreenState();
}

class _LeadReferralScreenState extends State<LeadReferralScreen> {
  static const MethodChannel _contactsChannel =
      MethodChannel('com.shifter.online/contacts');

  final GetStorage _storage = GetStorage();
  int _userId = 0;

  // Selected lead type: 'customer' or 'driver'
  String _selectedLeadType = 'customer';

  // Active tab: 0 = Select Contacts, 1 = My Submitted Leads
  int _activeTab = 0;

  // Contacts state
  bool _isLoadingContacts = false;
  bool _hasPermission = false;
  List<Map<String, String>> _allContacts = [];
  List<Map<String, String>> _filteredContacts = [];
  final Set<String> _selectedPhoneNumbers = {};
  final TextEditingController _searchController = TextEditingController();

  // Submitted leads state
  bool _isLoadingLeads = false;
  List<dynamic> _submittedLeads = [];
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _resolveUserId();
    _checkPermissionAndLoadContacts();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _resolveUserId() {
    final rawUid = _storage.read("Uid") ?? _storage.read("UserLogin")?["id"];
    if (rawUid != null) {
      _userId = int.tryParse(rawUid.toString()) ?? 0;
    }
  }

  // --- Contacts Fetching ---

  Future<void> _checkPermissionAndLoadContacts() async {
    final status = await Permission.contacts.status;
    if (status.isGranted) {
      setState(() => _hasPermission = true);
      _loadContactsFromDevice();
    } else {
      setState(() => _hasPermission = false);
    }
  }

  Future<void> _requestContactsPermission() async {
    final status = await Permission.contacts.request();
    if (status.isGranted) {
      setState(() => _hasPermission = true);
      _loadContactsFromDevice();
    } else if (status.isPermanentlyDenied) {
      openAppSettings();
    } else {
      Fluttertoast.showToast(
        msg: "Contacts permission is needed to select referral numbers",
        backgroundColor: Colors.red.shade700,
        textColor: Colors.white,
      );
    }
  }

  Future<void> _loadContactsFromDevice() async {
    setState(() => _isLoadingContacts = true);
    try {
      final List<dynamic>? result =
          await _contactsChannel.invokeMethod('getContacts');
      final List<Map<String, String>> list = [];
      if (result != null) {
        for (var item in result) {
          if (item is Map) {
            list.add({
              "name": item["name"]?.toString() ?? "",
              "phone": item["phone"]?.toString() ?? "",
              "rawNumber": item["rawNumber"]?.toString() ?? "",
            });
          }
        }
      }
      setState(() {
        _allContacts = list;
        _filteredContacts = list;
        _isLoadingContacts = false;
      });
    } catch (e) {
      debugPrint("Error loading contacts: $e");
      setState(() => _isLoadingContacts = false);
      Fluttertoast.showToast(msg: "Could not read contacts: $e");
    }
  }

  void _filterContacts(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) {
      setState(() => _filteredContacts = _allContacts);
      return;
    }
    setState(() {
      _filteredContacts = _allContacts.where((c) {
        final name = (c["name"] ?? "").toLowerCase();
        final phone = (c["phone"] ?? "").toLowerCase();
        return name.contains(q) || phone.contains(q);
      }).toList();
    });
  }

  void _toggleSelectAll() {
    setState(() {
      if (_selectedPhoneNumbers.length == _filteredContacts.length &&
          _filteredContacts.isNotEmpty) {
        _selectedPhoneNumbers.clear();
      } else {
        for (var c in _filteredContacts) {
          final phone = c["phone"];
          if (phone != null && phone.isNotEmpty) {
            _selectedPhoneNumbers.add(phone);
          }
        }
      }
    });
  }

  // --- API Actions ---

  Future<void> _submitSelectedLeads() async {
    if (_selectedPhoneNumbers.isEmpty) {
      Fluttertoast.showToast(msg: "Please select at least 1 contact");
      return;
    }
    if (_userId == 0) {
      Fluttertoast.showToast(msg: "User session expired. Please relogin.");
      return;
    }

    final typeLabel = _selectedLeadType == 'driver'
        ? "Driver Partner (गाड़ी वाले)"
        : "Customer (सामान भेजने वाले)";

    final bool? confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.contact_phone_rounded, color: Color(0xFFFA4500), size: 24),
            SizedBox(width: 8),
            Text(
              "Confirm Submission",
              style: TextStyle(
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        content: Text(
          "Aap ${_selectedPhoneNumbers.length} contacts ko \"$typeLabel\" ke roop me submit kar rahe hain.\n\nVerify hone aur unki pehli ride complete hone par aapko 100 Reward Points milenge.\n\nKya aap aage badhna chahte hain?",
          style: const TextStyle(
            fontFamily: 'Gilroy_Medium',
            fontSize: 14,
            color: Color(0xFF334155),
            height: 1.4,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text("Cancel", style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFA4500),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text("Submit Karein", style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isSubmitting = true);

    final selectedContactsPayload = _allContacts
        .where((c) => _selectedPhoneNumbers.contains(c["phone"]))
        .map((c) => {
              "name": c["name"] ?? c["phone"],
              "phone": c["phone"] ?? "",
            })
        .toList();

    final body = {
      "uid": _userId,
      "lead_type": _selectedLeadType,
      "contacts": selectedContactsPayload,
    };

    final response = await ApiWrapper.dataPostNode(Config.nodeUserLeads, body);

    setState(() => _isSubmitting = false);

    if (response != null &&
        (response["Result"] == "true" || response["Result"] == true)) {
      final accepted = response["accepted"] ?? 0;
      final skipped = response["skipped"] as List? ?? [];

      _showSubmitResultDialog(accepted, skipped);

      setState(() {
        _selectedPhoneNumbers.clear();
      });
    } else {
      final msg = response?["ResponseMsg"] ?? "Failed to submit leads";
      Fluttertoast.showToast(msg: msg.toString());
    }
  }

  void _showSubmitResultDialog(dynamic accepted, List skipped) {
    final typeName = _selectedLeadType == 'driver' ? "Driver Partner" : "Customer";

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 26),
            SizedBox(width: 8),
            Text(
              "Submission Status",
              style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 18),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "✅ $accepted $typeName contact(s) successfully submit ho gaye hain!",
                style: const TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 14,
                  color: Color(0xFF0F172A),
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                "Humari verification team inhein verify karegi. Jaise hi ye join karke pehli booking karenge, aapko reward points credit ho jayenge.",
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 12,
                  color: Color(0xFF64748B),
                ),
              ),
              if (skipped.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  "⚠️ ${skipped.length} contact(s) skip huye:",
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 13,
                    color: Color(0xFFD97706),
                  ),
                ),
                const SizedBox(height: 6),
                ...skipped.map((s) {
                  final phone = s["phone"] ?? "";
                  final reason = s["reason"] ?? "";
                  String reasonText = "Already registered or referred";
                  if (reason == "already_registered") {
                    reasonText = "Already registered user";
                  } else if (reason == "already_submitted") {
                    reasonText = "Already submitted";
                  } else if (reason == "invalid_phone") {
                    reasonText = "Invalid number";
                  }
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text(
                      "• $phone ($reasonText)",
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Regular',
                        fontSize: 12,
                        color: Color(0xFF475569),
                      ),
                    ),
                  );
                }),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("OK", style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              setState(() => _activeTab = 1);
              _fetchMyLeads();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2563EB),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text("View My Leads", style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Future<void> _fetchMyLeads() async {
    if (_userId == 0) return;
    setState(() => _isLoadingLeads = true);

    final response = await ApiWrapper.dataGetNode("${Config.nodeUserLeads}?uid=$_userId");

    setState(() => _isLoadingLeads = false);

    if (response != null &&
        (response["Result"] == "true" || response["Result"] == true)) {
      setState(() {
        _submittedLeads = response["leads"] as List? ?? [];
      });
    }
  }

  // --- UI Build ---

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        centerTitle: false,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0F172A), size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const [
            Text(
              "Refer from Contacts",
              style: TextStyle(
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
                color: Color(0xFF0F172A),
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              "Earn 100 reward points per lead",
              style: TextStyle(
                fontFamily: 'Gilroy_Medium',
                fontSize: 11,
                color: Color(0xFF64748B),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFF0F172A)),
            tooltip: "Refresh",
            onPressed: () {
              if (_activeTab == 0) {
                _loadContactsFromDevice();
              } else {
                _fetchMyLeads();
              }
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Category Switcher (Customer vs Driver)
          _buildCategorySwitcher(),

          // Tabs (Select Contacts vs My Submitted Leads)
          _buildTabBar(),

          // Tab Body
          Expanded(
            child: _activeTab == 0 ? _buildContactsTab() : _buildMyLeadsTab(),
          ),

          // Bottom Submit Bar (only visible in Select Contacts tab)
          if (_activeTab == 0 && _hasPermission) _buildBottomSubmitBar(),
        ],
      ),
    );
  }

  Widget _buildCategorySwitcher() {
    final isCustomer = _selectedLeadType == 'customer';
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Customer option
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _selectedLeadType = 'customer'),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                    decoration: BoxDecoration(
                      color: isCustomer ? const Color(0xFF2563EB) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: isCustomer ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0),
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.person_outline_rounded,
                          size: 18,
                          color: isCustomer ? Colors.white : const Color(0xFF475569),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          "👤 Customer",
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: isCustomer ? Colors.white : const Color(0xFF475569),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              // Driver option
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _selectedLeadType = 'driver'),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                    decoration: BoxDecoration(
                      color: !isCustomer ? const Color(0xFF7C3AED) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: !isCustomer ? const Color(0xFF7C3AED) : const Color(0xFFE2E8F0),
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.local_shipping_outlined,
                          size: 18,
                          color: !isCustomer ? Colors.white : const Color(0xFF475569),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          "🚚 Driver Partner",
                          style: TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: !isCustomer ? Colors.white : const Color(0xFF475569),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            isCustomer
                ? "💡 सामान / शिफ्टिंग बुक करने वाले दोस्तों या ग्राहकों के लिए Customer चुनें।"
                : "💡 गाड़ी, टेम्पो, छोटा हाथी चलाने वाले ड्राइवर साथियों के लिए Driver चुनें।",
            style: const TextStyle(
              fontFamily: 'Gilroy_Medium',
              fontSize: 11,
              color: Color(0xFF64748B),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Expanded(
              child: GestureDetector(
                onTap: () => setState(() => _activeTab = 0),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: _activeTab == 0 ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: _activeTab == 0
                        ? [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.06),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            ),
                          ]
                        : null,
                  ),
                  alignment: Alignment.center,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        "Select Contacts",
                        style: TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: _activeTab == 0
                              ? const Color(0xFF0F172A)
                              : const Color(0xFF64748B),
                        ),
                      ),
                      if (_selectedPhoneNumbers.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFA4500),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            "${_selectedPhoneNumbers.length}",
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            Expanded(
              child: GestureDetector(
                onTap: () {
                  setState(() => _activeTab = 1);
                  _fetchMyLeads();
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: _activeTab == 1 ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: _activeTab == 1
                        ? [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.06),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            ),
                          ]
                        : null,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    "My Leads",
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: _activeTab == 1
                          ? const Color(0xFF0F172A)
                          : const Color(0xFF64748B),
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

  // --- Contacts Tab ---

  Widget _buildContactsTab() {
    if (!_hasPermission) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 70,
                height: 70,
                decoration: BoxDecoration(
                  color: const Color(0xFFEEF2FF),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.contacts_rounded, size: 36, color: Color(0xFF4F46E5)),
              ),
              const SizedBox(height: 16),
              const Text(
                "Contacts Permission Required",
                style: TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF0F172A),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                "Apne phone contacts se doston ya drivers ko refer karne ke liye contacts access enable karein.",
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 13,
                  color: Color(0xFF64748B),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                onPressed: _requestContactsPermission,
                icon: const Icon(Icons.lock_open_rounded, size: 18),
                label: const Text("Allow Contacts Access"),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFA4500),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (_isLoadingContacts) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFFFA4500)),
      );
    }

    return Column(
      children: [
        // Search bar & Select all row
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Column(
            children: [
              TextField(
                controller: _searchController,
                onChanged: _filterContacts,
                decoration: InputDecoration(
                  hintText: "Search by name or number...",
                  hintStyle: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 13, color: Color(0xFF94A3B8)),
                  prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFF94A3B8), size: 20),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, size: 18, color: Color(0xFF94A3B8)),
                          onPressed: () {
                            _searchController.clear();
                            _filterContacts("");
                          },
                        )
                      : null,
                  isDense: true,
                  filled: true,
                  fillColor: const Color(0xFFF8FAFC),
                  contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "${_filteredContacts.length} contacts found",
                    style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12, color: Color(0xFF64748B)),
                  ),
                  TextButton.icon(
                    onPressed: _toggleSelectAll,
                    icon: Icon(
                      _selectedPhoneNumbers.length == _filteredContacts.length && _filteredContacts.isNotEmpty
                          ? Icons.check_box_rounded
                          : Icons.check_box_outline_blank_rounded,
                      size: 18,
                      color: const Color(0xFFFA4500),
                    ),
                    label: Text(
                      _selectedPhoneNumbers.length == _filteredContacts.length && _filteredContacts.isNotEmpty
                          ? "Deselect All"
                          : "Select All",
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 12,
                        color: Color(0xFFFA4500),
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Contacts list
        Expanded(
          child: _filteredContacts.isEmpty
              ? Center(
                  child: Text(
                    "No contacts found",
                    style: TextStyle(fontFamily: 'Gilroy_Medium', color: Colors.grey.shade500),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.only(top: 8, bottom: 90),
                  itemCount: _filteredContacts.length,
                  separatorBuilder: (_, __) => const Divider(height: 1, indent: 68, color: Color(0xFFF1F5F9)),
                  itemBuilder: (context, index) {
                    final c = _filteredContacts[index];
                    final name = c["name"] ?? "";
                    final phone = c["phone"] ?? "";
                    final isSelected = _selectedPhoneNumbers.contains(phone);
                    final initial = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : "#";

                    // Format phone nicely: 98765 43210
                    String formattedPhone = phone;
                    if (phone.length == 10) {
                      formattedPhone = "${phone.substring(0, 5)} ${phone.substring(5)}";
                    }

                    return InkWell(
                      onTap: () {
                        setState(() {
                          if (isSelected) {
                            _selectedPhoneNumbers.remove(phone);
                          } else {
                            _selectedPhoneNumbers.add(phone);
                          }
                        });
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        color: isSelected ? const Color(0xFFFFF7ED) : Colors.white,
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 20,
                              backgroundColor: isSelected ? const Color(0xFFFFEDD5) : const Color(0xFFEEF2FF),
                              child: Text(
                                initial,
                                style: TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: isSelected ? const Color(0xFFFA4500) : const Color(0xFF4F46E5),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    name,
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: Color(0xFF0F172A),
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    formattedPhone,
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Regular',
                                      fontSize: 12,
                                      color: Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Checkbox(
                              value: isSelected,
                              activeColor: const Color(0xFFFA4500),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                              onChanged: (val) {
                                setState(() {
                                  if (val == true) {
                                    _selectedPhoneNumbers.add(phone);
                                  } else {
                                    _selectedPhoneNumbers.remove(phone);
                                  }
                                });
                              },
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildBottomSubmitBar() {
    final count = _selectedPhoneNumbers.length;
    final hasSelection = count > 0;
    final typeLabel = _selectedLeadType == 'driver' ? "Driver" : "Customer";

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 10,
            offset: const Offset(0, -3),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          height: 50,
          child: ElevatedButton(
            onPressed: hasSelection && !_isSubmitting ? _submitSelectedLeads : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: _selectedLeadType == 'driver'
                  ? const Color(0xFF7C3AED)
                  : const Color(0xFF2563EB),
              disabledBackgroundColor: const Color(0xFFCBD5E1),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              elevation: hasSelection ? 2 : 0,
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                  )
                : Text(
                    "Submit $count Leads ($typeLabel)",
                    style: const TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
          ),
        ),
      ),
    );
  }

  // --- My Submitted Leads Tab ---

  Widget _buildMyLeadsTab() {
    if (_isLoadingLeads) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFFFA4500)),
      );
    }

    final total = _submittedLeads.length;
    int verified = 0;
    int converted = 0;

    for (var l in _submittedLeads) {
      final s = (l["status"] ?? "").toString().toLowerCase();
      if (s == "verified") verified++;
      if (s == "converted") converted++;
    }

    return RefreshIndicator(
      color: const Color(0xFFFA4500),
      onRefresh: _fetchMyLeads,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 3 Metric Cards
          Row(
            children: [
              Expanded(child: _buildKpiBox("Total Submitted", "$total", const Color(0xFF0F172A), const Color(0xFFF1F5F9))),
              const SizedBox(width: 8),
              Expanded(child: _buildKpiBox("Verified", "$verified", const Color(0xFF2563EB), const Color(0xFFEFF6FF))),
              const SizedBox(width: 8),
              Expanded(child: _buildKpiBox("Rewarded", "$converted", const Color(0xFF16A34A), const Color(0xFFF0FDF4))),
            ],
          ),
          const SizedBox(height: 16),

          if (_submittedLeads.isEmpty) ...[
            const SizedBox(height: 40),
            Center(
              child: Column(
                children: [
                  Icon(Icons.inbox_rounded, size: 54, color: Colors.grey.shade400),
                  const SizedBox(height: 12),
                  const Text(
                    "No leads submitted yet",
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 16,
                      color: Color(0xFF64748B),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    "Switch to \"Select Contacts\" tab to refer your friends.",
                    style: TextStyle(fontFamily: 'Gilroy_Regular', fontSize: 12, color: Color(0xFF94A3B8)),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => setState(() => _activeTab = 0),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFFA4500),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text("Select Contacts Now"),
                  ),
                ],
              ),
            ),
          ] else ...[
            ..._submittedLeads.map((item) => _buildLeadCard(item)),
          ],
        ],
      ),
    );
  }

  Widget _buildKpiBox(String title, String count, Color countColor, Color bgColor) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: countColor.withOpacity(0.15)),
      ),
      child: Column(
        children: [
          Text(
            count,
            style: TextStyle(
              fontFamily: 'Gilroy_Bold',
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: countColor,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            title,
            style: const TextStyle(
              fontFamily: 'Gilroy_Medium',
              fontSize: 11,
              color: Color(0xFF64748B),
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildLeadCard(dynamic lead) {
    final name = (lead["name"] ?? lead["phone"] ?? "").toString();
    final phone = (lead["phone"] ?? "").toString();
    final leadType = (lead["lead_type"] ?? "customer").toString().toLowerCase();
    final status = (lead["status"] ?? "pending").toString().toLowerCase();
    final submittedAt = lead["submitted_at"]?.toString() ?? "";

    final isDriver = leadType == "driver";

    // Format date
    String formattedDate = "";
    if (submittedAt.isNotEmpty) {
      try {
        final parsed = DateTime.parse(submittedAt);
        formattedDate = DateFormat("dd MMM yyyy").format(parsed);
      } catch (_) {
        if (submittedAt.length >= 10) formattedDate = submittedAt.substring(0, 10);
      }
    }

    // Status badge configurations
    Color badgeBg = const Color(0xFFFEF3C7);
    Color badgeText = const Color(0xFFD97706);
    String badgeLabel = "⏳ Pending";
    String description = "Verification in progress. Ops team will call this contact.";

    if (status == "verified") {
      badgeBg = const Color(0xFFDBEAFE);
      badgeText = const Color(0xFF2563EB);
      badgeLabel = "✓ Verified";
      description = "Verified! Reward credited on 1st ride/order.";
    } else if (status == "converted") {
      badgeBg = const Color(0xFFDCFCE7);
      badgeText = const Color(0xFF16A34A);
      badgeLabel = "🎉 Rewarded";
      description = "1st Ride completed! 100 Reward Points added to your wallet.";
    } else if (status == "rejected") {
      badgeBg = const Color(0xFFFEE2E2);
      badgeText = const Color(0xFFDC2626);
      badgeLabel = "✕ Rejected";
      description = "Number could not be verified by ops team.";
    } else if (status == "expired") {
      badgeBg = const Color(0xFFF1F5F9);
      badgeText = const Color(0xFF64748B);
      badgeLabel = "⌛ Expired";
      description = "Verification window expired before registration.";
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: isDriver ? const Color(0xFFF3E8FF) : const Color(0xFFEFF6FF),
                child: Text(
                  name.isNotEmpty ? name.substring(0, 1).toUpperCase() : "#",
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontWeight: FontWeight.bold,
                    color: isDriver ? const Color(0xFF7C3AED) : const Color(0xFF2563EB),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      phone,
                      style: const TextStyle(
                        fontFamily: 'Gilroy_Regular',
                        fontSize: 12,
                        color: Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
              // Category Badge (Customer vs Driver)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isDriver ? const Color(0xFFF3E8FF) : const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  isDriver ? "🚚 Driver" : "👤 Customer",
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: isDriver ? const Color(0xFF7C3AED) : const Color(0xFF1D4ED8),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(height: 1, color: Color(0xFFF1F5F9)),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: badgeBg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  badgeLabel,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Bold',
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: badgeText,
                  ),
                ),
              ),
              if (formattedDate.isNotEmpty)
                Text(
                  formattedDate,
                  style: const TextStyle(
                    fontFamily: 'Gilroy_Regular',
                    fontSize: 11,
                    color: Color(0xFF94A3B8),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            description,
            style: const TextStyle(
              fontFamily: 'Gilroy_Regular',
              fontSize: 11,
              color: Color(0xFF64748B),
            ),
          ),
        ],
      ),
    );
  }
}
