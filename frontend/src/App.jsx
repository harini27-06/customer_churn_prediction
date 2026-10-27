import { startTransition, useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudUpload,
  Command,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  House,
  Menu,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import Papa from "papaparse";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, exportHistoryUrl } from "./services/api";

const navigation = [
  { label: "Overview", path: "/", icon: House },
  { label: "Customer insights", path: "/analytics", icon: Users },
  { label: "Check a customer", path: "/predict", icon: ShieldAlert },
  { label: "Review a customer list", path: "/bulk", icon: FileSpreadsheet },
  { label: "Prediction quality", path: "/quality", icon: BarChart3 },
  { label: "Recent activity", path: "/history", icon: Clock3 },
];
const orderFeatureNames = [
  "TotalOrders",
  "DeliveredOrders",
  "ReturnedOrders",
  "CancelledOrders",
  "OrderRevenue",
  "OrderAverageValue",
  "DaysSinceLastOrder",
  "DistinctOrderCategories",
  "AverageOrderDiscount",
];
const pageInfo = {
  "/": [
    "Customer overview",
    "Understand customer activity, spot retention opportunities, and decide where to focus next.",
  ],
  "/analytics": [
    "Customer insights",
    "Explore buying patterns and see which customer groups may need more attention.",
  ],
  "/predict": [
    "Check a customer",
    "Get a simple retention outlook and helpful ideas for your next customer conversation.",
  ],
  "/bulk": [
    "Review a customer list",
    "Find customers who may benefit from timely, personal outreach.",
  ],
  "/quality": [
    "Prediction quality",
    "See how well customer outlooks matched previous outcomes.",
  ],
  "/history": [
    "Recent activity",
    "Review customer checks completed by your team.",
  ],
};
const chartColors = [
  "#d95d39",
  "#218477",
  "#edaa46",
  "#7180bb",
  "#3999a8",
  "#c17c98",
];
const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const resourceCache = new Map();
const resourceRequests = new Map();

function cacheResource(key, value) {
  resourceCache.delete(key);
  resourceCache.set(key, value);
  if (resourceCache.size > 50)
    resourceCache.delete(resourceCache.keys().next().value);
}

function invalidateResources(matches) {
  for (const key of resourceCache.keys())
    if (matches(key)) resourceCache.delete(key);
  for (const key of resourceRequests.keys())
    if (matches(key)) resourceRequests.delete(key);
}

function useResource(loader, resourceKey = "") {
  const [state, setState] = useState(() =>
    resourceCache.has(resourceKey)
      ? { data: resourceCache.get(resourceKey), loading: false, error: "" }
      : { data: null, loading: true, error: "" },
  );
  useEffect(() => {
    let active = true;
    if (resourceCache.has(resourceKey)) {
      setState({
        data: resourceCache.get(resourceKey),
        loading: false,
        error: "",
      });
      return () => {
        active = false;
      };
    }
    setState({ data: null, loading: true, error: "" });
    let request = resourceRequests.get(resourceKey);
    if (!request) {
      request = loader().then(({ data }) => {
        cacheResource(resourceKey, data.data);
        return data.data;
      });
      resourceRequests.set(resourceKey, request);
      request.then(
        () => resourceRequests.delete(resourceKey),
        () => resourceRequests.delete(resourceKey),
      );
    }
    request
      .then((data) => {
        if (active)
          startTransition(() => setState({ data, loading: false, error: "" }));
      })
      .catch(() => {
        if (active)
          startTransition(() =>
            setState({
              data: null,
              loading: false,
              error:
                "We could not load this information right now. Please try again.",
            }),
          );
      });
    return () => {
      active = false;
    };
  }, [resourceKey]);
  return state;
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [account, setAccount] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [activeMenu, setActiveMenu] = useState(null);
  const { data: health, loading: healthLoading } = useResource(
    () => api.get("/health"),
    "/health",
  );

  useEffect(() => {
    let active = true;
    api
      .get("/auth/session")
      .then(({ data }) => {
        if (active && data.data.authenticated) setAccount(data.data.account);
      })
      .catch(() => {
        if (active)
          setAuthError(
            "We could not connect to your account. Please try again.",
          );
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      invalidateResources(() => true);
      setAccount(null);
      setActiveMenu(null);
      navigate("/", { replace: true });
    }
  };

  if (authLoading)
    return (
      <div className="auth-loading">
        <span className="loading-spinner" /> Checking your sign-in...
      </div>
    );
  if (!account)
    return <SignInPage onSignedIn={setAccount} initialError={authError} />;

  const title = pageInfo[location.pathname]?.[0] || pageInfo["/"][0];
  const activeSection =
    navigation.find((item) => item.path === location.pathname)?.label ||
    "Overview";
  const initials = account.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark">
            <Shield size={20} strokeWidth={2.2} />
          </div>
          <div className="brand-copy">
            <strong>ChurnGuard</strong>
            <span>RETAIL RETENTION</span>
          </div>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {path === "/history" && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="insights-status-card">
            <div className="status-card-top">
              <span
                className={`status-pulse ${health?.model_available ? "online" : ""}`}
              />
              <span>
                {health?.model_available
                  ? "Customer insights ready"
                  : "Insights unavailable"}
              </span>
              <ArrowUp size={13} />
            </div>
            <p>
              {health?.model_available
                ? "Personalized customer guidance is available."
                : "Contact your workspace administrator for help."}
            </p>
          </div>
          <button
            className="profile-row"
            type="button"
            aria-label="Open profile menu"
            onClick={() =>
              setActiveMenu(activeMenu === "profile" ? null : "profile")
            }
          >
            <div className="avatar">{initials}</div>
            <div className="profile-copy">
              <strong>{account.name}</strong>
              <span>{account.email}</span>
            </div>
            <ChevronDown size={15} />
          </button>
        </div>
        <button
          className="collapse-button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft size={16} />
        </button>
      </aside>
      <main className="main-frame">
        <header className="topbar">
          <div className="mobile-brand">
            <button
              className="icon-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={19} />
            </button>
            <span>ChurnGuard</span>
          </div>
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{activeSection}</strong>
          </div>
          <div className="topbar-actions">
            <CustomerSearch
              onSearch={(term) => {
                setActiveMenu(null);
                navigate(`/analytics?search=${encodeURIComponent(term)}`);
              }}
            />
            <span
              className={`connection-indicator ${healthLoading ? "checking" : health?.backend === "connected" ? "online" : "offline"}`}
              title={
                healthLoading
                  ? "Checking service"
                  : health?.backend === "connected"
                    ? "Service connected"
                    : "Service unavailable"
              }
            />
            <div className="menu-anchor">
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                aria-expanded={activeMenu === "notifications"}
                onClick={() =>
                  setActiveMenu(
                    activeMenu === "notifications" ? null : "notifications",
                  )
                }
              >
                <Bell size={18} />
                {activeMenu !== "notifications" && <i />}
              </button>
              {activeMenu === "notifications" && (
                <NotificationMenu
                  onClose={() => setActiveMenu(null)}
                  onViewAll={() => {
                    setActiveMenu(null);
                    navigate("/history");
                  }}
                />
              )}
            </div>
            <div className="menu-anchor">
              <button
                className="top-avatar"
                type="button"
                aria-label="Open profile menu"
                aria-expanded={activeMenu === "profile"}
                onClick={() =>
                  setActiveMenu(activeMenu === "profile" ? null : "profile")
                }
              >
                {initials}
              </button>
              {activeMenu === "profile" && (
                <div className="popover profile-popover">
                  <div className="popover-account">
                    <strong>{account.name}</strong>
                    <span>{account.email}</span>
                  </div>
                  <button
                    className="popover-action signout-action"
                    onClick={signOut}
                  >
                    <span>Sign out</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-rule" /> CUSTOMER RETENTION
                INTELLIGENCE
              </div>
              <h1>{title}</h1>
              <p>{pageInfo[location.pathname]?.[1] || pageInfo["/"][1]}</p>
            </div>
            <div className="heading-meta">
              <span
                className={`health-tag ${health?.backend === "connected" ? "good" : ""}`}
              >
                <span />
                {healthLoading
                  ? "Checking"
                  : health?.backend === "connected"
                    ? "Service ready"
                    : "Service unavailable"}
              </span>
              <span className="updated-at">Ecommerce</span>
            </div>
          </div>
          <Routes>
            <Route path="/" element={<Dashboard health={health} />} />
            <Route
              path="/analytics"
              element={<CustomerAnalytics health={health} />}
            />
            <Route path="/predict" element={<PredictPage health={health} />} />
            <Route path="/bulk" element={<BulkPage health={health} />} />
            <Route path="/quality" element={<QualityPage />} />
            <Route path="/history" element={<HistoryPage health={health} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="page-footer">
            <span>CHURNGUARD</span>
            <span>
              Customer insights are a guide. Use your knowledge of each customer
              when deciding what to do next.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function SignInPage({ onSignedIn, initialError = "" }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = creating ? "/auth/register" : "/auth/login";
      const payload = creating
        ? { name, email, password }
        : { email, password };
      const { data } = await api.post(path, payload);
      invalidateResources(() => true);
      onSignedIn(data.data.account);
    } catch (failure) {
      setError(
        failure.response?.data?.error?.message ||
          "We could not sign you in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-icon">
            <Shield size={22} />
          </span>
          <div>
            <strong>ChurnGuard</strong>
            <span>RETAIL RETENTION</span>
          </div>
        </div>
        <p className="auth-eyebrow">CUSTOMER WORKSPACE</p>
        <h1>{creating ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-intro">
          {creating
            ? "Create an account to access your customer insights."
            : "Sign in to continue to your customer insights."}
        </p>
        <form onSubmit={submit} className="auth-form">
          {creating && (
            <label>
              Your name
              <input
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
                maxLength={80}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@company.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={creating ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={creating ? 8 : 1}
              placeholder={
                creating ? "At least 8 characters" : "Enter your password"
              }
            />
          </label>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button auth-submit" disabled={busy}>
            {busy ? "Please wait..." : creating ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="auth-switch">
          {creating ? "Already have an account?" : "New to ChurnGuard?"}{" "}
          <button
            onClick={() => {
              setCreating(!creating);
              setError("");
            }}
          >
            {creating ? "Sign in" : "Create an account"}
          </button>
        </p>
        <p className="auth-security">
          Your account is protected with a securely stored password.
        </p>
      </section>
    </main>
  );
}

function CustomerSearch({ onSearch }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/customers", {
          params: { search: term, page_size: 5 },
        });
        if (active) setResults(data.data.rows || []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const submit = (event) => {
    event.preventDefault();
    const term = query.trim();
    if (term) {
      onSearch(term);
      setOpen(false);
    }
  };
  const select = (row) => {
    const customerId = row.CustomerID ?? row.customerID ?? row.customer_id;
    onSearch(customerId == null ? query.trim() : String(customerId));
    setOpen(false);
  };

  return (
    <div className="search-anchor">
      <form className="global-search" role="search" onSubmit={submit}>
        <Search size={16} />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder="Search customers..."
          aria-label="Search customers"
          autoComplete="off"
        />
        <button className="search-submit" type="submit" aria-label="Search">
          <ArrowRight size={14} />
        </button>
      </form>
      {open && query.trim().length >= 2 && (
        <div className="search-popover">
          {loading ? (
            <div className="popover-empty">Searching customers...</div>
          ) : results.length ? (
            results.map((row, index) => (
              <button
                className="search-result"
                key={row.CustomerID ?? row.customerID ?? index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(row)}
              >
                <span className="search-result-icon">
                  <Users size={15} />
                </span>
                <span>
                  <strong>
                    Customer {row.CustomerID ?? row.customerID ?? "record"}
                  </strong>
                  <small>
                    {[row.Membership, row.PreferredCategory, row.Region]
                      .filter(Boolean)
                      .join(" ? ") || "View customer details"}
                  </small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))
          ) : (
            <div className="popover-empty">No matching customers found.</div>
          )}
          <button
            className="search-all"
            onMouseDown={(event) => event.preventDefault()}
            onClick={submit}
          >
            Search for ?{query.trim()}?
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationMenu({ onClose, onViewAll }) {
  const { data, loading } = useResource(
    () =>
      api.get("/predictions/history", { params: { page: 1, page_size: 4 } }),
    "/notifications/recent",
  );
  const rows = data?.rows || [];
  return (
    <div className="popover notification-popover">
      <div className="popover-heading">
        <strong>Recent customer activity</strong>
        <button onClick={onClose} aria-label="Close notifications">
          <X size={15} />
        </button>
      </div>
      {loading ? (
        <div className="popover-empty">Loading recent activity...</div>
      ) : rows.length ? (
        <div className="notification-list">
          {rows.map((row) => (
            <div className="notification-item" key={row.id}>
              <span
                className={`notification-mark ${row.risk?.toLowerCase() || ""}`}
              >
                <Bell size={14} />
              </span>
              <span>
                <strong>
                  {row.customer_id
                    ? `Customer ${row.customer_id}`
                    : "Customer check completed"}
                </strong>
                <small>
                  {row.risk ? `${row.risk} priority` : "Customer outlook ready"}{" "}
                  ? {formatDate(row.created_at)}
                </small>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="popover-empty">
          New customer activity will appear here.
        </div>
      )}
      <button className="search-all" onClick={onViewAll}>
        View all activity <ArrowRight size={14} />
      </button>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone = "teal" }) {
  return (
    <section className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
      <div className={`metric-accent ${tone}`} />
    </section>
  );
}
function SectionHeader({ title, note, action }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {action}
    </div>
  );
}
function EmptyState({
  title = "Customer insights are not available yet",
  message = "Please try again later or contact your workspace administrator for help.",
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Database size={21} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      <NavLink className="text-link" to="/">
        Back to overview <ArrowRight size={14} />
      </NavLink>
    </div>
  );
}
function LoadingLine() {
  return (
    <div className="loading-line">
      <span /> Loading your customer insights
    </div>
  );
}
function ChartEmpty() {
  return (
    <div className="chart-empty">
      There is not enough information to show this insight yet.
    </div>
  );
}

function Dashboard({ health }) {
  const { data, loading, error } = useResource(
    () => api.get("/analytics"),
    "/analytics",
  );
  const { data: history } = useResource(
    () => api.get("/predictions/history?page_size=5"),
    "/predictions/history?page_size=5",
  );
  const charts = data?.charts || {};
  const atRisk = history?.rows?.filter(
    (item) => item.risk === "High" || item.risk === "Medium",
  ).length;
  if (loading) return <LoadingLine />;
  if (error) return <Notice message={error} />;
  const available = data?.available;
  return (
    <>
      {(health?.dataset_name || "").toLowerCase().includes("synthetic") && (
        <div className="dataset-disclosure" role="note">
          <AlertCircle size={16} />
          <span>
            This workspace is using synthetic demonstration data. Replace it
            with your approved customer dataset before presenting results as
            real business findings.
          </span>
        </div>
      )}
      <div className="metric-grid">
        <MetricCard
          label="Customers in view"
          value={available ? fmtNumber(data.total_customers) : "—"}
          detail={
            available
              ? "Customers included in your overview"
              : "Customer information is not available yet"
          }
          icon={Users}
          tone="teal"
        />
        <MetricCard
          label="Recent customers to prioritize"
          value={
            health?.model_available
              ? atRisk == null
                ? "—"
                : fmtNumber(atRisk)
              : "—"
          }
          detail={
            health?.model_available
              ? "Higher priority in recent checks"
              : "Ready when customer checks are available"
          }
          icon={ShieldAlert}
          tone="coral"
        />
        <MetricCard
          label="Customers who left"
          value={data?.churn_rate == null ? "—" : `${data.churn_rate}%`}
          detail={
            data?.churn_count == null
              ? "No customer outcome information yet"
              : `${fmtNumber(data.churn_count)} customers`
          }
          icon={Activity}
          tone="amber"
        />
        <MetricCard
          label="Customers who stayed"
          value={data?.retention_rate == null ? "—" : `${data.retention_rate}%`}
          detail={
            data?.retained_count == null
              ? "No customer outcome information yet"
              : `${fmtNumber(data.retained_count)} customers`
          }
          icon={BarChart3}
          tone="blue"
        />
      </div>
      {data?.orders && (
        <>
          <div className="section-header order-section-header">
            <div>
              <h2>Order performance</h2>
              <p>Sales and activity from your completed customer orders</p>
            </div>
          </div>
          <div className="metric-grid">
            <MetricCard
              label="Completed orders"
              value={fmtNumber(data.orders.delivered_orders)}
              detail={`${fmtNumber(data.orders.total_orders)} orders recorded`}
              icon={FileSpreadsheet}
              tone="teal"
            />
            <MetricCard
              label="Sales revenue"
              value={currency.format(data.orders.sales_revenue)}
              detail="From completed orders"
              icon={BarChart3}
              tone="blue"
            />
            <MetricCard
              label="Average order value"
              value={currency.format(data.orders.average_order_value)}
              detail="Per completed order"
              icon={Activity}
              tone="amber"
            />
            <MetricCard
              label="Returned or cancelled"
              value={fmtNumber(
                data.orders.returned_orders + data.orders.cancelled_orders,
              )}
              detail={`${fmtNumber(data.orders.returned_orders)} returned · ${fmtNumber(data.orders.cancelled_orders)} cancelled`}
              icon={AlertCircle}
              tone="coral"
            />
          </div>
          <div className="dashboard-grid order-chart-grid">
            <section className="panel chart-panel">
              <SectionHeader
                title="Sales over time"
                note="Monthly value of completed orders"
              />
              <div className="chart-area">
                {charts.sales_by_month?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={charts.sales_by_month}
                      margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="salesFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#218477"
                            stopOpacity={0.25}
                          />
                          <stop
                            offset="95%"
                            stopColor="#218477"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#e9eeeb" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => currency.format(value)}
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value) => [currency.format(value), "Sales"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="sales"
                        stroke="#218477"
                        strokeWidth={2.5}
                        fill="url(#salesFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty />
                )}
              </div>
            </section>
            <section className="panel chart-panel">
              <SectionHeader
                title="Sales by product category"
                note="Completed order sales across product groups"
              />
              <div className="chart-area">
                {charts.sales_by_category?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={charts.sales_by_category}
                      layout="vertical"
                      margin={{ top: 4, right: 20, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid horizontal={false} stroke="#e9eeeb" />
                      <XAxis
                        type="number"
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => currency.format(value)}
                        tick={{ fill: "#78827d", fontSize: 10 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={105}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#78827d", fontSize: 10 }}
                      />
                      <Tooltip
                        formatter={(value) => [currency.format(value), "Sales"]}
                      />
                      <Bar
                        dataKey="sales"
                        fill="#d49a3b"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={22}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty />
                )}
              </div>
            </section>
          </div>
        </>
      )}
      {!available ? (
        <EmptyState />
      ) : (
        <>
          <div className="dashboard-grid">
            <section className="panel chart-panel distribution-panel">
              <SectionHeader
                title="Customer outcomes"
                note="Customer outcomes at a glance"
              />
              <div className="distribution-body">
                {charts.distribution?.length ? (
                  <>
                    <div className="donut-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={charts.distribution}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="68%"
                            outerRadius="91%"
                            paddingAngle={4}
                            stroke="none"
                          >
                            {charts.distribution.map((entry, index) => (
                              <Cell
                                key={entry.name}
                                fill={index === 0 ? "#d95d39" : "#218477"}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => [
                              fmtNumber(value),
                              "Customers",
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="donut-center">
                        <strong>{fmtNumber(data.total_customers)}</strong>
                        <span>customers</span>
                      </div>
                    </div>
                    <div className="legend-list">
                      {charts.distribution.map((entry, index) => (
                        <div key={entry.name}>
                          <span
                            className={`legend-dot ${index === 0 ? "coral" : "teal"}`}
                          />
                          <span>{entry.name}</span>
                          <strong>{fmtNumber(entry.value)}</strong>
                          <small>
                            {data.total_customers
                              ? `${((entry.value / data.total_customers) * 100).toFixed(1)}%`
                              : "—"}
                          </small>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="chart-empty">
                    Customer outcomes are not available for this view yet.
                  </div>
                )}
              </div>
            </section>
            <section className="panel chart-panel">
              <SectionHeader
                title="Average order value"
                note="Typical order value for customers who stayed or left"
              />
              <div className="chart-area">
                {charts.monthly_charges?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={charts.monthly_charges}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="#e9eeeb" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => currency.format(value)}
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value) => [
                          currency.format(value),
                          "Average order value",
                        ]}
                      />
                      <Bar
                        dataKey="average"
                        fill="#218477"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={56}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty />
                )}
              </div>
            </section>
            <section className="panel chart-panel">
              <SectionHeader
                title="Order frequency & retention"
                note="How ordering patterns relate to customer retention"
              />
              <div className="chart-area">
                {charts.tenure?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={charts.tenure}
                      margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="tenureFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#e5a84c"
                            stopOpacity={0.25}
                          />
                          <stop
                            offset="95%"
                            stopColor="#e5a84c"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#e9eeeb" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        unit="%"
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          name === "churn_rate"
                            ? `${value}%`
                            : fmtNumber(value),
                          name === "churn_rate"
                            ? "Customers who left"
                            : "Customers",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="churn_rate"
                        stroke="#d49a3b"
                        strokeWidth={2.5}
                        fill="url(#tenureFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty />
                )}
              </div>
            </section>
            <section className="panel chart-panel">
              <SectionHeader
                title="Membership & retention"
                note="Customer retention across membership groups"
              />
              <div className="chart-area">
                {charts.contract?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={charts.contract}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="#e9eeeb" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        unit="%"
                        tick={{ fill: "#78827d", fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value) => [
                          `${value}%`,
                          "Customers who left",
                        ]}
                      />
                      <Bar
                        dataKey="churn_rate"
                        fill="#7180bb"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={56}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty />
                )}
              </div>
            </section>
          </div>
          <div className="lower-grid">
            <section className="panel activity-panel">
              <SectionHeader
                title="Recent customer checks"
                note="A quick view of recent customer activity"
                action={
                  <NavLink className="text-link" to="/history">
                    View history <ArrowRight size={14} />
                  </NavLink>
                }
              />
              {history?.rows?.length ? (
                <div className="activity-list">
                  {history.rows.slice(0, 4).map((item) => (
                    <div className="activity-row" key={item.id}>
                      <span
                        className={`activity-symbol ${item.risk?.toLowerCase() || "neutral"}`}
                      >
                        <ShieldAlert size={16} />
                      </span>
                      <div className="activity-copy">
                        <strong>{item.customer_id || "Customer"}</strong>
                        <span>
                          {item.predicted_label} ·{" "}
                          {item.risk || "Priority unavailable"} risk
                        </span>
                      </div>
                      <time>{formatDate(item.created_at)}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="inline-empty">
                  No customer checks have been completed yet.
                </div>
              )}
            </section>
            <section className="quick-panel">
              <div className="quick-kicker">
                <Sparkles size={15} /> QUICK ACTIONS
              </div>
              <NavLink to="/predict" className="quick-action">
                <span className="quick-action-icon">
                  <ShieldAlert size={17} />
                </span>
                <span>
                  <strong>Check a customer</strong>
                  <small>Get guidance for one customer</small>
                </span>
                <ArrowRight size={16} />
              </NavLink>
              <NavLink to="/bulk" className="quick-action">
                <span className="quick-action-icon orange">
                  <CloudUpload size={17} />
                </span>
                <span>
                  <strong>Review a customer list</strong>
                  <small>Find customers who may need attention</small>
                </span>
                <ArrowRight size={16} />
              </NavLink>
              <NavLink to="/analytics" className="quick-action">
                <span className="quick-action-icon blue">
                  <BarChart3 size={17} />
                </span>
                <span>
                  <strong>Explore customer insights</strong>
                  <small>Understand buying and retention patterns</small>
                </span>
                <ArrowRight size={16} />
              </NavLink>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function CustomerAnalytics({ health }) {
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [filter, setFilter] = useState("");
  const [contract, setContract] = useState("");
  const query = useMemo(
    () => ({ page, page_size: 12, search, churn: filter, contract }),
    [page, search, filter, contract],
  );
  const customers = useResource(
    () => api.get("/customers", { params: query }),
    JSON.stringify(query),
  );
  const analytics = useResource(() => api.get("/analytics"), "/analytics");
  const rows = customers.data?.rows || [];
  const columns = customers.data?.columns || health?.features || [];
  useEffect(() => {
    setSearch(searchParams.get("search") || "");
    setPage(1);
  }, [searchParams]);
  return (
    <>
      <section className="panel table-panel">
        <SectionHeader
          title="Customers"
          note={`${fmtNumber(customers.data?.total || 0)} customers match your filters`}
          action={
            <span className="table-count">
              {fmtNumber(customers.data?.total || 0)} customers
            </span>
          }
        />
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search customer records"
            />
          </label>
          <label className="filter-control">
            <Filter size={15} />
            <select
              value={filter}
              onChange={(event) => {
                setPage(1);
                setFilter(event.target.value);
              }}
            >
              <option value="">All customer statuses</option>
              <option value="1">May leave</option>
              <option value="0">Likely to stay</option>
            </select>
          </label>
          <label className="filter-control">
            <select
              value={contract}
              onChange={(event) => {
                setPage(1);
                setContract(event.target.value);
              }}
            >
              <option value="">All contracts</option>
              {uniqueValues(rows, "Membership").map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {customers.loading ? (
          <LoadingLine />
        ) : customers.error ? (
          <Notice message={customers.error} />
        ) : rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            positiveClass={health?.positive_class}
          />
        ) : (
          <EmptyState
            title={
              health?.dataset_available
                ? "No customers match these filters"
                : "Customer information is not available"
            }
            message={
              health?.dataset_available
                ? "Adjust the search or filters to see matching records."
                : undefined
            }
          />
        )}
        <div className="pagination">
          <span>
            Page {page} of{" "}
            {Math.max(1, Math.ceil((customers.data?.total || 0) / 12))}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Next page"
              disabled={page >= Math.ceil((customers.data?.total || 0) / 12)}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
      <section className="analytics-chart-grid">
        <AnalyticsBreakdown
          title="Retention by membership"
          items={analytics.data?.charts?.contract}
          color="#7180bb"
        />
        <AnalyticsBreakdown
          title="Retention by order frequency"
          items={analytics.data?.charts?.tenure}
          color="#d49a3b"
        />
        <AnalyticsBreakdown
          title="Retention by payment method"
          items={analytics.data?.charts?.payment_method}
          color="#218477"
        />
        <AnalyticsBreakdown
          title="Retention by product category"
          items={analytics.data?.charts?.category}
          color="#d95d39"
        />
      </section>
    </>
  );
}

function DataTable({ columns, rows, positiveClass = "1" }) {
  const visible = columns.slice(0, 9);
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {visible.map((column) => (
              <th key={column}>{columnLabel(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={
                row.prediction_id || row.customerID || row.customer_id || index
              }
            >
              {visible.map((column) => (
                <td key={column}>
                  {column.toLowerCase() === "churn"
                    ? (row[column] ?? row[columnKey(column)]) ===
                        positiveClass ||
                      String(row[column] ?? row[columnKey(column)]) ===
                        positiveClass
                      ? "May leave"
                      : "Likely to stay"
                    : column === "predicted_status"
                      ? String(row[column]) === String(row.positive_class)
                        ? "May leave"
                        : "Likely to stay"
                      : renderValue(row[column] ?? row[columnKey(column)])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsBreakdown({ title, items, color }) {
  return (
    <section className="panel compact-chart">
      <SectionHeader title={title} />
      {items?.length ? (
        <div className="mini-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={items}
              margin={{ top: 7, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#e9eeeb" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#78827d", fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#78827d", fontSize: 10 }}
              />
              <Tooltip />
              <Bar dataKey="churn_rate" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ChartEmpty />
      )}
    </section>
  );
}

function PredictPage({ health }) {
  const features = health?.features || [];
  const customerFeatures = features.filter(
    (name) => !orderFeatureNames.includes(name),
  );
  const schema = customerFeatures.map(
    (name) =>
      health?.feature_schema?.find((item) => item.name === name) || {
        name,
        type: "categorical",
        options: [],
      },
  );
  const [form, setForm] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const groups = schema.reduce((all, field) => {
    const section =
      field.type === "numeric" ? "Shopping activity" : "Customer details";
    (all[section] ||= []).push(field);
    return all;
  }, {});
  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    const empty = customerFeatures.filter(
      (name) => form[name] === undefined || form[name] === "",
    );
    if (empty.length) {
      setError(`Please complete: ${empty.map(columnLabel).join(", ")}`);
      setLoading(false);
      return;
    }
    try {
      const response = await api.post("/predict", { customer: form });
      invalidateResources(
        (key) =>
          key.includes("/predictions/history") ||
          key === "/notifications/recent",
      );
      setResult(response.data.data);
    } catch (failure) {
      setError("We could not complete this customer check. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="prediction-layout">
      <form className="panel prediction-form" onSubmit={submit}>
        {!health?.model_available ? (
          <div className="form-banner">
            <AlertCircle size={16} />
            <span>
              Customer checks are temporarily unavailable. Please try again
              later.
            </span>
          </div>
        ) : (
          <div className="form-banner neutral-banner">
            <CircleHelp size={16} />
            <span>
              Share a few details about this customer to get a helpful retention
              outlook.
            </span>
          </div>
        )}
        {!schema.length ? (
          <EmptyState
            title="Customer check unavailable"
            message="Please try again later or contact your workspace administrator for help."
          />
        ) : (
          <>
            <label className="form-field customer-id-field">
              <span>
                Customer ID <small>(optional)</small>
              </span>
              <input
                type="text"
                value={form.CustomerID ?? ""}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    CustomerID: event.target.value,
                  }))
                }
                placeholder="Match this customer to order history"
              />
              <small>
                If this ID is in your customer list, their order history will be
                included automatically.
              </small>
            </label>
            {Object.entries(groups).map(([group, fields]) => (
              <fieldset className="form-section" key={group}>
                <legend>{group}</legend>
                <div className="form-grid">
                  {fields.map((field) => (
                    <label className="form-field" key={field.name}>
                      <span>
                        {columnLabel(field.name)} <b>*</b>
                      </span>
                      {field.type === "numeric" ? (
                        <input
                          type="number"
                          step="any"
                          required
                          value={form[field.name] ?? ""}
                          onChange={(event) =>
                            setForm((value) => ({
                              ...value,
                              [field.name]: event.target.value,
                            }))
                          }
                          placeholder="Enter a value"
                        />
                      ) : (
                        <select
                          required
                          value={form[field.name] ?? ""}
                          onChange={(event) =>
                            setForm((value) => ({
                              ...value,
                              [field.name]: event.target.value,
                            }))
                          }
                        >
                          <option value="">
                            Select {columnLabel(field.name).toLowerCase()}
                          </option>
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      )}
                      <small>
                        {field.type === "numeric"
                          ? "Enter the customers latest information."
                          : "Choose the option that best describes this customer."}
                      </small>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </>
        )}
        {error && <Notice message={error} />}
        {!!schema.length && (
          <div className="form-actions">
            <span>Predictions are estimates, not guarantees.</span>
            <button
              className="primary-button"
              disabled={loading || !health?.model_available}
            >
              {loading ? (
                "Scoring customer…"
              ) : (
                <>
                  <ShieldAlert size={16} /> Get customer outlook
                </>
              )}
            </button>
          </div>
        )}
      </form>
      <aside className="prediction-aside">
        {result ? (
          <PredictionResult result={result} form={form} />
        ) : (
          <div className="panel result-placeholder">
            <div className="result-orbit">
              <Shield size={26} />
            </div>
            <span className="eyebrow">CUSTOMER OUTLOOK</span>
            <h2>Customer estimate</h2>
            <p>
              Complete the details to see a retention outlook and practical
              ideas for your next step.
            </p>
            <div className="placeholder-line" />
            <div className="placeholder-line short" />
            <div className="result-footnote">
              Use this guidance alongside your team?s knowledge of the customer.
            </div>
          </div>
        )}
        <RecommendationGuide features={form} />
      </aside>
    </div>
  );
}

function PredictionResult({ result, form }) {
  const churn = result.predicted_status === result.positive_class;
  const probability = result.churn_probability;
  return (
    <div className="panel result-panel">
      <div className={`result-status ${churn ? "risk" : "safe"}`}>
        <span>{churn ? <ShieldAlert size={18} /> : <Check size={18} />}</span>
        <div>
          <small>RETENTION OUTLOOK</small>
          <strong>{churn ? "May leave" : "Likely to stay"}</strong>
        </div>
      </div>
      {probability != null && (
        <div className="probability-block">
          <div className="probability-label">
            <span>Likelihood of leaving</span>
            <strong>{(probability * 100).toFixed(1)}%</strong>
          </div>
          <div className="probability-track">
            <span
              className={churn ? "risk" : "safe"}
              style={{ width: `${probability * 100}%` }}
            />
          </div>
          <div className="probability-scale">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <div className={`risk-pill ${result.risk_category?.toLowerCase()}`}>
            {result.risk_category} chance of leaving
          </div>
        </div>
      )}
      <div className="result-details">
        <strong>Customer snapshot</strong>
        {Object.entries(form)
          .slice(0, 5)
          .map(([key, value]) => (
            <div key={key}>
              <span>{columnLabel(key)}</span>
              <b>{renderValue(value)}</b>
            </div>
          ))}
      </div>
      <div className="recommendation-list">
        <strong>Ideas for your next step</strong>
        {makeRecommendations(form, churn).map((text) => (
          <p key={text}>
            <ArrowRight size={13} />
            {text}
          </p>
        ))}
      </div>
      <div className="explanation-note">
        These are general suggestions. Consider the customer?s circumstances
        before reaching out.
      </div>
      <div className="result-footnote">
        This is a helpful guide based on past customer patterns, not a guarantee
        of what someone will do.
      </div>
    </div>
  );
}

function RecommendationGuide({ features }) {
  return (
    <div className="recommendation-guide">
      <div className="guide-title">
        <Sparkles size={15} /> Retention insights
      </div>
      <p>
        {Object.keys(features).length
          ? "Use your team knowledge to decide which action is right for each customer."
          : "Complete a customer check to see practical retention ideas."}
      </p>
      <span>Every customer is different.</span>
    </div>
  );
}

function makeRecommendations(features, likelyToLeave) {
  const values = Object.fromEntries(
    Object.entries(features).map(([key, value]) => [
      key.toLowerCase(),
      Number(value),
    ]),
  );
  const suggestions = [];
  if (Number.isFinite(values.recencydays) && values.recencydays > 45)
    suggestions.push(
      "Reach out with a friendly update and ask how the shopping experience could improve.",
    );
  if (Number.isFinite(values.frequency) && values.frequency <= 3)
    suggestions.push(
      "Consider a relevant product recommendation or a welcome back offer.",
    );
  if (
    String(features.Membership || "").toLowerCase() === "silver" &&
    Number(values.monetaryvalue) > 0
  )
    suggestions.push(
      "Consider whether a loyalty benefit could make repeat shopping more rewarding.",
    );
  if (!suggestions.length)
    suggestions.push(
      likelyToLeave
        ? "Check in about the customers recent shopping experience and any unmet needs."
        : "Thank the customer for their continued business and share relevant new arrivals.",
    );
  return suggestions.slice(0, 3);
}

function BulkPage({ health }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const parsed = preview?.meta?.fields || [];
  const required = (health?.features || []).filter(
    (column) => !orderFeatureNames.includes(column),
  );
  const missing = required.filter((column) => !parsed.includes(column));
  const visible = results.filter(
    (row) =>
      filter === "all" ||
      (filter === "churn"
        ? row.predicted_status === row.positive_class
        : row.predicted_status !== row.positive_class),
  );
  const selectFile = (selected) => {
    if (!selected) return;
    setError("");
    setResults([]);
    setFile(selected);
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a customer list in CSV format.");
      return;
    }
    Papa.parse(selected, {
      header: true,
      preview: 8,
      skipEmptyLines: true,
      complete: (data) => setPreview(data),
      error: () =>
        setError("We could not read this file. Please check it and try again."),
    });
  };
  const runBatch = async () => {
    if (!file || missing.length || !health?.model_available) return;
    setLoading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await api.post("/predict/batch", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      invalidateResources(
        (key) =>
          key.includes("/predictions/history") ||
          key === "/notifications/recent",
      );
      setResults(response.data.data.results);
    } catch (failure) {
      setError(
        "We could not review this customer list. Please check the customer details and try again.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <div className="bulk-grid">
        <section className="panel upload-panel">
          <SectionHeader
            title="Add a customer list"
            note="CSV format · up to 16 MB · maximum 10,000 rows"
          />
          <label
            className={`drop-zone ${file ? "has-file" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              selectFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <span className="upload-icon">
              <CloudUpload size={21} />
            </span>
            <strong>{file ? file.name : "Drop your customer list here"}</strong>
            <small>
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · ${preview?.data?.length || "…"} preview rows`
                : "or choose a file from your device"}
            </small>
            <span className="browse-button">Choose file</span>
          </label>
          {error && <Notice message={error} />}
          {file && (
            <div className="schema-check">
              <div>
                <strong>File check</strong>
                <span>
                  {missing.length
                    ? `${missing.length} required customer detail${missing.length === 1 ? "" : "s"} missing`
                    : "All required customer details found"}
                </span>
              </div>
              <span
                className={missing.length ? "schema-invalid" : "schema-valid"}
              >
                {missing.length ? (
                  <AlertCircle size={16} />
                ) : (
                  <Check size={16} />
                )}
              </span>
              {missing.length > 0 && (
                <p>Missing: {missing.map(columnLabel).join(", ")}</p>
              )}
            </div>
          )}
          <button
            className="primary-button wide-button"
            onClick={runBatch}
            disabled={
              !file || missing.length > 0 || !health?.model_available || loading
            }
          >
            {loading ? (
              "Scoring records…"
            ) : (
              <>
                <Activity size={16} /> Review customer list
              </>
            )}
          </button>
          {!health?.model_available && (
            <p className="muted-hint">
              Customer list reviews are temporarily unavailable.
            </p>
          )}
        </section>
        <section className="panel upload-checklist">
          <div className="checklist-mark">
            <FileSpreadsheet size={19} />
          </div>
          <h2>Before you begin</h2>
          <ul>
            <li>
              <Check size={14} /> Include column headings so customer details
              can be recognized
            </li>
            <li>
              <Check size={14} /> Use the same customer details used by your
              team
            </li>
            <li>
              <Check size={14} /> Keep original customer fields intact
            </li>
            <li>
              <Check size={14} /> Complete customer details help provide a more
              useful review
            </li>
          </ul>
          <div className="privacy-note">
            <Shield size={15} />
            <span>
              Your customer list is used to provide retention guidance and is
              saved in your workspace history.
            </span>
          </div>
        </section>
      </div>
      {preview?.data?.length > 0 && (
        <section className="panel table-panel preview-panel">
          <SectionHeader
            title="File preview"
            note={`Showing ${preview.data.length} of the first rows · ${parsed.length} columns`}
          />
          <DataTable columns={parsed} rows={preview.data} />
        </section>
      )}
      {!!results.length && (
        <section className="panel table-panel results-table-panel">
          <SectionHeader
            title="Customer outlook"
            note={`${fmtNumber(results.length)} customers reviewed`}
            action={
              <button
                className="secondary-button"
                onClick={() =>
                  downloadCsv(results, "churnguard-predictions.csv")
                }
              >
                <Download size={15} /> Download CSV
              </button>
            }
          />
          <div className="table-toolbar">
            <label className="filter-control">
              <Filter size={15} />
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">All predictions</option>
                <option value="churn">Likely to churn</option>
                <option value="stay">Likely to stay</option>
              </select>
            </label>
            <label className="sort-indicator">
              <ArrowDown size={14} /> Sorted by upload order
            </label>
          </div>
          <DataTable
            columns={Object.keys(results[0]).filter(
              (column) =>
                ![
                  "positive_class",
                  "model_version",
                  "prediction_id",
                  "created_at",
                ].includes(column),
            )}
            rows={visible}
          />
        </section>
      )}
    </>
  );
}

function HistoryPage({ health }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error } = useResource(
    () =>
      api.get("/predictions/history", {
        params: { search, page, page_size: 15 },
      }),
    JSON.stringify([search, page]),
  );
  const rows = data?.rows || [];
  return (
    <section className="panel table-panel">
      <SectionHeader
        title="Recent customer checks"
        note="A record of customer checks completed in this workspace"
        action={
          <a className="secondary-button" href={exportHistoryUrl}>
            <Download size={15} /> Download activity
          </a>
        }
      />
      <div className="table-toolbar">
        <label className="table-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Find a customer by ID or outcome"
          />
        </label>
      </div>
      {loading ? (
        <LoadingLine />
      ) : error ? (
        <Notice message={error} />
      ) : rows.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer ID</th>
                <th>Customer outlook</th>
                <th>Chance of leaving</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.customer_id || "--"}</td>
                  <td>
                    <span
                      className={`outcome-tag ${row.risk === "High" ? "risk" : "safe"}`}
                    >
                      {String(row.predicted_label) ===
                      String(health?.positive_class ?? "1")
                        ? "May leave"
                        : "Likely to stay"}
                    </span>
                  </td>
                  <td>
                    {row.probability == null
                      ? "--"
                      : `${(row.probability * 100).toFixed(1)}%`}
                  </td>
                  <td>{row.risk || "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No customer checks yet"
          message="Complete a customer check or review a customer list to see your recent activity here."
        />
      )}
      <div className="pagination">
        <span>
          {fmtNumber(data?.total || 0)} customer checks ? page {page}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Next page"
            disabled={!data || page * data.page_size >= data.total}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}

function QualityPage() {
  const { data, loading, error } = useResource(
    () => api.get("/model/metrics"),
    "/model/metrics",
  );
  if (loading) return <LoadingLine />;
  if (error) return <Notice message={error} />;
  if (!data?.available)
    return (
      <section className="panel">
        <SectionHeader
          title="Prediction quality"
          note="A performance review will appear here when results are available."
        />
        <p className="evaluation-caveat">
          Please contact your workspace administrator if you need help.
        </p>
      </section>
    );

  const metrics = data.metrics || {};
  const cards = [
    [
      "Correct outlooks",
      metrics.accuracy,
      "How often the customer outlook matched what happened.",
    ],
    [
      "Customers who left identified",
      metrics.recall,
      "Share of customers who left that were highlighted for attention.",
    ],
    [
      "Useful follow-ups",
      metrics.precision,
      "When someone was highlighted, how often they left.",
    ],
  ];

  return (
    <>
      <section className="panel evaluation-banner">
        <div>
          <BarChart3 size={17} />
          <strong>Reviewed against previous customer outcomes</strong>
        </div>
        <span>{fmtNumber(metrics.test_size)} customer outcomes reviewed</span>
        {data.metadata?.evaluated_at && (
          <time>{formatDate(data.metadata.evaluated_at)}</time>
        )}
      </section>
      <div className="performance-metrics">
        {cards.map(([label, value, description]) => (
          <section className="panel performance-card" key={label}>
            <div className="metric-label">{label}</div>
            <strong>
              {value == null ? "—" : `${(value * 100).toFixed(1)}%`}
            </strong>
            <p>{description}</p>
          </section>
        ))}
      </div>
      <section className="panel">
        <SectionHeader title="How to use these results" />
        <p className="evaluation-caveat">
          These results help show how useful the customer outlook may be across
          a group of past customers. Use them to guide follow-up priorities;
          each customer’s situation is unique, and an outlook is never a
          guarantee.
        </p>
      </section>
    </>
  );
}

function Notice({ message }) {
  return (
    <div className="notice">
      <AlertCircle size={16} />
      <span>{message}</span>
    </div>
  );
}
function fmtNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}
function columnLabel(value) {
  const labels = {
    CustomerID: "Customer ID",
    Age: "Age",
    Region: "Region",
    Membership: "Membership level",
    PreferredCategory: "Favorite product category",
    PreferredPaymentMethod: "Preferred payment method",
    Frequency: "Orders in the last year",
    RecencyDays: "Days since last order",
    MonetaryValue: "Total spend",
    TotalQuantity: "Items purchased",
    AverageOrderValue: "Average order value",
    DistinctCategories: "Product categories purchased",
    MeanDiscountPercent: "Average discount used",
    TotalOrders: "Orders placed",
    DeliveredOrders: "Completed orders",
    ReturnedOrders: "Returned orders",
    CancelledOrders: "Cancelled orders",
    OrderRevenue: "Completed order sales",
    OrderAverageValue: "Average completed order value",
    DaysSinceLastOrder: "Days since most recent order",
    DistinctOrderCategories: "Product categories ordered",
    AverageOrderDiscount: "Average order discount",
    Churn: "Customer outlook",
    predicted_status: "Customer outlook",
    churn_probability: "Chance of leaving",
    risk_category: "Priority",
  };
  return (
    labels[value] ||
    String(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}
function columnKey(value) {
  return value.toLowerCase().replace(/\s+/g, "_");
}
function renderValue(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isInteger(value))
    return fmtNumber(value);
  return String(value);
}
function uniqueValues(rows, column) {
  return [
    ...new Set(rows.map((row) => row[column]).filter((value) => value != null)),
  ].sort();
}
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
function downloadCsv(rows, filename) {
  const csv = Papa.unparse(rows);
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
