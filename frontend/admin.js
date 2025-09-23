// Basic Admin UI
// - Guards page for admin users
// - Lists complaints with simple status updating
// - Users & Rewards management

async function ensureAdmin() {
  // If no token, bounce to login modal.
  if (!localStorage.getItem("token")) {
    const guard = document.getElementById("adminGuard");
    guard.classList.remove("d-none");
    guard.innerHTML = `<i class="bi bi-lock"></i> Please login as an admin.`;
    return false;
  }
  try {
    const res = await apiFetch("/auth/me");
    const data = await res.json();
    if (!res.ok || !data.is_admin) {
      const guard = document.getElementById("adminGuard");
      guard.classList.remove("d-none");
      guard.innerHTML = `<i class="bi bi-x-octagon"></i> Admin access required.`;
      return false;
    }
    // Store for nav usage if needed
    localStorage.setItem("is_admin", data.is_admin ? "1" : "0");
    return true;
  } catch (e) {
    console.error("Admin check failed", e);
    const guard = document.getElementById("adminGuard");
    guard.classList.remove("d-none");
    guard.textContent = "Admin check failed.";
    return false;
  }
}

async function loadAdminComplaints() {
  const status = document.getElementById("filterStatus").value;
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  const res = await apiFetch(
    `/admin/complaints${qs.toString() ? `?${qs.toString()}` : ""}`
  );
  const data = await res.json();
  if (!res.ok) {
    showAlert("danger", data.detail || "Failed to load admin complaints");
    return;
  }
  renderAdminList(data.complaints || []);
}

function renderAdminList(items) {
  const container = document.getElementById("adminList");
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<div class="text-muted">No complaints found.</div>';
    return;
  }
  items.forEach((c) => {
    const col = document.createElement("div");
    col.className = "col-12";
    col.innerHTML = `
      <div class="border rounded p-2 d-flex gap-3 align-items-start">
        <img src="${window.apiBase}${c.image_url}" alt="${
      c.category
    }" style="width:120px;height:90px;object-fit:cover;border-radius:6px" onerror="this.src='https://via.placeholder.com/120x90?text=No+Image'"/>
        <div class="flex-grow-1">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <span class="badge bg-secondary">#${c.id}</span>
              <span class="badge bg-primary ms-2">${c.category}</span>
              <span class="badge bg-${getStatusColor(
                c.status
              )} ms-2">${c.status.replace("_", " ")}</span>
            </div>
            <div class="d-flex gap-2">
              <select class="form-select form-select-sm" data-id="${c.id}">
                ${["pending", "in_progress", "resolved"]
                  .map(
                    (s) =>
                      `<option value="${s}" ${
                        s === c.status ? "selected" : ""
                      }>${s.replace("_", " ")}</option>`
                  )
                  .join("")}
              </select>
              <button class="btn btn-sm btn-success" data-action="save" data-id="${
                c.id
              }"><i class="bi bi-save"></i></button>
              <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${
                c.id
              }"><i class="bi bi-trash"></i></button>
            </div>
          </div>
          <div class="small text-muted mt-1">${
            c.description || "No description"
          }</div>
          <div class="small mt-1">
            <i class="bi bi-person-circle"></i>
            <strong>${c.user?.username || "unknown"}</strong>
            ${
              c.user?.email
                ? ` <span class="text-muted">(${c.user.email})</span>`
                : ""
            }
            ${
              typeof c.user?.points === "number"
                ? ` • <span class="badge bg-info">${c.user.points} pts</span>`
                : ""
            }
            ${
              c.user?.demo_reward
                ? ` • <span class="badge bg-secondary">${c.user.demo_reward}</span>`
                : ""
            }
          </div>
          ${
            c.location?.address
              ? `<div class="small text-muted"><i class="bi bi-geo-alt"></i> ${c.location.address}</div>`
              : ""
          }
        </div>
      </div>
    `;
    container.appendChild(col);
  });
}

async function onAdminClick(e) {
  const target = e.target.closest("button");
  if (!target) return;
  const id = target.getAttribute("data-id");
  const action = target.getAttribute("data-action");
  if (action === "save") {
    const select = document.querySelector(`select[data-id='${id}']`);
    const newStatus = select.value;
    try {
      const res = await apiFetch(
        `/admin/complaints/${id}?status=${encodeURIComponent(newStatus)}`,
        { method: "PUT" }
      );
      const data = await res.json();
      if (res.ok) {
        showAlert("success", `Updated #${id} to ${newStatus}`);
        loadAdminComplaints();
      } else {
        showAlert("danger", data.detail || "Failed to update");
      }
    } catch (e) {
      showAlert("danger", "Error updating complaint");
    }
  } else if (action === "delete") {
    if (!confirm("Permanently delete this complaint?")) return;
    try {
      const res = await apiFetch(`/complaints/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        showAlert("success", `Deleted complaint #${id}`);
        loadAdminComplaints();
      } else {
        showAlert("danger", data.detail || "Failed to delete");
      }
    } catch (e) {
      showAlert("danger", "Error deleting complaint");
    }
  }
}

// Minimal showAlert (reuse if available)
function showAlert(type, message) {
  const container = document.getElementById("alertContainer") || document.body;
  const div = document.createElement("div");
  div.className = `alert alert-${type} alert-dismissible fade show`;
  div.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function getStatusColor(status) {
  switch ((status || "").toLowerCase()) {
    case "pending":
      return "warning";
    case "in_progress":
      return "info";
    case "resolved":
      return "success";
    default:
      return "secondary";
  }
}

// Init
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await ensureAdmin();
  if (!ok) return;
  document
    .getElementById("refreshBtn")
    .addEventListener("click", loadAdminComplaints);
  document
    .getElementById("filterStatus")
    .addEventListener("change", loadAdminComplaints);
  document.getElementById("adminList").addEventListener("click", onAdminClick);
  await loadAdminComplaints();

  // Users & Rewards tab events
  const loadUsersBtn = document.getElementById("loadUsersBtn");
  const autoAssignBtn = document.getElementById("autoAssignBtn");
  if (loadUsersBtn) loadUsersBtn.addEventListener("click", loadUsersList);
  if (autoAssignBtn) autoAssignBtn.addEventListener("click", autoAssignRewards);
  const loadRewardsBtn = document.getElementById("loadRewardsBtn");
  if (loadRewardsBtn) loadRewardsBtn.addEventListener("click", loadRewardsLog);
  const rewardsTable = document.getElementById("rewardsTableBody");
  if (rewardsTable) rewardsTable.addEventListener("click", onRewardsTableClick);

  // Analytics tab events
  const loadAnalyticsBtn = document.getElementById("loadAnalyticsBtn");
  const analyticsDays = document.getElementById("analyticsDays");
  const analyticsCategory = document.getElementById("analyticsCategory");
  if (loadAnalyticsBtn)
    loadAnalyticsBtn.addEventListener("click", loadAnalytics);
  if (analyticsDays) analyticsDays.addEventListener("change", loadAnalytics);
  if (analyticsCategory)
    analyticsCategory.addEventListener("change", loadAnalytics);
  // Auto-load analytics when tab is shown
  const analyticsTabBtn = document.getElementById("analytics-tab");
  if (analyticsTabBtn) {
    analyticsTabBtn.addEventListener("shown.bs.tab", () => {
      // Populate categories on first open, then load analytics
      populateCategories().then(loadAnalytics);
    });
  }
  // If analytics tab is already active by default (unlikely), ensure categories
  if (document.querySelector("#analytics.show.active")) {
    populateCategories().then(loadAnalytics);
  }
});

async function loadUsersList() {
  const minPoints = document.getElementById("minPoints").value;
  const sort = document.getElementById("userSort").value;
  const qs = new URLSearchParams();
  if (minPoints) qs.set("min_points", minPoints);
  if (sort) qs.set("sort", sort);
  try {
    const res = await apiFetch(`/admin/users${qs.toString() ? `?${qs}` : ""}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load users");
    renderUsersTable(data.users || []);
  } catch (e) {
    showAlert("danger", e.message || "Failed to load users");
  }
}

async function loadRewardsLog() {
  const uname = document.getElementById("filterRewardsUsername").value.trim();
  const qs = new URLSearchParams();
  if (uname) qs.set("username", uname);
  try {
    const res = await apiFetch(
      `/admin/rewards${qs.toString() ? `?${qs}` : ""}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load rewards");
    renderRewardsTable(data.rewards || []);
  } catch (e) {
    showAlert("danger", e.message || "Failed to load rewards");
  }
}

function renderRewardsTable(rows) {
  const tbody = document.getElementById("rewardsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-muted">No rewards found.</td></tr>`;
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.username}</td>
      <td>${r.label}</td>
      <td>${r.description || ""}</td>
      <td>${typeof r.points === "number" ? r.points : ""}</td>
      <td>${r.awarded_by || ""}</td>
      <td>${new Date(r.created_at).toLocaleString()}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger" data-action="delete-reward" data-id="${
          r.id
        }"><i class="bi bi-trash"></i></button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function onRewardsTableClick(e) {
  const btn = e.target.closest("button[data-action='delete-reward']");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  if (
    !confirm(
      `Delete reward #${id}? This will also reverse any points awarded by it.`
    )
  )
    return;
  try {
    const res = await apiFetch(`/admin/rewards/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to delete reward");
    showAlert("success", `Deleted reward #${id}`);
    loadRewardsLog();
  } catch (e) {
    showAlert("danger", e.message || "Failed to delete reward");
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No users found.</td></tr>`;
    return;
  }
  users.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.email || ""}</td>
      <td><span class="badge bg-info">${u.points}</span></td>
      <td>
        <input class="form-control form-control-sm" value="${
          u.demo_reward || ""
        }" data-username="${u.username}" data-field="reward" />
      </td>
      <td>
        <button class="btn btn-sm btn-primary" data-action="assign-reward" data-username="${
          u.username
        }">Assign</button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.addEventListener("click", onUsersTableClick);
}

async function onUsersTableClick(e) {
  const btn = e.target.closest("button[data-action='assign-reward']");
  if (!btn) return;
  const username = btn.getAttribute("data-username");
  const input = document.querySelector(
    `input[data-username='${username}'][data-field='reward']`
  );
  const reward = input ? input.value.trim() : "";
  if (!reward) {
    showAlert("warning", "Please provide a reward label.");
    return;
  }
  try {
    const res = await apiFetch(
      `/admin/assign-demo-reward?username=${encodeURIComponent(
        username
      )}&reward=${encodeURIComponent(reward)}`,
      { method: "POST" }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to assign reward");
    showAlert("success", `Assigned '${reward}' to ${username}`);
  } catch (e) {
    showAlert("danger", e.message || "Failed to assign reward");
  }
}

async function autoAssignRewards() {
  const threshold = parseInt(
    document.getElementById("rewardThreshold").value || "200",
    10
  );
  try {
    const res = await apiFetch(
      `/admin/assign-demo-rewards-auto?threshold=${threshold}`,
      { method: "POST" }
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.detail || "Failed to auto-assign rewards");
    showAlert(
      "success",
      `Updated ${data.updated_count} users based on threshold ${threshold}`
    );
    // Reload list to reflect updates
    loadUsersList();
  } catch (e) {
    showAlert("danger", e.message || "Auto-assign failed");
  }
}

// Analytics: Chart.js line chart for status time series
let statusChart;
let statusPie;
async function loadAnalytics() {
  const daysSel = document.getElementById("analyticsDays");
  const days = daysSel ? parseInt(daysSel.value || "30", 10) : 30;
  const categorySel = document.getElementById("analyticsCategory");
  const category = categorySel ? categorySel.value : "";
  const loader = document.getElementById("analyticsLoading");
  const empty = document.getElementById("analyticsEmpty");
  if (loader) loader.classList.remove("d-none");
  if (empty) empty.classList.add("d-none");
  try {
    const qs = new URLSearchParams({ days: String(days) });
    if (category) qs.set("category", category);
    const res = await apiFetch(`/admin/timeseries?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load analytics");
    const s = data.series || {};
    const ctx = document.getElementById("statusChart");
    if (!ctx) return;
    const labels = s.dates || [];
    const dsPending = s.pending || [];
    const dsInProgress = s.in_progress || [];
    const dsResolved = s.resolved || [];

    // Empty state if everything is zero
    const totalSum = [...dsPending, ...dsInProgress, ...dsResolved].reduce(
      (a, b) => a + (b || 0),
      0
    );
    if (empty) empty.classList.toggle("d-none", totalSum !== 0);

    // Build or update chart
    const cfg = {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Pending",
            data: dsPending,
            borderColor: "#f0ad4e",
            backgroundColor: "rgba(240, 173, 78, 0.15)",
            tension: 0.25,
            fill: true,
          },
          {
            label: "In Progress",
            data: dsInProgress,
            borderColor: "#17a2b8",
            backgroundColor: "rgba(23, 162, 184, 0.15)",
            tension: 0.25,
            fill: true,
          },
          {
            label: "Resolved",
            data: dsResolved,
            borderColor: "#28a745",
            backgroundColor: "rgba(40, 167, 69, 0.15)",
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
          },
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: { mode: "index", intersect: false },
        },
      },
    };
    if (statusChart) {
      statusChart.data = cfg.data;
      statusChart.options = cfg.options;
      statusChart.update();
    } else {
      statusChart = new Chart(ctx, cfg);
    }

    // Fetch summary statistics for pie and summary cards
    const statsQ = new URLSearchParams({ days: String(days) });
    if (category) statsQ.set("category", category);
    const res2 = await apiFetch(`/admin/statistics?${statsQ.toString()}`);
    const stats = await res2.json();
    if (!res2.ok) throw new Error(stats.detail || "Failed to load statistics");
    const byStatus = stats.statistics?.by_status || {};
    const totals = {
      pending: byStatus["pending"] || 0,
      in_progress: byStatus["in_progress"] || 0,
      resolved: byStatus["resolved"] || 0,
    };
    const sumTotal = totals.pending + totals.in_progress + totals.resolved || 0;

    // Update summary cards
    const elTotal = document.getElementById("sumTotal");
    const elP = document.getElementById("sumPending");
    const elIP = document.getElementById("sumInProgress");
    const elR = document.getElementById("sumResolved");
    if (elTotal) elTotal.textContent = String(sumTotal);
    if (elP) elP.textContent = String(totals.pending);
    if (elIP) elIP.textContent = String(totals.in_progress);
    if (elR) elR.textContent = String(totals.resolved);

    // Pie chart
    const pieCtx = document.getElementById("statusPie");
    if (pieCtx) {
      const pieCfg = {
        type: "doughnut",
        data: {
          labels: ["Pending", "In Progress", "Resolved"],
          datasets: [
            {
              data: [totals.pending, totals.in_progress, totals.resolved],
              backgroundColor: ["#f0ad4e", "#17a2b8", "#28a745"],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      };
      if (statusPie) {
        statusPie.data = pieCfg.data;
        statusPie.options = pieCfg.options;
        statusPie.update();
      } else {
        statusPie = new Chart(pieCtx, pieCfg);
      }
    }
  } catch (e) {
    showAlert("danger", e.message || "Failed to load analytics");
  } finally {
    if (loader) loader.classList.add("d-none");
  }
}

// Populate category filter using real data
async function populateCategories() {
  const sel = document.getElementById("analyticsCategory");
  if (!sel) return;
  // Avoid reloading if already has categories beyond the default
  if (sel.options.length > 1) return;
  try {
    // Use /admin/statistics to fetch by_category distribution for the default window
    const res = await apiFetch(`/admin/statistics?days=90`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load categories");
    const byCat = data.statistics?.by_category || {};
    const cats = Object.keys(byCat).filter(Boolean).sort();
    for (const c of cats) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = `${c} (${byCat[c]})`;
      sel.appendChild(opt);
    }
  } catch (e) {
    // Non-fatal error
    console.warn("Category load failed:", e.message || e);
  }
}
