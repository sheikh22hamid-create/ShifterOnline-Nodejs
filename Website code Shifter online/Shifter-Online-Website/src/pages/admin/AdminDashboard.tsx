import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Clock,
  CheckCircle2,
  UserPlus,
  Search,
  RefreshCw,
  Download,
  Edit2,
  Trash2,
  LogOut,
  ExternalLink,
  Shield,
  Phone,
  Mail,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  AlertTriangle,
  Loader2,
  Check,
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import {
  adminApi,
  AdminApiError,
  type WebsiteUser,
  type AdminStats,
  type UserStatus,
} from '../../lib/adminApi';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function AdminDashboard() {
  const { admin, logout } = useAdminAuth();

  // Dashboard Data State
  const [users, setUsers] = useState<WebsiteUser[]>([]);
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    pendingUsers: 0,
    completedUsers: 0,
    todayUsers: 0,
  });
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Completed'>('All');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsersCount, setTotalUsersCount] = useState(0);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<WebsiteUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<WebsiteUser | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
    password: '',
    status: 'Pending' as UserStatus,
  });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Quick status toggle loading map
  const [statusLoadingMap, setStatusLoadingMap] = useState<Record<string, boolean>>({});

  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const data = await adminApi.getStats();
      setStats(data);
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch Users
  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getUsers({
        page,
        limit,
        search,
        status: statusFilter,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      setUsers(data.users);
      setTotalPages(data.pagination.totalPages);
      setTotalUsersCount(data.pagination.total);
    } catch (err) {
      if (err instanceof AdminApiError) {
        addToast('error', err.message);
      } else {
        addToast('error', 'Failed to fetch users list.');
      }
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, addToast]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Handle Search Input Debounce / Change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const handleStatusFilterChange = (status: 'All' | 'Pending' | 'Completed') => {
    setStatusFilter(status);
    setPage(1);
  };

  // Quick Status Toggle
  const handleToggleStatus = async (user: WebsiteUser, targetStatus: UserStatus) => {
    if (user.status === targetStatus) return;
    setStatusLoadingMap((prev) => ({ ...prev, [user.id]: true }));
    try {
      await adminApi.updateUserStatus(user.id, targetStatus);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: targetStatus } : u))
      );
      addToast('success', `${user.name}'s status updated to ${targetStatus}`);
      fetchStats();
    } catch (err) {
      addToast('error', err instanceof AdminApiError ? err.message : 'Failed to update status');
    } finally {
      setStatusLoadingMap((prev) => ({ ...prev, [user.id]: false }));
    }
  };

  // Open Create User Modal
  const handleOpenAddModal = () => {
    setFormData({
      name: '',
      email: '',
      mobile: '',
      password: '',
      status: 'Pending',
    });
    setFormError(null);
    setIsAddModalOpen(true);
  };

  // Open Edit User Modal
  const handleOpenEditModal = (user: WebsiteUser) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email || '',
      mobile: user.mobile || '',
      password: '',
      status: user.status,
    });
    setFormError(null);
  };

  // Submit Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanedMobile = formData.mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanedMobile)) {
      setFormError('Please enter a valid 10-digit Indian mobile number (e.g., 9876543210)');
      return;
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setFormError('Please enter a valid email address');
      return;
    }

    setFormSubmitting(true);
    try {
      await adminApi.createUser({
        name: formData.name.trim(),
        mobile: cleanedMobile,
        email: formData.email.trim() || undefined,
        password: formData.password,
        status: formData.status,
      });
      setIsAddModalOpen(false);
      addToast('success', `User "${formData.name}" created successfully!`);
      fetchUsers();
      fetchStats();
    } catch (err) {
      setFormError(err instanceof AdminApiError ? err.message : 'Failed to create user');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Edit User
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setFormError(null);

    const cleanedMobile = formData.mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanedMobile)) {
      setFormError('Please enter a valid 10-digit Indian mobile number (e.g., 9876543210)');
      return;
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setFormError('Please enter a valid email address');
      return;
    }

    setFormSubmitting(true);
    try {
      await adminApi.updateUser(editingUser.id, {
        name: formData.name.trim(),
        mobile: cleanedMobile,
        email: formData.email.trim() || undefined,
        status: formData.status,
        ...(formData.password ? { password: formData.password } : {}),
      });
      setEditingUser(null);
      addToast('success', `User "${formData.name}" updated successfully!`);
      fetchUsers();
      fetchStats();
    } catch (err) {
      setFormError(err instanceof AdminApiError ? err.message : 'Failed to update user');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Delete User
  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setFormSubmitting(true);
    try {
      await adminApi.deleteUser(deletingUser.id);
      addToast('success', `User "${deletingUser.name}" deleted successfully.`);
      setDeletingUser(null);
      fetchUsers();
      fetchStats();
    } catch (err) {
      addToast('error', err instanceof AdminApiError ? err.message : 'Failed to delete user');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Export Users Sheet as CSV
  const handleExportCSV = () => {
    if (users.length === 0) {
      addToast('info', 'No user data available to export.');
      return;
    }

    const headers = ['User ID', 'Name', 'Mobile', 'Email', 'Status', 'Registered At', 'Last Login'];
    const rows = users.map((u) => [
      `"${u.id}"`,
      `"${u.name.replace(/"/g, '""')}"`,
      `"${u.mobile || 'N/A'}"`,
      `"${u.email || 'N/A'}"`,
      `"${u.status}"`,
      `"${new Date(u.createdAt).toLocaleString()}"`,
      `"${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `shifter_users_sheet_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('success', 'Users sheet exported to CSV successfully!');
  };

  // Format Date Helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  // Get Initials for Avatar
  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="min-h-screen bg-[#07132b] text-slate-100 selection:bg-orange selection:text-white">
      {/* Toast Notifications container */}
      <div className="fixed top-5 right-5 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-lg ${
                t.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                  : t.type === 'error'
                  ? 'bg-red-950/90 border-red-500/40 text-red-200'
                  : 'bg-slate-900/90 border-slate-700/60 text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5 text-sm font-medium">
                {t.type === 'success' && <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />}
                {t.type === 'error' && <AlertTriangle size={18} className="text-red-400 shrink-0" />}
                {t.type === 'info' && <Shield size={18} className="text-orange shrink-0" />}
                <span>{t.message}</span>
              </div>
              <button
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={15} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#07132b]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          {/* Left Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-orange to-orange-light shadow-md shadow-orange/20">
              <Shield size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-tight text-white text-lg">Shifter Online</span>
                <span className="rounded-md bg-orange/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-orange border border-orange/20">
                  Admin Panel
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Control Center & User Sheet</p>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-3">
            <Link
              to="/"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-800/40 px-3.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <ExternalLink size={14} />
              View Website
            </Link>

            <div className="hidden md:flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-royal text-xs font-bold text-white">
                SA
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-white leading-tight">{admin?.name || 'Super Admin'}</p>
                <p className="text-[10px] text-slate-400">{admin?.email}</p>
              </div>
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* KPI / Metric Cards Grid */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total Users */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Users</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-royal/20 text-blue-400 border border-royal/30">
                <Users size={18} />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">
                {statsLoading ? '...' : stats.totalUsers}
              </span>
              <span className="text-xs text-slate-400 font-medium">registered</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">Across entire website platform</div>
          </div>

          {/* Card 2: Pending Status */}
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-950/15 p-5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-400">Pending Review</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Clock size={18} />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-black text-amber-300">
                {statsLoading ? '...' : stats.pendingUsers}
              </span>
              <span className="text-xs text-amber-400/80 font-medium">pending users</span>
            </div>
            <div className="mt-2 text-[11px] text-amber-500/70">Awaiting verification / completion</div>
          </div>

          {/* Card 3: Completed Status */}
          <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-950/15 p-5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Completed Users</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 size={18} />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-black text-emerald-300">
                {statsLoading ? '...' : stats.completedUsers}
              </span>
              <span className="text-xs text-emerald-400/80 font-medium">verified</span>
            </div>
            <div className="mt-2 text-[11px] text-emerald-500/70">Active & verified accounts</div>
          </div>

          {/* Card 4: New Today */}
          <div className="relative overflow-hidden rounded-2xl border border-orange/20 bg-orange/5 p-5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-orange">Joined Today</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange/20 text-orange border border-orange/30">
                <UserPlus size={18} />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-black text-orange-light">
                {statsLoading ? '...' : stats.todayUsers}
              </span>
              <span className="text-xs text-orange/80 font-medium">new signups</span>
            </div>
            <div className="mt-2 text-[11px] text-orange/60">Registered in the last 24h</div>
          </div>
        </section>

        {/* Users Sheet Section */}
        <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6 shadow-2xl backdrop-blur-xl">
          {/* Header Controls */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black text-white flex items-center gap-2.5">
                <span>Users Sheet & Records</span>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-bold text-slate-300 border border-slate-700">
                  {totalUsersCount} records
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                View, filter, manage users, toggle completion status, and perform CRUD operations.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
              >
                <Download size={15} />
                Export CSV Sheet
              </button>

              <button
                onClick={() => {
                  fetchUsers();
                  fetchStats();
                  addToast('info', 'Refreshing users data...');
                }}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                title="Refresh Table"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>

              <button
                onClick={handleOpenAddModal}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange to-orange-light px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange/20 transition-all hover:brightness-110 active:scale-95"
              >
                <UserPlus size={15} />
                Add New User
              </button>
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-y border-slate-800/80 py-4">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder="Search by name, email, or mobile..."
                className="w-full rounded-xl border border-slate-700/80 bg-slate-800/60 pl-9 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:border-orange focus:outline-none focus:ring-1 focus:ring-orange/30"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-800/40 p-1">
              {(['All', 'Pending', 'Completed'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => handleStatusFilterChange(st)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    statusFilter === st
                      ? 'bg-orange text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
                  }`}
                >
                  {st}
                  {st === 'Pending' && stats.pendingUsers > 0 && (
                    <span className="ml-1.5 rounded-full bg-amber-400/20 px-1.5 py-0.2 text-[10px] text-amber-300 font-bold">
                      {stats.pendingUsers}
                    </span>
                  )}
                  {st === 'Completed' && stats.completedUsers > 0 && (
                    <span className="ml-1.5 rounded-full bg-emerald-400/20 px-1.5 py-0.2 text-[10px] text-emerald-300 font-bold">
                      {stats.completedUsers}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Table / Sheet Display */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-800/30 uppercase tracking-wider text-[10px] font-bold text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3.5">User</th>
                  <th scope="col" className="px-4 py-3.5">Contact Details</th>
                  <th scope="col" className="px-4 py-3.5">Registered</th>
                  <th scope="col" className="px-4 py-3.5">Last Login</th>
                  <th scope="col" className="px-4 py-3.5 text-center">Status</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <Loader2 size={24} className="animate-spin text-orange" />
                        <p className="text-xs font-medium">Loading user records from database...</p>
                      </div>
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Users size={32} className="text-slate-600" />
                        <p className="text-sm font-semibold text-slate-300">No users found</p>
                        <p className="text-xs text-slate-500">
                          {search || statusFilter !== 'All'
                            ? 'Try adjusting your search query or status filter.'
                            : 'No user accounts exist in the database yet.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  users.map((user) => {
                    const isPending = user.status === 'Pending';
                    const isUpdatingStatus = statusLoadingMap[user.id];

                    return (
                      <tr
                        key={user.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        {/* User info */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 text-xs font-bold text-white border border-slate-700">
                              {getInitials(user.name)}
                            </div>
                            <div>
                              <p className="font-bold text-white text-[13px]">{user.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">ID: {user.id.slice(-6)}</p>
                            </div>
                          </div>
                        </td>

                        {/* Contact info */}
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col gap-1">
                            <a
                              href={`tel:${user.mobile}`}
                              className="flex items-center gap-1.5 font-semibold text-slate-200 hover:text-orange transition-colors"
                            >
                              <Phone size={12} className="text-orange shrink-0" />
                              <span>{user.mobile}</span>
                            </a>
                            {user.email ? (
                              <a
                                href={`mailto:${user.email}`}
                                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                              >
                                <Mail size={12} className="text-slate-500 shrink-0" />
                                <span>{user.email}</span>
                              </a>
                            ) : (
                              <span className="flex items-center gap-1.5 text-[11px] text-slate-500 italic">
                                <Mail size={12} className="text-slate-600 shrink-0" />
                                <span>No email</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Registered date */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Calendar size={13} className="text-slate-500 shrink-0" />
                            <span>{formatDate(user.createdAt)}</span>
                          </div>
                        </td>

                        {/* Last Login date */}
                        <td className="px-4 py-3.5">
                          <span
                            className={`text-xs ${
                              user.lastLoginAt ? 'text-slate-300' : 'text-slate-600 italic'
                            }`}
                          >
                            {formatDate(user.lastLoginAt)}
                          </span>
                        </td>

                        {/* Status Switcher & Badge */}
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex items-center gap-2">
                            {isUpdatingStatus ? (
                              <Loader2 size={16} className="animate-spin text-orange" />
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold border ${
                                    isPending
                                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                  }`}
                                >
                                  {isPending ? (
                                    <Clock size={12} className="text-amber-400" />
                                  ) : (
                                    <CheckCircle2 size={12} className="text-emerald-400" />
                                  )}
                                  {user.status}
                                </span>

                                {/* Quick Toggle Button */}
                                <button
                                  onClick={() =>
                                    handleToggleStatus(
                                      user,
                                      isPending ? 'Completed' : 'Pending'
                                    )
                                  }
                                  title={`Switch status to ${isPending ? 'Completed' : 'Pending'}`}
                                  className="rounded-lg border border-slate-700 bg-slate-800 p-1 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                                >
                                  {isPending ? (
                                    <Check size={12} className="text-emerald-400" />
                                  ) : (
                                    <Clock size={12} className="text-amber-400" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEditModal(user)}
                              title="Edit User"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:border-royal hover:bg-royal hover:text-white"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => setDeletingUser(user)}
                              title="Delete User"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-red-400 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-800 pt-4 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span className="ml-2">
                Showing {users.length > 0 ? (page - 1) * limit + 1 : 0} to{' '}
                {Math.min(page * limit, totalUsersCount)} of {totalUsersCount} users
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} />
                Previous
              </button>
              <span className="px-2 font-medium text-slate-300">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ==========================================
          MODAL: ADD NEW USER
      ========================================== */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange/20 text-orange">
                    <UserPlus size={18} />
                  </div>
                  <h3 className="text-lg font-bold text-white">Add New User</h3>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              {formError && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-300">
                  {formError}
                </div>
              )}

              <form onSubmit={handleCreateUser} className="mt-5 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Full Name *</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Mobile Number *</label>
                  <input
                    required
                    type="tel"
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    placeholder="e.g. 9876543210"
                    maxLength={14}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Email Address (Optional)</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="e.g. rahul@example.com"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Password * (Min 8 chars)</label>
                  <input
                    required
                    minLength={8}
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Initial Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as UserStatus })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-slate-800 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange to-orange-light px-4 py-2 text-xs font-bold text-white shadow-lg shadow-orange/20 hover:brightness-110 disabled:opacity-60"
                  >
                    {formSubmitting && <Loader2 size={14} className="animate-spin" />}
                    Create User
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==========================================
          MODAL: EDIT USER
      ========================================== */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-royal/20 text-blue-400">
                    <Edit2 size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Edit User Record</h3>
                    <p className="text-[11px] text-slate-500 font-mono">ID: {editingUser.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingUser(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              {formError && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-300">
                  {formError}
                </div>
              )}

              <form onSubmit={handleUpdateUser} className="mt-5 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Full Name *</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Mobile Number *</label>
                  <input
                    required
                    type="tel"
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    placeholder="e.g. 9876543210"
                    maxLength={14}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Email Address (Optional)</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="e.g. rahul@example.com"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    New Password <span className="text-slate-500 font-normal">(Leave blank to keep existing)</span>
                  </label>
                  <input
                    minLength={8}
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter new password to change..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Account Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as UserStatus })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs text-white focus:border-orange focus:outline-none"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-slate-800 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange to-orange-light px-4 py-2 text-xs font-bold text-white shadow-lg shadow-orange/20 hover:brightness-110 disabled:opacity-60"
                  >
                    {formSubmitting && <Loader2 size={14} className="animate-spin" />}
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==========================================
          MODAL: DELETE CONFIRMATION
      ========================================== */}
      <AnimatePresence>
        {deletingUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md rounded-3xl border border-red-500/30 bg-slate-900 p-6 sm:p-8 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Delete User Record?</h3>
                  <p className="text-xs text-slate-400">This action is permanent and cannot be undone.</p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-800/40 p-4">
                <p className="text-xs text-slate-400">Target User:</p>
                <p className="mt-1 font-bold text-white text-sm">{deletingUser.name}</p>
                <p className="text-xs text-slate-400">{deletingUser.mobile} {deletingUser.email ? `• ${deletingUser.email}` : ''}</p>
                <p className="mt-1 text-[11px] text-slate-500 font-mono">ID: {deletingUser.id}</p>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeletingUser(null)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteUser}
                  disabled={formSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-red-600/20 hover:bg-red-500 disabled:opacity-60"
                >
                  {formSubmitting && <Loader2 size={14} className="animate-spin" />}
                  Yes, Delete Record
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
