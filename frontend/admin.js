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

  // Departments tab events
  const deptTabBtn = document.getElementById("departments-tab");
  const deptBtn = document.getElementById("loadDeptBtn");
  const deptDays = document.getElementById("deptDays");
  const deptSelect = document.getElementById("deptSelect");
  const deptRefreshList = document.getElementById("deptRefreshList");
  const mailDeptBtn = document.getElementById("mailDeptBtn");
  if (deptBtn)
    deptBtn.addEventListener("click", () => {
      loadDepartments();
      loadDepartmentDetails();
    });
  if (deptDays)
    deptDays.addEventListener("change", () => {
      loadDepartments();
      loadDepartmentDetails();
    });
  if (deptRefreshList)
    deptRefreshList.addEventListener("click", populateDepartmentsList);
  if (mailDeptBtn) mailDeptBtn.addEventListener("click", mailDepartment);
  if (deptTabBtn) {
    deptTabBtn.addEventListener("shown.bs.tab", () => {
      populateDepartments();
      populateDepartmentsList();
    });
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

// Departments: populate the department select from the templates mapping via catalog
async function populateDepartments() {
  const sel = document.getElementById("deptSelect");
  if (!sel) return;
  if (sel.options.length > 0) return; // avoid duplicate
  try {
    // Use /complaints/catalog to get all mapping entries, then collect unique issueType values
    const res = await apiFetch(`/complaints/catalog`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load catalog");
    const types = Array.from(
      new Set((data.catalog || []).map((x) => x.issueType))
    ).sort();
    types.push("Unmapped");
    // Pre-fill first option to select something predictable
    types.forEach((t, idx) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
    // Auto-load once
    loadDepartments();
    loadDepartmentDetails();
  } catch (e) {
    console.warn("Departments load failed:", e.message || e);
  }
}

// Sidebar list of departments with click-to-select
async function populateDepartmentsList() {
  const list = document.getElementById("deptList");
  const sel = document.getElementById("deptSelect");
  if (!list || !sel) return;
  list.innerHTML = "";
  try {
    const res = await apiFetch(`/complaints/catalog`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load catalog");
    const types = Array.from(
      new Set((data.catalog || []).map((x) => x.issueType))
    ).sort();
    if (!types.includes("Unmapped")) types.push("Unmapped");
    types.forEach((t) => {
      const a = document.createElement("button");
      a.type = "button";
      a.className = "list-group-item list-group-item-action";
      a.textContent = t;
      a.addEventListener("click", () => {
        // Select this department in the dropdown and load
        sel.value = t;
        loadDepartments();
        loadDepartmentDetails();
      });
      list.appendChild(a);
    });
  } catch (e) {
    console.warn("Departments list failed:", e.message || e);
  }
}

// Build and open a precomposed email for the selected department with real issue details
async function mailDepartment() {
  const deptSel = document.getElementById("deptSelect");
  const daysSel = document.getElementById("deptDays");
  if (!deptSel || !deptSel.value) {
    showAlert("warning", "Please select a department first.");
    return;
  }
  const department = deptSel.value;
  const days = daysSel ? parseInt(daysSel.value || "30", 10) : 30;
  try {
    const qs = new URLSearchParams({ department, days: String(days) });
    const res = await apiFetch(`/admin/department_issues?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.detail || "Failed to load department issues");
    const issues = data.issues || [];
    if (!issues.length) {
      showAlert(
        "info",
        `No issues for ${department} in the last ${days} days.`
      );
      return;
    }

    // Compose a readable plain-text body for email
    const lines = [];
    lines.push(`Department: ${department}`);
    lines.push(`Period: last ${days} days`);
    lines.push(`Total Issues: ${issues.length}`);
    lines.push("");
    for (const it of issues) {
      lines.push(
        `#${it.id} • ${it.subcategory || it.category || "Issue"} [${
          it.priority || "Priority"
        }]`
      );
      lines.push(`Status: ${it.status}`);
      if (it.description) lines.push(`Description: ${it.description}`);
      const addr = it.location?.address || "";
      const lat = it.location?.latitude;
      const lng = it.location?.longitude;
      if (addr || (lat != null && lng != null)) {
        const locParts = [];
        if (addr) locParts.push(addr);
        if (lat != null && lng != null) locParts.push(`(${lat}, ${lng})`);
        lines.push(`Location: ${locParts.join(" ")}`);
      }
      if (it.image_url) {
        // Provide absolute URL if apiBase is set
        const url = (window.apiBase || "") + it.image_url;
        lines.push(`Image: ${url}`);
      }
      if (it.reporter?.username || it.reporter?.email) {
        lines.push(
          `Reported by: ${it.reporter.username || ""} ${
            it.reporter.email ? `<${it.reporter.email}>` : ""
          }`.trim()
        );
      }
      lines.push(`Created: ${new Date(it.created_at).toLocaleString()}`);
      lines.push("");
    }

    const subjectText = `[SnapFixit] ${department} issues – last ${days} days`;
    const subject = encodeURIComponent(subjectText);
    // mailto body has length limits; truncate if very large
    let body = lines.join("\n");
    if (body.length > 10000) {
      body = body.slice(0, 10000) + "\n... (truncated)";
    }
    const encodedBody = encodeURIComponent(body);

    // 1) Try opening Gmail compose (web) in a new tab for a polished demo
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${encodedBody}`;
    let opened = false;
    try {
      const w = window.open(gmailUrl, "_blank");
      opened = !!w;
    } catch {}

    // 2) Also attempt classic mailto as a fallback (some environments block window.open)
    if (!opened) {
      const mailto = `mailto:?subject=${subject}&body=${encodedBody}`;
      try {
        window.location.href = mailto;
        opened = true;
      } catch {}
    }

    // 3) Always copy to clipboard for demo purposes so the admin can paste anywhere
    try {
      await copyToClipboard(`Subject: ${subjectText}\n\n${body}`);
      showAlert(
        "success",
        "Email content copied to clipboard. If a mail app didn't open, paste it into Gmail."
      );
    } catch {
      // If copying fails, still inform the user that content is ready in the UI
      showAlert(
        "info",
        "Couldn't access clipboard, but the email window should contain all details."
      );
    }
  } catch (e) {
    showAlert("danger", e.message || "Failed to build email");
  }
}

// Small helper to reliably copy text to clipboard with fallback
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback approach using a hidden textarea
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("execCommand failed"));
    } catch (err) {
      document.body.removeChild(ta);
      reject(err);
    }
  });
}

async function loadDepartments() {
  const daysSel = document.getElementById("deptDays");
  const deptSel = document.getElementById("deptSelect");
  const tbody = document.getElementById("deptTableBody");
  const loader = document.getElementById("deptLoading");
  const empty = document.getElementById("deptEmpty");
  if (!daysSel || !deptSel || !tbody) return;
  const days = parseInt(daysSel.value || "30", 10);
  const dept = deptSel.value;
  if (loader) loader.classList.remove("d-none");
  if (empty) empty.classList.add("d-none");
  tbody.innerHTML = "";
  try {
    const res = await apiFetch(
      `/admin/departments_summary?days=${encodeURIComponent(days)}`
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.detail || "Failed to load departments summary");
    const deptData = (data.departments || []).find((d) => d.name === dept);
    if (!deptData || !deptData.issues || deptData.issues.length === 0) {
      if (empty) empty.classList.remove("d-none");
      return;
    }
    // Update KPI cards
    const kpiT = document.getElementById("deptSumTotal");
    const kpiP = document.getElementById("deptSumPending");
    const kpiIP = document.getElementById("deptSumInProgress");
    const kpiR = document.getElementById("deptSumResolved");
    const totals = deptData.by_status || {
      pending: 0,
      in_progress: 0,
      resolved: 0,
    };
    const totalSum =
      (totals.pending || 0) +
      (totals.in_progress || 0) +
      (totals.resolved || 0);
    if (kpiT) kpiT.textContent = String(totalSum);
    if (kpiIP) kpiIP.textContent = String(totals.in_progress || 0);
    if (kpiR) kpiR.textContent = String(totals.resolved || 0);
    // Render issues sorted by total desc (already sorted)
    for (const issue of deptData.issues) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${issue.name}</td>
        <td>${issue.issue_category || ""}</td>
        <td class="text-number">${issue.counts?.pending ?? 0}</td>
        <td class="text-number">${issue.counts?.in_progress ?? 0}</td>
        <td class="text-number">${issue.counts?.resolved ?? 0}</td>
        <td class="text-number"><strong>${
          issue.counts?.total ?? 0
        }</strong></td>
      `;
      tbody.appendChild(tr);
    }
  } catch (e) {
    showAlert("danger", e.message || "Failed to load department");
  } finally {
    if (loader) loader.classList.add("d-none");
  }
}

// Detailed list for the selected department
async function loadDepartmentDetails() {
  const deptSel = document.getElementById("deptSelect");
  const daysSel = document.getElementById("deptDays");
  let tbody = document.getElementById("deptDetailsBody");
  const empty = document.getElementById("deptDetailsEmpty");
  if (!deptSel || !tbody) return;
  const department = deptSel.value;
  const days = daysSel ? parseInt(daysSel.value || "30", 10) : 30;
  // Replace tbody to reset any prior listeners
  const fresh = tbody.cloneNode(false);
  tbody.parentNode.replaceChild(fresh, tbody);
  tbody = fresh;
  if (empty) empty.classList.add("d-none");
  try {
    const qs = new URLSearchParams({ department, days: String(days) });
    const res = await apiFetch(`/admin/department_issues?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.detail || "Failed to load department issues");
    const items = data.issues || [];
    if (!items.length) {
      if (empty) empty.classList.remove("d-none");
      return;
    }
    // Load catalog for reclassification options
    let catalog = [];
    try {
      const r = await apiFetch(`/complaints/catalog`);
      const j = await r.json();
      if (r.ok) catalog = j.catalog || [];
    } catch {}
    const byDept = {};
    for (const row of catalog) {
      if (!byDept[row.issueType]) byDept[row.issueType] = new Set();
      if (row.subcategory) byDept[row.issueType].add(row.subcategory);
    }
    const deptOptions = Object.keys(byDept).sort();

    for (const it of items) {
      const tr = document.createElement("tr");
      const imgUrl = (window.apiBase || "") + (it.image_url || "");
      const addr = it.location?.address || "";
      const created = it.created_at
        ? new Date(it.created_at).toLocaleString()
        : "";
      const reporter = [
        it.reporter?.username || "",
        it.reporter?.email ? `<${it.reporter.email}>` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const deptSelHtml = [
        '<option value="" disabled selected>Department</option>',
      ]
        .concat(deptOptions.map((d) => `<option value="${d}">${d}</option>`))
        .join("");
      const subSelHtml =
        '<option value="" disabled selected>Sub-issue</option>';
      tr.innerHTML = `
        <td>${it.id}</td>
        <td>${it.subcategory || ""}</td>
        <td>${it.category || ""}</td>
        <td>${it.priority || ""}</td>
        <td><span class="badge bg-${getStatusColor(it.status)}">${(
        it.status || ""
      ).replace("_", " ")}</span></td>
        <td>${addr}</td>
        <td>${created}</td>
        <td>${reporter}</td>
        <td>${
          it.image_url
            ? `<a href="${imgUrl}" target="_blank"><img src="${imgUrl}" alt="image" style="width:56px;height:42px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'"/></a>`
            : ""
        }</td>
        <td>
          <div class="d-flex gap-2">
            <select class="form-select form-select-sm re-dept" data-id="${
              it.id
            }">${deptSelHtml}</select>
            <select class="form-select form-select-sm re-sub" data-id="${
              it.id
            }">${subSelHtml}</select>
            <button class="btn btn-sm btn-outline-primary re-save" data-id="${
              it.id
            }">Save</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
    // Dynamic populate subs when department changes
    tbody.addEventListener("change", (ev) => {
      const dsel = ev.target.closest("select.re-dept");
      if (!dsel) return;
      const id = dsel.getAttribute("data-id");
      const subs = Array.from(byDept[dsel.value] || []);
      const subSel = tbody.querySelector(`select.re-sub[data-id='${id}']`);
      if (!subSel) return;
      subSel.innerHTML =
        '<option value="" disabled selected>Sub-issue</option>' +
        subs.map((s) => `<option value="${s}">${s}</option>`).join("");
    });
    // Handle save
    tbody.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("button.re-save");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const dsel = tbody.querySelector(`select.re-dept[data-id='${id}']`);
      const ssel = tbody.querySelector(`select.re-sub[data-id='${id}']`);
      const deptVal = dsel && dsel.value;
      const subVal = ssel && ssel.value;
      if (!deptVal || !subVal) {
        showAlert("warning", "Select department and sub-issue.");
        return;
      }
      try {
        const res = await apiFetch(
          `/admin/reclassify_issue?complaint_id=${encodeURIComponent(
            id
          )}&department=${encodeURIComponent(
            deptVal
          )}&subcategory=${encodeURIComponent(subVal)}`,
          { method: "POST" }
        );
        const out = await res.json();
        if (!res.ok) throw new Error(out.detail || "Failed to reclassify");
        showAlert("success", `Reclassified #${id} to ${deptVal} / ${subVal}`);
        // Refresh both sections
        loadDepartments();
        loadDepartmentDetails();
      } catch (e) {
        showAlert("danger", e.message || "Failed to reclassify");
      }
    });
  } catch (e) {
    showAlert("danger", e.message || "Failed to load department details");
  }
}
