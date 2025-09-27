// Worker Dashboard JavaScript

let workerProfile = null;
let currentAssignments = [];

// Initialize worker dashboard
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await ensureWorker();
  if (!ok) return;

  await Promise.all([
    loadWorkerProfile(),
    loadAssignments(),
    loadDashboardStats(),
  ]);
});

// Check if user is a worker
async function ensureWorker() {
  if (!localStorage.getItem("token")) {
    const guard = document.getElementById("workerGuard");
    guard.classList.remove("d-none");
    guard.innerHTML = `<div class="alert alert-warning text-center">
      <h4><i class="bi bi-exclamation-triangle"></i> Authentication Required</h4>
      <p>Please login as a worker to access this page.</p>
      <a href="index.html" class="btn btn-primary">Return to Home</a>
    </div>`;
    return false;
  }

  try {
    const res = await apiFetch("/auth/me");
    const data = await res.json();
    if (!res.ok || !data.is_worker) {
      const guard = document.getElementById("workerGuard");
      guard.classList.remove("d-none");
      guard.innerHTML = `<div class="alert alert-danger text-center">
        <h4><i class="bi bi-x-octagon"></i> Worker Access Required</h4>
        <p>This page is only accessible to authorized workers.</p>
        <a href="index.html" class="btn btn-primary">Return to Home</a>
      </div>`;
      return false;
    }

    // Update worker name in navbar
    const workerNameEl = document.getElementById("workerName");
    if (workerNameEl) {
      workerNameEl.textContent = data.username;
    }

    return true;
  } catch (e) {
    console.error("Worker check failed", e);
    const guard = document.getElementById("workerGuard");
    guard.classList.remove("d-none");
    guard.innerHTML = `<div class="alert alert-danger text-center">
      <h4><i class="bi bi-exclamation-triangle"></i> Authentication Failed</h4>
      <p>Unable to verify worker credentials.</p>
      <a href="index.html" class="btn btn-primary">Return to Home</a>
    </div>`;
    return false;
  }
}

// Load worker profile information
async function loadWorkerProfile() {
  try {
    const res = await apiFetch("/worker/profile");
    const data = await res.json();

    if (res.ok) {
      workerProfile = data.worker;
      updateProfileDisplay();
    } else {
      showAlert("danger", data.detail || "Failed to load worker profile");
    }
  } catch (error) {
    console.error("Profile load error:", error);
    showAlert("danger", "Failed to load worker profile");
  }
}

// Update profile display in UI
function updateProfileDisplay() {
  if (!workerProfile) return;

  // Update all worker name elements
  const workerNameElements = document.querySelectorAll(
    "#workerName, #workerNameHeader"
  );
  workerNameElements.forEach((el) => {
    if (el) el.textContent = workerProfile.name;
  });

  const workerDepartmentEl = document.getElementById("workerDepartment");
  if (workerDepartmentEl) {
    workerDepartmentEl.textContent = workerProfile.department || "General";
  }

  const ratingEl = document.getElementById("workerRating");
  if (ratingEl) {
    ratingEl.textContent = workerProfile.rating.toFixed(1);
  }

  const completedCountEl = document.getElementById("completedCount");
  if (completedCountEl) {
    completedCountEl.textContent = workerProfile.completed_jobs || 0;
  }
}

// Load dashboard statistics
async function loadDashboardStats() {
  try {
    const res = await apiFetch("/worker/assignments");
    const data = await res.json();

    if (res.ok) {
      const assignments = data.assignments || [];

      // Count by status
      const stats = {
        assigned: 0,
        in_progress: 0,
        completed: 0,
      };

      assignments.forEach((assignment) => {
        if (stats.hasOwnProperty(assignment.status)) {
          stats[assignment.status]++;
        }
      });

      // Update stat cards
      document.getElementById("assignedCount").textContent = stats.assigned;
      document.getElementById("inProgressCount").textContent =
        stats.in_progress;

      // Get completed count from profile
      if (workerProfile) {
        document.getElementById("completedCount").textContent =
          workerProfile.completed_jobs || 0;
      }
    }
  } catch (error) {
    console.error("Stats load error:", error);
  }
}

// Load work assignments
async function loadAssignments(status = null) {
  const loading = document.getElementById("assignmentsLoading");
  const empty = document.getElementById("assignmentsEmpty");
  const list = document.getElementById("assignmentsList");

  loading.classList.remove("d-none");
  empty.classList.add("d-none");
  list.innerHTML = "";

  try {
    const url = status
      ? `/worker/assignments?status=${status}`
      : "/worker/assignments";
    const res = await apiFetch(url);
    const data = await res.json();

    if (res.ok) {
      currentAssignments = data.assignments || [];
      renderAssignments(currentAssignments);
    } else {
      showAlert("danger", data.detail || "Failed to load assignments");
    }
  } catch (error) {
    console.error("Assignments load error:", error);
    showAlert("danger", "Failed to load assignments");
  } finally {
    loading.classList.add("d-none");
  }
}

// Render assignments in the UI
function renderAssignments(assignments) {
  const list = document.getElementById("assignmentsList");
  const empty = document.getElementById("assignmentsEmpty");

  if (!assignments.length) {
    empty.classList.remove("d-none");
    return;
  }

  empty.classList.add("d-none");
  list.innerHTML = "";

  assignments.forEach((assignment) => {
    const card = createAssignmentCard(assignment);
    list.appendChild(card);
  });
}

// Create assignment card element
function createAssignmentCard(assignment) {
  const col = document.createElement("div");
  col.className = "mb-3";

  const priorityClass = getPriorityClass(assignment.priority);
  const statusClass = getStatusClass(assignment.status);
  const statusIcon = getStatusIcon(assignment.status);
  const isAssigned = assignment.work_order_id;

  col.innerHTML = `
    <div class="task-card ${
      assignment.priority
        ? assignment.priority.toLowerCase() + "-priority"
        : "medium-priority"
    }">
      <div class="row align-items-center">
        <div class="col-md-8">
          <!-- Header -->
          <div class="d-flex justify-content-between align-items-start mb-3">
            <div class="d-flex flex-wrap gap-2">
              <span class="badge-modern ${statusClass}" style="background: ${getStatusColor(
    assignment.status
  )};">
                <i class="${statusIcon}"></i> ${assignment.status
    .replace("_", " ")
    .toUpperCase()}
              </span>
              <span class="badge-modern" style="background: var(--gray-200); color: var(--gray-700);">
                ${assignment.priority || "Medium"} Priority
              </span>
              ${
                !isAssigned
                  ? '<span class="badge-modern" style="background: var(--info-color); color: white;"><i class="bi bi-exclamation-circle"></i> Available</span>'
                  : ""
              }
            </div>
            <small class="text-muted fw-bold">#${
              assignment.complaint.id
            }</small>
          </div>
          
          <!-- Title and Description -->
          <div class="d-flex align-items-center mb-2">
            <i class="bi bi-tools me-2" style="color: var(--primary-color); font-size: 1.2rem;"></i>
            <h5 class="mb-0 fw-bold" style="color: var(--gray-800);">
              ${
                assignment.complaint.subcategory ||
                assignment.complaint.category
              }
            </h5>
          </div>
          
          <p class="mb-3" style="color: var(--gray-600); line-height: 1.6;">
            ${truncateText(assignment.complaint.description, 120)}
          </p>
          
          <!-- Meta Information -->
          <div class="d-flex flex-wrap gap-3 mb-3" style="font-size: 0.875rem;">
            ${
              assignment.complaint.location.address
                ? `
              <div class="d-flex align-items-center" style="color: var(--gray-500);">
                <i class="bi bi-geo-alt me-1" style="color: var(--danger-color);"></i>
                <span>${truncateText(
                  assignment.complaint.location.address,
                  40
                )}</span>
              </div>
            `
                : ""
            }
            
            <div class="d-flex align-items-center" style="color: var(--gray-500);">
              <i class="bi bi-person me-1" style="color: var(--info-color);"></i>
              <span>${assignment.reporter.username}</span>
            </div>
            
            <div class="d-flex align-items-center" style="color: var(--gray-500);">
              <i class="bi bi-clock me-1"></i>
              <span>${new Date(
                assignment.assigned_at || assignment.complaint.created_at
              ).toLocaleDateString()}</span>
            </div>
          </div>

          ${
            assignment.notes
              ? `
            <div class="alert alert-info py-2 mb-0" style="background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 8px;">
              <i class="bi bi-info-circle me-1"></i> 
              <strong>Notes:</strong> ${assignment.notes}
            </div>
          `
              : ""
          }
        </div>
        
        <div class="col-md-4">
          <div class="text-center">
            <!-- Image -->
            ${
              assignment.complaint.image_url
                ? `
              <div class="mb-3">
                <img src="${window.apiBase}${assignment.complaint.image_url}" 
                     class="task-image" 
                     alt="Issue photo"
                     onclick="showImageModal('${window.apiBase}${assignment.complaint.image_url}')" />
              </div>
            `
                : `
              <div class="d-flex align-items-center justify-content-center mb-3" 
                   style="height: 120px; background: var(--gray-100); border: 2px dashed var(--gray-300); border-radius: 8px;">
                <div class="text-center" style="color: var(--gray-400);">
                  <i class="bi bi-image" style="font-size: 2rem;"></i>
                  <div class="small mt-1">No image</div>
                </div>
              </div>
            `
            }
            
            <!-- Action Buttons -->
            <div class="d-grid gap-2">
              ${
                isAssigned
                  ? `
                <button class="btn btn-primary-modern btn-modern" onclick="openUpdateModal(${assignment.work_order_id})">
                  <i class="bi bi-pencil me-2"></i>Update Progress
                </button>
              `
                  : `
                <button class="btn btn-success-modern btn-modern" onclick="claimAssignment(${assignment.complaint.id})">
                  <i class="bi bi-hand-thumbs-up me-2"></i>Claim Task
                </button>
              `
              }
              
              ${
                assignment.complaint.location.latitude &&
                assignment.complaint.location.longitude
                  ? `
                <button class="btn btn-outline-modern btn-modern" onclick="openMapLocation(${assignment.complaint.location.latitude}, ${assignment.complaint.location.longitude})">
                  <i class="bi bi-map me-2"></i>Navigate
                </button>
              `
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
          </div>
        </div>
      </div>
    </div>
  `;

  return col;
}

// Helper function to truncate text
function truncateText(text, maxLength) {
  if (!text) return "";
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
}

// Show image in modal
function showImageModal(imageSrc) {
  const modal = document.createElement("div");
  modal.className = "modal fade";
  modal.innerHTML = `
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Issue Photo</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body text-center">
          <img src="${imageSrc}" class="img-fluid rounded" alt="Issue photo" />
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
  modal.addEventListener("hidden.bs.modal", () => modal.remove());
}

// Claim an unassigned task
async function claimAssignment(complaintId) {
  try {
    const res = await apiFetch(`/worker/claim/${complaintId}`, {
      method: "POST",
    });

    const data = await res.json();

    if (res.ok) {
      showAlert("success", "Task claimed successfully!");
      await Promise.all([loadAssignments(), loadDashboardStats()]);
    } else {
      showAlert("danger", data.detail || "Failed to claim task");
    }
  } catch (error) {
    console.error("Claim error:", error);
    showAlert("danger", "Failed to claim task");
  }
}

// Get priority CSS class
function getPriorityClass(priority) {
  switch ((priority || "").toLowerCase()) {
    case "critical":
      return "border-danger";
    case "high":
      return "border-warning";
    case "medium":
      return "border-info";
    case "low":
      return "border-success";
    default:
      return "border-secondary";
  }
}

// Get status CSS class
function getStatusClass(status) {
  return "text-white";
}

// Get status color
function getStatusColor(status) {
  switch (status) {
    case "available":
      return "var(--primary-color)";
    case "assigned":
      return "var(--warning-color)";
    case "in_progress":
      return "var(--info-color)";
    case "completed":
      return "var(--success-color)";
    default:
      return "var(--gray-500)";
  }
}

// Get status icon
function getStatusIcon(status) {
  switch (status) {
    case "available":
      return "bi-exclamation-circle";
    case "assigned":
      return "bi-clipboard-check";
    case "in_progress":
      return "bi-gear";
    case "completed":
      return "bi-check-circle";
    default:
      return "bi-question-circle";
  }
}

// Open update modal for a work order
function openUpdateModal(workOrderId) {
  const assignment = currentAssignments.find(
    (a) => a.work_order_id === workOrderId
  );
  if (!assignment) return;

  document.getElementById("updateWorkOrderId").value = workOrderId;
  document.getElementById("updateStatus").value = assignment.status;
  document.getElementById("updateDescription").value = "";
  document.getElementById("updatePhoto").value = "";
  document.getElementById("updateLat").value = "";
  document.getElementById("updateLng").value = "";
  document.getElementById("updateMessage").innerHTML = "";

  // Pre-fill location if available
  if (
    assignment.complaint.location.latitude &&
    assignment.complaint.location.longitude
  ) {
    document.getElementById("updateLat").value =
      assignment.complaint.location.latitude;
    document.getElementById("updateLng").value =
      assignment.complaint.location.longitude;
  }

  const modal = new bootstrap.Modal(document.getElementById("updateModal"));
  modal.show();
}

// Submit work update
async function submitUpdate() {
  const workOrderId = document.getElementById("updateWorkOrderId").value;
  const status = document.getElementById("updateStatus").value;
  const description = document.getElementById("updateDescription").value;
  const photoFile = document.getElementById("updatePhoto").files[0];
  const lat = document.getElementById("updateLat").value;
  const lng = document.getElementById("updateLng").value;

  if (!status) {
    showUpdateMessage("danger", "Please select a status");
    return;
  }

  const formData = new FormData();
  formData.append("status", status);
  formData.append("description", description || "");
  if (photoFile) {
    formData.append("photo", photoFile);
  }
  if (lat) {
    formData.append("location_lat", parseFloat(lat));
  }
  if (lng) {
    formData.append("location_lng", parseFloat(lng));
  }

  try {
    const res = await apiFetch(`/worker/update/${workOrderId}`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (res.ok) {
      showUpdateMessage("success", "Work progress updated successfully!");

      // Refresh assignments and stats
      setTimeout(async () => {
        await Promise.all([loadAssignments(), loadDashboardStats()]);

        const modal = bootstrap.Modal.getInstance(
          document.getElementById("updateModal")
        );
        modal.hide();
      }, 1500);
    } else {
      showUpdateMessage(
        "danger",
        data.detail || "Failed to update work progress"
      );
    }
  } catch (error) {
    console.error("Update error:", error);
    showUpdateMessage("danger", "Failed to update work progress");
  }
}

// Show message in update modal
function showUpdateMessage(type, message) {
  const container = document.getElementById("updateMessage");
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

// Get current location
function getCurrentLocation() {
  if (!navigator.geolocation) {
    showUpdateMessage(
      "warning",
      "Geolocation is not supported by this browser"
    );
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById("updateLat").value = position.coords.latitude;
      document.getElementById("updateLng").value = position.coords.longitude;
      showUpdateMessage("success", "Location updated successfully");
    },
    (error) => {
      console.error("Geolocation error:", error);
      showUpdateMessage("warning", "Unable to get current location");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

// Update worker location
async function updateLocation() {
  if (!navigator.geolocation) {
    showAlert("warning", "Geolocation is not supported by this browser");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const res = await apiFetch("/worker/location", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        });

        const data = await res.json();

        if (res.ok) {
          showAlert("success", "Location updated successfully");
        } else {
          showAlert("danger", data.detail || "Failed to update location");
        }
      } catch (error) {
        console.error("Location update error:", error);
        showAlert("danger", "Failed to update location");
      }
    },
    (error) => {
      console.error("Geolocation error:", error);
      showAlert("warning", "Unable to get current location");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

// Load work history
async function loadHistory() {
  try {
    const res = await apiFetch("/worker/history");
    const data = await res.json();

    if (res.ok) {
      displayHistory(data.history, data.total_completed);
    } else {
      showAlert("danger", data.detail || "Failed to load work history");
    }
  } catch (error) {
    console.error("History load error:", error);
    showAlert("danger", "Failed to load work history");
  }
}

// Display work history
function displayHistory(history, totalCompleted) {
  const list = document.getElementById("assignmentsList");
  const empty = document.getElementById("assignmentsEmpty");

  if (!history.length) {
    empty.classList.remove("d-none");
    empty.innerHTML = `
      <i class="bi bi-inbox fs-1"></i>
      <p class="mt-2">No completed work found</p>
    `;
    return;
  }

  empty.classList.add("d-none");
  list.innerHTML = `
    <div class="col-12 mb-3">
      <div class="alert alert-info">
        <i class="bi bi-info-circle"></i> 
        Total Completed Jobs: <strong>${totalCompleted}</strong>
      </div>
    </div>
  `;

  history.forEach((item) => {
    const col = document.createElement("div");
    col.className = "col-lg-6 mb-3";

    col.innerHTML = `
      <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="badge bg-success">
            <i class="bi bi-check-circle"></i> COMPLETED
          </span>
          <small class="text-muted">#${item.complaint.id}</small>
        </div>
        <div class="card-body">
          <h6 class="card-title">${
            item.complaint.subcategory || item.complaint.category
          }</h6>
          <p class="card-text text-muted small mb-2">${
            item.complaint.description
          }</p>
          
          ${
            item.complaint.address
              ? `
            <p class="card-text small mb-2">
              <i class="bi bi-geo-alt text-primary"></i> 
              ${item.complaint.address}
            </p>
          `
              : ""
          }
          
          <p class="card-text small text-success">
            <i class="bi bi-check-circle"></i> 
            Completed: ${new Date(item.completed_at).toLocaleString()}
          </p>
        </div>
      </div>
    `;

    list.appendChild(col);
  });
}

// Open map location in new tab
function openMapLocation(lat, lng) {
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  window.open(url, "_blank");
}

// Filter assignments by status using tabs
function filterByStatus(status) {
  // Update active tab
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.classList.remove("active");
    if (tab.getAttribute("data-status") === status) {
      tab.classList.add("active");
    }
  });

  // Load assignments with filter
  loadAssignments(status);
}

// Filter assignments by status (legacy function for compatibility)
function filterAssignments() {
  const statusFilter = document.getElementById("statusFilter");
  if (statusFilter) {
    loadAssignments(statusFilter.value);
  }
}

// Show alert message
function showAlert(type, message) {
  const container = document.getElementById("alertContainer");
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  container.appendChild(alertDiv);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (alertDiv.parentNode) {
      alertDiv.remove();
    }
  }, 5000);
}
