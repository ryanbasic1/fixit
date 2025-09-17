// My Reports specific functionality
// Handles loading user's personal reports, stats, and filtering

let allMyReports = []; // Store all reports for filtering

// Initialize My Reports page functionality
document.addEventListener("DOMContentLoaded", function () {
  // Check if this is a first-time user
  const hasSeenWelcome = localStorage.getItem("hasSeenWelcome");
  if (!hasSeenWelcome) {
    window.location.href = "welcome.html";
    return;
  }

  const token = localStorage.getItem("token");

  if (!token) {
    showNotLoggedInState();
    return;
  }

  // Load user's reports and stats
  loadMyReports();
  loadCategoriesForFilter();

  // Set up filter event listeners
  document
    .getElementById("statusFilter")
    .addEventListener("change", filterMyReports);
  document
    .getElementById("categoryFilterMy")
    .addEventListener("change", filterMyReports);
});

function showNotLoggedInState() {
  document.getElementById("complaintsList").innerHTML = `
    <div class="alert alert-warning">
      <i class="bi bi-exclamation-triangle"></i> Please log in to view your reports.
      <div class="mt-2">
        <button class="btn btn-primary btn-sm" onclick="showLoginModal()">Login</button>
        <button class="btn btn-outline-primary btn-sm ms-2" onclick="showRegisterModal()">Register</button>
      </div>
    </div>
  `;

  // Reset stats
  [
    "myTotalReports",
    "myPendingReports",
    "myInProgressReports",
    "myResolvedReports",
  ].forEach((id) => {
    document.getElementById(id).textContent = "0";
  });
}

async function loadMyReports() {
  const token = localStorage.getItem("token");

  if (!token) {
    showNotLoggedInState();
    return;
  }

  try {
    const response = await fetch("http://localhost:8000/complaints/my", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    allMyReports = data.complaints || [];

    displayMyReports(allMyReports);
    updateMyStats(allMyReports);
  } catch (error) {
    console.error("Error loading my reports:", error);
    document.getElementById("complaintsList").innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-circle"></i> Error loading your reports. Please try again.
        <br><small>Error: ${error.message}</small>
      </div>
    `;
  }
}

function displayMyReports(reports) {
  const container = document.getElementById("complaintsList");
  const emptyState = document.getElementById("emptyState");

  if (!reports || reports.length === 0) {
    container.innerHTML = "";
    emptyState.classList.remove("d-none");
    return;
  }

  emptyState.classList.add("d-none");
  container.innerHTML = "";

  reports.forEach((complaint) => {
    const reportCard = `
      <div class="complaint-card">
        <div class="complaint-metadata mb-2">
          <div>
            <span class="badge bg-primary category-badge">
              ${complaint.category}
            </span>
            <span class="badge bg-${getStatusColor(complaint.status)} ms-2">
              ${complaint.status.replace("_", " ")}
            </span>
          </div>
          <span class="badge priority-${complaint.priority.toLowerCase()}">
            ${complaint.priority} Priority
          </span>
        </div>
        
        <img 
          src="http://localhost:8000${complaint.image_url}" 
          alt="${complaint.category}" 
          class="preview-image"
          onerror="this.src='https://via.placeholder.com/400x300?text=Image+Unavailable'"
        >
        
        <div class="complaint-description">
          ${complaint.description || "No description provided"}
        </div>
        
        <div class="complaint-metadata mt-3">
          <div class="text-muted small">
            <i class="bi bi-calendar"></i> 
            Reported: ${new Date(complaint.created_at).toLocaleDateString()}
            ${
              complaint.location
                ? `
              <span class="ms-3">
                <i class="bi bi-geo-alt"></i>
                ${complaint.location.address || "Location recorded"}
              </span>
            `
                : ""
            }
          </div>
          <div class="text-muted small mt-1">
            <i class="bi bi-hand-thumbs-up"></i> Votes: ${
              complaint.vote_count || 0
            }
            ${
              complaint.ai_metadata?.ai_confidence
                ? `
              <span class="ms-3">
                <i class="bi bi-robot"></i> AI Confidence: ${(
                  complaint.ai_metadata.ai_confidence * 100
                ).toFixed(1)}%
              </span>
            `
                : ""
            }
          </div>
        </div>
      </div>
    `;
    container.innerHTML += reportCard;
  });
}

function updateMyStats(reports) {
  const total = reports.length;
  const pending = reports.filter((r) => r.status === "pending").length;
  const inProgress = reports.filter((r) => r.status === "in_progress").length;
  const resolved = reports.filter((r) => r.status === "resolved").length;

  document.getElementById("myTotalReports").textContent = total;
  document.getElementById("myPendingReports").textContent = pending;
  document.getElementById("myInProgressReports").textContent = inProgress;
  document.getElementById("myResolvedReports").textContent = resolved;
}

function filterMyReports() {
  const statusFilter = document.getElementById("statusFilter").value;
  const categoryFilter = document.getElementById("categoryFilterMy").value;

  let filteredReports = [...allMyReports];

  if (statusFilter) {
    filteredReports = filteredReports.filter((r) => r.status === statusFilter);
  }

  if (categoryFilter) {
    filteredReports = filteredReports.filter(
      (r) => r.category === categoryFilter
    );
  }

  displayMyReports(filteredReports);
}

async function loadCategoriesForFilter() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const response = await fetch(
      "http://localhost:8000/complaints/categories",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      }
    );

    if (response.ok) {
      const data = await response.json();
      const select = document.getElementById("categoryFilterMy");

      data.categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error("Error loading categories:", error);
  }
}

function getStatusColor(status) {
  switch (status.toLowerCase()) {
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

// Show alert utility function
function showAlert(type, message) {
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;

  let icon = "bi-info-circle";
  switch (type) {
    case "success":
      icon = "bi-check-circle";
      break;
    case "danger":
      icon = "bi-exclamation-circle";
      break;
    case "warning":
      icon = "bi-exclamation-triangle";
      break;
  }

  alertDiv.innerHTML = `
    <i class="bi ${icon}"></i> ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;

  document.getElementById("alertContainer").appendChild(alertDiv);
  setTimeout(() => alertDiv.remove(), 5000);
}
