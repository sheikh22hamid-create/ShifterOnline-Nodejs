// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:google_maps_webservice/places.dart';
import 'package:flutter_google_places_hoc081098/flutter_google_places_hoc081098.dart';
import 'package:google_api_headers/google_api_headers.dart';
import 'package:provider/provider.dart';
import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../../utils/customewidget/customwidgets.dart';
import 'custom_order_bid_list.dart';
import 'home.dart'; // for wheelerItems from pickDropList

class CustomOrderScreen extends StatefulWidget {
  const CustomOrderScreen({super.key});

  @override
  State<CustomOrderScreen> createState() => _CustomOrderScreenState();
}

class _CustomOrderScreenState extends State<CustomOrderScreen> {
  final getdata = GetStorage();

  // Address controllers & state
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _dropController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _priceController = TextEditingController();

  String? _pickupAddress;
  String? _dropAddress;

  // Wheeler selection
  String? _selectedCategory;
  List<String> _categories = [];

  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  void _loadCategories() {
    // Use the already-loaded wheeler items from global pickupiteam
    _categories.clear();
    for (var item in pickupiteam) {
      String catName = item['cat_name']?.toString() ?? '';
      if (catName.isNotEmpty) _categories.add(catName);
    }
    if (_categories.isNotEmpty) {
      _selectedCategory = _categories.first;
    }
    setState(() {});
  }

  @override
  void dispose() {
    _pickupController.dispose();
    _dropController.dispose();
    _descriptionController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _searchAndSetAddress(bool isPickup) async {
    try {
      var place = await PlacesAutocomplete.show(
        context: context,
        apiKey: Config.googleApikey,
        mode: Mode.overlay,
        types: ['address'],
        //types: [],
        strictbounds: false,
        components: [Component(Component.country, 'IN')],
        onError: (err) => debugPrint("Place search error: $err"),
      );

      if (place != null && place.description != null) {
        String address = place.description!;
        setState(() {
          if (isPickup) {
            _pickupAddress = address;
            _pickupController.text = address;
          } else {
            _dropAddress = address;
            _dropController.text = address;
          }
        });
      }
    } catch (e) {
      debugPrint("Error searching place: $e");
      tostmsg("Error searching location. Please try again.");
    }
  }

  Future<void> _submitCustomOrder() async {
    // Validate fields
    if (_pickupAddress == null || _pickupAddress!.trim().isEmpty) {
      tostmsg("Please enter pickup location");
      return;
    }
    if (_dropAddress == null || _dropAddress!.trim().isEmpty) {
      tostmsg("Please enter drop location");
      return;
    }
    if (_descriptionController.text.trim().isEmpty) {
      tostmsg("Please add a description");
      return;
    }
    if (_priceController.text.trim().isEmpty) {
      tostmsg("Please enter your price offer");
      return;
    }
    if (_selectedCategory == null) {
      tostmsg("Please select a vehicle type");
      return;
    }

    double? price = double.tryParse(_priceController.text.trim());
    if (price == null || price <= 0) {
      tostmsg("Please enter a valid price");
      return;
    }

    setState(() => _isLoading = true);

    try {
      var userId = getdata.read("Uid") ?? getdata.read("UserLogin")?["id"] ?? 1;
      var data = {
        "user_id": userId is String ? int.tryParse(userId) ?? 1 : userId,
        "pickup": _pickupAddress!.trim(),
        "drop": _dropAddress!.trim(),
        "description": _descriptionController.text.trim(),
        "price": price.toInt(),
        "category": _selectedCategory,
      };

      debugPrint("🟢 Custom Order Request: $data");
      var response = await ApiWrapper.dataPostNode(Config.nodeCustomOrderCreate, data);
      debugPrint("🟢 Custom Order Response: $response");

      if (response != null && (response['Result'] == true || response['Result'] == "true")) {
        int orderId = int.tryParse(response['order_id']?.toString() ?? '0') ?? 0;
        tostmsg(response['msg']?.toString() ?? "Custom order created!");

        // ✅ Save order info locally so user can view bid list later
        _saveCustomOrderLocally(
          orderId: orderId,
          pickup: _pickupAddress!.trim(),
          drop: _dropAddress!.trim(),
          category: _selectedCategory ?? '',
          price: price.toInt(),
          description: _descriptionController.text.trim(),
        );

        // Navigate to bid list screen
        Get.off(() => CustomOrderBidList(orderId: orderId));
      } else {
        tostmsg(response?['msg']?.toString() ?? "Failed to create order. Please try again.");
      }
    } catch (e) {
      debugPrint("🔴 Error creating custom order: $e");
      tostmsg("Something went wrong. Please try again.");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Save newly created custom order to local storage list
  void _saveCustomOrderLocally({
    required int orderId,
    required String pickup,
    required String drop,
    required String category,
    required int price,
    required String description,
  }) {
    try {
      List savedOrders = getdata.read("CustomOrders") ?? [];
      // Avoid duplicates
      savedOrders.removeWhere((o) => o['order_id'].toString() == orderId.toString());
      savedOrders.insert(0, {
        "order_id": orderId,
        "pickup": pickup,
        "drop": drop,
        "category": category,
        "price": price,
        "description": description,
        "created_at": DateTime.now().toIso8601String(),
      });
      // Keep only latest 10
      if (savedOrders.length > 10) savedOrders = savedOrders.sublist(0, 10);
      getdata.write("CustomOrders", savedOrders);
      debugPrint("✅ Custom order saved locally: $orderId");
    } catch (e) {
      debugPrint("⚠️ Could not save custom order locally: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);
    return Scaffold(
      backgroundColor: linercolor,
      appBar: AppBar(
        backgroundColor: linercolor,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
          onPressed: () => Get.back(),
        ),
        title: const Text(
          "Custom Order",
          style: TextStyle(
            color: Colors.white,
            fontFamily: 'Gilroy_Bold',
            fontSize: 18,
          ),
        ),
      ),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 20,
            bottom: MediaQuery.of(context).viewInsets.bottom +
                MediaQuery.of(context).padding.bottom +
                24,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Info banner
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: linercolor.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: linercolor.withOpacity(0.2)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline, color: linercolor, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        "Set your own price and let drivers bid on your order. You can then select the best offer.",
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 13,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Pickup & Drop Card
              _buildSectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Pickup field
                    _buildLabel("Pickup Location", Icons.radio_button_checked, Colors.green),
                    const SizedBox(height: 8),
                    _buildAddressTile(
                      controller: _pickupController,
                      hintText: "Enter pickup address".tr,
                      isPickup: true,
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Row(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(left: 10),
                            child: Container(
                              width: 2,
                              height: 24,
                              color: greaycolor.withOpacity(0.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Drop field
                    _buildLabel("Drop Location", Icons.location_on, linercolor),
                    const SizedBox(height: 8),
                    _buildAddressTile(
                      controller: _dropController,
                      hintText: "Enter drop address".tr,
                      isPickup: false,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Vehicle Type
              _buildSectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildLabel("Vehicle Type", Icons.two_wheeler, linercolor),
                    const SizedBox(height: 12),
                    _categories.isEmpty
                        ? Text(
                            "Loading vehicles...",
                            style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium'),
                          )
                        : Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: _categories.map((cat) {
                              bool isSelected = _selectedCategory == cat;
                              return GestureDetector(
                                onTap: () => setState(() => _selectedCategory = cat),
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 200),
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                                  decoration: BoxDecoration(
                                    color: isSelected ? linercolor : notifier.getBgColor,
                                    borderRadius: BorderRadius.circular(25),
                                    border: Border.all(
                                      color: isSelected ? linercolor : notifier.bordecolor,
                                      width: isSelected ? 2 : 1,
                                    ),
                                    boxShadow: isSelected
                                        ? [BoxShadow(color: linercolor.withOpacity(0.3), blurRadius: 6, offset: const Offset(0, 2))]
                                        : [],
                                  ),
                                  child: Text(
                                    cat,
                                    style: TextStyle(
                                      color: isSelected ? Colors.white : notifier.text,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Description
              _buildSectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildLabel("Description", Icons.description_outlined, linercolor),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _descriptionController,
                      maxLines: 3,
                      textCapitalization: TextCapitalization.sentences,
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 14,
                      ),
                      decoration: InputDecoration(
                        hintText: "e.g. 2 boxes, fragile items, please handle with care...".tr,
                        hintStyle: TextStyle(
                          color: greaycolor,
                          fontFamily: 'Gilroy_Regular',
                          fontSize: 13,
                        ),
                        filled: true,
                        fillColor: notifier.getBgColor,
                        contentPadding: const EdgeInsets.all(14),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: notifier.bordecolor),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: notifier.bordecolor),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: linercolor, width: 1.5),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Price offer
              _buildSectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildLabel("Your Price Offer", Icons.currency_rupee, linercolor),
                    const SizedBox(height: 4),
                    Text(
                      "Drivers will bid based on this price",
                      style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 12),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _priceController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: false),
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 18,
                      ),
                      decoration: InputDecoration(
                        hintText: "120",
                        hintStyle: TextStyle(
                          color: greaycolor,
                          fontFamily: 'Gilroy_Regular',
                          fontSize: 18,
                        ),
                        prefixIcon: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          child: Text(
                            "₹",
                            style: TextStyle(
                              color: linercolor,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 20,
                            ),
                          ),
                        ),
                        filled: true,
                        fillColor: notifier.getBgColor,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: notifier.bordecolor),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: notifier.bordecolor),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: linercolor, width: 1.5),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),

              // Submit button
              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _submitCustomOrder,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: linercolor,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: linercolor.withOpacity(0.6),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    elevation: 4,
                    shadowColor: linercolor.withOpacity(0.4),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2.5,
                          ),
                        )
                      : const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.send_rounded, size: 20),
                            SizedBox(width: 10),
                            Text(
                              "Create Custom Order",
                              style: TextStyle(
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 16,
                              ),
                            ),
                          ],
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionCard({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: child,
    );
  }

  Widget _buildLabel(String title, IconData icon, Color iconColor) {
    return Row(
      children: [
        Icon(icon, color: iconColor, size: 18),
        const SizedBox(width: 8),
        Text(
          title,
          style: TextStyle(
            color: notifier.text,
            fontFamily: 'Gilroy_Bold',
            fontSize: 15,
          ),
        ),
      ],
    );
  }

  Widget _buildAddressTile({
    required TextEditingController controller,
    required String hintText,
    required bool isPickup,
  }) {
    return GestureDetector(
      onTap: () => _searchAndSetAddress(isPickup),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: notifier.lightBgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: notifier.bordecolor),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                controller.text.isEmpty ? hintText : controller.text,
                style: TextStyle(
                  color: controller.text.isEmpty ? greaycolor : notifier.text,
                  fontFamily: controller.text.isEmpty ? 'Gilroy_Regular' : 'Gilroy_Medium',
                  fontSize: 14,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            Icon(Icons.search, color: linercolor, size: 20),
          ],
        ),
      ),
    );
  }
}
