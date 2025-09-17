// Community dashboard specific functionality
// Handles public complaints loading, voting, and filtering

// Initialize Community page functionality
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

  // Load public complaints and categories if logged in
  loadPublicComplaints();
  loadCategories();

  // Set up filter event listeners
  setupFilters();
});

function showNotLoggedInState() {
  document.getElementById("publicComplaintsList").innerHTML = `
    <div class="alert alert-info">
      <i class="bi bi-info-circle"></i> Please log in to vote and interact with community reports.
      <div class="mt-2">
        <button class="btn btn-primary btn-sm" onclick="showLoginModal()">Login</button>
        <button class="btn btn-outline-primary btn-sm ms-2" onclick="showRegisterModal()">Register</button>
      </div>
    </div>
  `;
}

function setupFilters() {
  // Dashboard filter buttons
  document.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document
        .querySelectorAll("[data-sort]")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      loadPublicComplaints();
    });
  });

  // Dropdown filters
  document
    .getElementById("categoryFilter")
    .addEventListener("change", loadPublicComplaints);
  document
    .getElementById("timeFilter")
    .addEventListener("change", loadPublicComplaints);
}

// Load unique categories for filter
async function loadCategories() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const response = await fetch(
      "http://localhost:8000/complaints/categories",
      {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      }
    );

    const data = await response.json();
    if (response.ok) {
      const select = document.getElementById("categoryFilter");
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

async function loadPublicComplaints() {
  const token = localStorage.getItem("token");
  if (!token) {
    showNotLoggedInState();
    return;
  }

  const sortBtn = document.querySelector("[data-sort].active");
  const sortBy = sortBtn ? sortBtn.dataset.sort : "latest";
  const category = document.getElementById("categoryFilter").value;
  const days = document.getElementById("timeFilter").value;

  try {
    const response = await fetch(
      `http://localhost:8000/complaints/public?sort_by=${sortBy}&category=${category}&days=${days}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      }
    );

    const data = await response.json();
    if (response.ok) {
      displayPublicComplaints(data.complaints);
      updateCommunityStats(data.complaints);
    } else {
      showAlert("danger", "Failed to load community reports");
    }
  } catch (error) {
    console.error("Error loading public complaints:", error);
    showAlert("danger", "Error loading community reports");
  }
}

function displayPublicComplaints(complaints) {
  const container = document.getElementById("publicComplaintsList");

  if (!complaints.length) {
    container.innerHTML = `
      <div class="alert alert-info">
        <i class="bi bi-info-circle"></i> No reports found in the community dashboard.
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  complaints.forEach((complaint) => {
    container.innerHTML += `
      <div class="complaint-card">
        <div class="complaint-metadata mb-2">
          <div>
            <span class="badge bg-primary category-badge">
              ${complaint.category}
            </span>
            <span class="badge bg-${getStatusColor(complaint.status)} ms-2">
              ${complaint.status.replace("_", " ")}
            </span>
            <span class="complaint-author ms-2">
              <i class="bi bi-person"></i> ${complaint.user.username}
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
          <div class="d-flex justify-content-between align-items-center">
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
            <button 
              onclick="voteComplaint(${complaint.id})"
              class="vote-btn ${complaint.has_voted ? "voted" : ""}"
              data-complaint-id="${complaint.id}"
            >
              <i class="bi ${
                complaint.has_voted
                  ? "bi-hand-thumbs-up-fill"
                  : "bi-hand-thumbs-up"
              }"></i>
              <span class="vote-count">${complaint.vote_count}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  });
}

function updateCommunityStats(complaints) {
  const totalIssues = complaints.length;
  const resolvedIssues = complaints.filter(
    (c) => c.status === "resolved"
  ).length;
  const pendingIssues = complaints.filter((c) => c.status === "pending").length;
  const inProgressIssues = complaints.filter(
    (c) => c.status === "in_progress"
  ).length;

  // Update stats if elements exist
  const totalElement = document.getElementById("totalIssues");
  if (totalElement) totalElement.textContent = totalIssues;

  const resolvedElement = document.getElementById("resolvedIssues");
  if (resolvedElement) resolvedElement.textContent = resolvedIssues;

  const pendingElement = document.getElementById("pendingIssues");
  if (pendingElement) pendingElement.textContent = pendingIssues;

  const inProgressElement = document.getElementById("inProgressIssues");
  if (inProgressElement) inProgressElement.textContent = inProgressIssues;
}

async function voteComplaint(complaintId) {
  const token = localStorage.getItem("token");
  if (!token) {
    showLoginModal();
    return;
  }

  try {
    const response = await fetch(
      `http://localhost:8000/complaints/vote/${complaintId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      }
    );

    const data = await response.json();
    if (response.ok) {
      const btn = document.querySelector(
        `[data-complaint-id="${complaintId}"]`
      );
      const countSpan = btn.querySelector(".vote-count");
      const icon = btn.querySelector("i");

      countSpan.textContent = data.vote_count;

      if (data.action === "added") {
        btn.classList.add("voted");
        icon.classList.remove("bi-hand-thumbs-up");
        icon.classList.add("bi-hand-thumbs-up-fill");
        showAlert("success", "Vote added successfully!");
      } else {
        btn.classList.remove("voted");
        icon.classList.remove("bi-hand-thumbs-up-fill");
        icon.classList.add("bi-hand-thumbs-up");
        showAlert("info", "Vote removed");
      }
    } else {
      showAlert("danger", "Failed to vote on complaint");
    }
  } catch (error) {
    console.error("Error voting:", error);
    showAlert("danger", "Error voting on complaint");
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
  setTimeout(() => alertDiv.remove(), 3000);
}

// Make voteComplaint available globally for onclick handlers
window.voteComplaint = voteComplaint;
