import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:get/get.dart';

import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:goParcel/utils/vehicle_marker.dart';

class LiveDriverTracking extends StatefulWidget {
  final String orderId;
  final String? type;
  final Map<String, dynamic>? initialOrderData;

  const LiveDriverTracking({
    super.key,
    required this.orderId,
    this.type,
    this.initialOrderData,
  });

  @override
  State<LiveDriverTracking> createState() => _LiveDriverTrackingState();
}

class _LiveDriverTrackingState extends State<LiveDriverTracking> {
  GoogleMapController? _mapController;
  Timer? _refreshTimer;
  LatLng? _driverPosition;
  LatLng? _pickupPosition;
  LatLng? _dropPosition;
  double _driverBearing = 0;
  BitmapDescriptor? _driverIcon;
  String _status = '';
  NodeSocketSubscription? _socketSubscription;

  @override
  void initState() {
    super.initState();
    _seedOrder(widget.initialOrderData);
    _listenForDriverLocation();
    _loadDriverIcon();
  }

  // Vehicle image (bike / 4-wheeler...) for this order's category instead of
  // Google's default red pin; red is reserved for the drop marker.
  Future<void> _loadDriverIcon() async {
    final category = widget.initialOrderData?['category']?.toString() ?? '';
    final icon = await loadVehicleMarker(category);
    if (!mounted || icon == null) return;
    setState(() => _driverIcon = icon);
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _socketSubscription?.dispose();
    super.dispose();
  }

  double? _number(dynamic value) => double.tryParse(value?.toString() ?? '');

  void _seedOrder(Map<String, dynamic>? order) {
    if (order == null) return;
    final pickupLat = _number(order['plat']);
    final pickupLng = _number(order['plong']);
    final dropLat = _number(order['dlat']);
    final dropLng = _number(order['dlong']);
    final driverLat = _number(order['rider_lats'] ?? order['rider_lat'] ?? order['rlats']);
    final driverLng = _number(order['rider_longs'] ?? order['rider_lng'] ?? order['rlongs']);
    setState(() {
      if (pickupLat != null && pickupLng != null) _pickupPosition = LatLng(pickupLat, pickupLng);
      if (dropLat != null && dropLng != null) _dropPosition = LatLng(dropLat, dropLng);
      if (driverLat != null && driverLng != null) _driverPosition = LatLng(driverLat, driverLng);
      _status = order['Order_Status']?.toString() ?? '';
    });
  }

  void _listenForDriverLocation() {
    NodeSocketManager.instance.joinOrder(widget.orderId);
    _socketSubscription = NodeSocketManager.instance.addListeners(onStatusChanged: (data) {
      if (!mounted || data['order_id']?.toString() != widget.orderId) return;
      setState(() => _status = (data['o_status'] ?? data['Order_Status'] ?? data['order_status'] ?? '').toString());
    }, onDriverLocation: (data) {
      if (!mounted || data['order_id']?.toString() != widget.orderId) return;
      final lat = _number(data['lat']);
      final lng = _number(data['lng']);
      if (lat == null || lng == null) return;
      final next = LatLng(lat, lng);
      final previous = _driverPosition;
      setState(() {
        _driverPosition = next;
        final heading = _number(data['heading']);
        if (heading != null) _driverBearing = heading;
      });
      if (previous == null && _mapController != null) {
        _mapController!.animateCamera(CameraUpdate.newLatLng(next));
      }
    });
  }

  double _distanceKm(LatLng? first, LatLng? second) {
    if (first == null || second == null) return 0;
    const earthRadiusKm = 6371.0;
    final dLat = (second.latitude - first.latitude) * math.pi / 180;
    final dLng = (second.longitude - first.longitude) * math.pi / 180;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(first.latitude * math.pi / 180) *
            math.cos(second.latitude * math.pi / 180) *
            math.sin(dLng / 2) * math.sin(dLng / 2);
    return earthRadiusKm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  bool get _headingToDrop {
    final status = _status.toLowerCase();
    return status.contains('route') || status.contains('transit') || status.contains('picked');
  }

  Set<Marker> get _markers {
    final markers = <Marker>{};
    if (_pickupPosition != null) {
      markers.add(Marker(
        markerId: const MarkerId('pickup'),
        position: _pickupPosition!,
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      ));
    }
    if (_dropPosition != null) {
      markers.add(Marker(
        markerId: const MarkerId('drop'),
        position: _dropPosition!,
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
      ));
    }
    if (_driverPosition != null) {
      markers.add(Marker(
        markerId: const MarkerId('driver'),
        position: _driverPosition!,
        icon: _driverIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet),
        rotation: _driverBearing,
        flat: true,
        anchor: const Offset(.5, .5),
        zIndex: 2,
      ));
    }
    return markers;
  }

  LatLng get _initialTarget => _driverPosition ?? _pickupPosition ?? _dropPosition ?? const LatLng(20.5937, 78.9629);

  @override
  Widget build(BuildContext context) {
    final target = _headingToDrop ? _dropPosition : _pickupPosition;
    final distance = _distanceKm(_driverPosition, target);
    final hasDistance = _driverPosition != null && target != null;
    final label = _headingToDrop ? 'Driver distance from drop' : 'Driver distance from pickup';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Driver Tracking'),
        backgroundColor: linercolor,
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          const SocketStatusBanner(),
          Expanded(
            child: GoogleMap(
              initialCameraPosition: CameraPosition(target: _initialTarget, zoom: 12),
              markers: _markers,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              compassEnabled: true,
              gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
                Factory<EagerGestureRecognizer>(() => EagerGestureRecognizer()),
              },
              onMapCreated: (controller) => _mapController = controller,
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
              color: Theme.of(context).scaffoldBackgroundColor,
              child: Row(
                children: [
                  const Icon(Icons.directions_car_filled_rounded, color: Colors.deepOrange),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      hasDistance ? '$label\n${distance.toStringAsFixed(1)} km' : 'Waiting for live driver location...',
                      style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 15),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Center driver',
                    onPressed: _driverPosition == null || _mapController == null
                        ? null
                        : () => _mapController!.animateCamera(CameraUpdate.newLatLng(_driverPosition!)),
                    icon: const Icon(Icons.my_location_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
