import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

import '../Api/config.dart';

enum SocketConnectionState { disconnected, connecting, connected, reconnecting }

typedef SocketEventCallback = void Function(Map<String, dynamic> data);

class NodeSocketSubscription {
  final NodeSocketManager _manager;
  final int _id;
  bool _disposed = false;

  NodeSocketSubscription(this._manager, this._id);

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _manager._removeListeners(_id);
  }
}

class _SocketListeners {
  final SocketEventCallback? onOrderAssigned;
  final SocketEventCallback? onDriverLocation;
  final SocketEventCallback? onStatusChanged;
  final SocketEventCallback? onOrderCompleted;
  final SocketEventCallback? onNoDriverFound;
  final SocketEventCallback? onDriverCancelled;
  final SocketEventCallback? onDestinationUpdated;
  final SocketEventCallback? onScheduleConfirm;
  final SocketEventCallback? onSettlementUpdated;
  final SocketEventCallback? onGuaranteePending;

  const _SocketListeners({
    this.onOrderAssigned,
    this.onDriverLocation,
    this.onStatusChanged,
    this.onOrderCompleted,
    this.onNoDriverFound,
    this.onDriverCancelled,
    this.onDestinationUpdated,
    this.onScheduleConfirm,
    this.onSettlementUpdated,
    this.onGuaranteePending,
  });
}

/// Single, app-wide Socket.IO connection for the customer order flow.
/// Screens subscribe independently; navigating between tracking screens no
/// longer overwrites or clears another screen's callbacks.
class NodeSocketManager with WidgetsBindingObserver {
  NodeSocketManager._internal();
  static final NodeSocketManager instance = NodeSocketManager._internal();

  IO.Socket? _socket;
  int? _uid;
  String? _activeOrderId;
  int _nextSubscriptionId = 0;
  bool _lifecycleRegistered = false;
  final Map<int, _SocketListeners> _listeners = {};

  final ValueNotifier<SocketConnectionState> connectionState =
      ValueNotifier(SocketConnectionState.disconnected);

  bool get isConnected => _socket?.connected ?? false;
  bool get isReconnecting => connectionState.value == SocketConnectionState.reconnecting;

  NodeSocketSubscription addListeners({
    SocketEventCallback? onOrderAssigned,
    SocketEventCallback? onDriverLocation,
    SocketEventCallback? onStatusChanged,
    SocketEventCallback? onOrderCompleted,
    SocketEventCallback? onNoDriverFound,
    SocketEventCallback? onDriverCancelled,
    SocketEventCallback? onDestinationUpdated,
    SocketEventCallback? onScheduleConfirm,
    SocketEventCallback? onSettlementUpdated,
    SocketEventCallback? onGuaranteePending,
  }) {
    final id = ++_nextSubscriptionId;
    _listeners[id] = _SocketListeners(
      onOrderAssigned: onOrderAssigned,
      onDriverLocation: onDriverLocation,
      onStatusChanged: onStatusChanged,
      onOrderCompleted: onOrderCompleted,
      onNoDriverFound: onNoDriverFound,
      onDriverCancelled: onDriverCancelled,
      onDestinationUpdated: onDestinationUpdated,
      onScheduleConfirm: onScheduleConfirm,
      onSettlementUpdated: onSettlementUpdated,
      onGuaranteePending: onGuaranteePending,
    );
    return NodeSocketSubscription(this, id);
  }

  void _removeListeners(int id) => _listeners.remove(id);

  void _setConnectionState(SocketConnectionState state) {
    if (connectionState.value != state) connectionState.value = state;
  }

  void _joinCurrentRoom() {
    if (_uid == null || !isConnected) return;
    _socket!.emit('customer:join', {
      'user_id': _uid,
      if (_activeOrderId != null) 'order_id': _activeOrderId,
    });
  }

  /// Call after login or on cold start while already logged in.
  void connectCustomer(int uid, {String? orderId}) {
    if (orderId != null && orderId.isNotEmpty) _activeOrderId = orderId;

    if (_socket != null && _uid == uid) {
      if (!isConnected) {
        _setConnectionState(SocketConnectionState.reconnecting);
        _socket!.connect();
      } else {
        _joinCurrentRoom();
      }
      return;
    }

    _uid = uid;
    _socket?.dispose();
    _setConnectionState(SocketConnectionState.connecting);
    _ensureLifecycleObserver();

    _socket = IO.io(
      Config.nodeBaseUrl,
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .enableReconnection()
          .build(),
    );

    _socket!.on('connecting', (_) => _setConnectionState(SocketConnectionState.connecting));
    _socket!.on('reconnect_attempt', (_) => _setConnectionState(SocketConnectionState.reconnecting));
    _socket!.on('reconnect', (_) => _setConnectionState(SocketConnectionState.connected));
    _socket!.onConnect((_) {
      _setConnectionState(SocketConnectionState.connected);
      debugPrint('[NodeSocket] connected, joining customer $_uid');
      _joinCurrentRoom();
    });
    _socket!.onDisconnect((_) {
      _setConnectionState(SocketConnectionState.disconnected);
      debugPrint('[NodeSocket] disconnected');
    });
    _socket!.onConnectError((e) {
      _setConnectionState(SocketConnectionState.reconnecting);
      debugPrint('[NodeSocket] connect error: $e');
    });
    _socket!.onError((e) => debugPrint('[NodeSocket] error: $e'));

    _socket!.on('order:assigned', (data) => _dispatch((l) => l.onOrderAssigned, data));
    _socket!.on('driver:location_stream', (data) => _dispatch((l) => l.onDriverLocation, data));
    _socket!.on('order:status_changed', (data) => _dispatch((l) => l.onStatusChanged, data));
    _socket!.on('order:completed', (data) => _dispatch((l) => l.onOrderCompleted, data));
    _socket!.on('order:no_driver_found', (data) => _dispatch((l) => l.onNoDriverFound, data));
    _socket!.on('order:guarantee_pending', (data) => _dispatch((l) => l.onGuaranteePending, data));
    _socket!.on('order:driver_cancelled', (data) => _dispatch((l) => l.onDriverCancelled, data));
    _socket!.on('order:destination_updated', (data) => _dispatch((l) => l.onDestinationUpdated, data));
    _socket!.on('order:schedule_confirm', (data) => _dispatch((l) => l.onScheduleConfirm, data));
    _socket!.on('settlement:updated', (data) => _dispatch((l) => l.onSettlementUpdated, data));

    _socket!.connect();
  }

  void _dispatch(SocketEventCallback? Function(_SocketListeners) selector, dynamic data) {
    final payload = _asMap(data);
    for (final listener in List<_SocketListeners>.from(_listeners.values)) {
      selector(listener)?.call(payload);
    }
  }

  void joinOrder(String orderId) {
    if (orderId.isEmpty || _uid == null) return;
    _activeOrderId = orderId;
    _joinCurrentRoom();
  }

  void _ensureLifecycleObserver() {
    if (_lifecycleRegistered) return;
    WidgetsBinding.instance.addObserver(this);
    _lifecycleRegistered = true;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || _uid == null) return;
    debugPrint('[NodeSocket] app resumed, reconnecting/rejoining active order');
    if (_socket == null) {
      connectCustomer(_uid!, orderId: _activeOrderId);
    } else if (!isConnected) {
      _setConnectionState(SocketConnectionState.reconnecting);
      _socket!.connect();
    } else {
      _joinCurrentRoom();
    }
  }

  /// Call on logout only.
  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _uid = null;
    _activeOrderId = null;
    _listeners.clear();
    _setConnectionState(SocketConnectionState.disconnected);
  }

  Map<String, dynamic> _asMap(dynamic data) {
    if (data is Map) return Map<String, dynamic>.from(data);
    return {};
  }
}

class SocketStatusBanner extends StatelessWidget {
  const SocketStatusBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<SocketConnectionState>(
      valueListenable: NodeSocketManager.instance.connectionState,
      builder: (context, state, _) {
        if (state == SocketConnectionState.connected) return const SizedBox.shrink();
        final isDisconnected = state == SocketConnectionState.disconnected;
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          color: isDisconnected ? Colors.red.shade700 : Colors.orange.shade700,
          child: Row(
            children: [
              Icon(isDisconnected ? Icons.cloud_off : Icons.sync, color: Colors.white, size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  isDisconnected ? 'Connection lost. Reconnecting...' : 'Reconnecting to live updates...',
                  style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
