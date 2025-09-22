// Basic Admin UI
// - Guards page for admin users
// - Lists complaints with simple status updating

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
});
