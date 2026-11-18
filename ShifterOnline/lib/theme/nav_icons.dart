/// Bottom-nav icons (v2): thin rounded outline when idle, solid brand-filled when the tab is selected.
/// Original Shifter drawings in assets/v2/ (style inspired by Porter's nav, no Porter artwork).
class NavIcon {
  const NavIcon(this.outline, this.filled);

  final String outline;
  final String filled;
}

class NavIcons {
  static const home = NavIcon('assets/v2/nav_home.svg', 'assets/v2/nav_home_filled.svg');
  static const orders = NavIcon('assets/v2/nav_orders.svg', 'assets/v2/nav_orders_filled.svg');
  static const wallet = NavIcon('assets/v2/nav_wallet.svg', 'assets/v2/nav_wallet_filled.svg');
  static const account = NavIcon('assets/v2/nav_account.svg', 'assets/v2/nav_account_filled.svg');

  static const all = [home, orders, wallet, account];
}
