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

  // After initial load, handle highlight from query and dup notice
  handleHighlightFromQuery();
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
    const response = await apiFetch("/complaints/categories");

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
    const response = await apiFetch(
      `/complaints/public?sort_by=${sortBy}&category=${category}&days=${days}`
    );

    const data = await response.json();
    if (response.ok) {
      displayPublicComplaints(data.complaints);
      updateCommunityStats(data.complaints);
      // Re-apply highlight when list changes
      setTimeout(() => handleHighlightFromQuery(), 0);
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
      <div class="complaint-card" data-complaint-id="${complaint.id}">
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
          src="${window.apiBase}${complaint.image_url}" 
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
            <div class="d-flex align-items-center gap-2">
              ${
                complaint.location &&
                ((complaint.location.latitude != null &&
                  complaint.location.longitude != null) ||
                  complaint.location.address)
                  ? `<a class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${
                      complaint.location.latitude != null &&
                      complaint.location.longitude != null
                        ? encodeURIComponent(complaint.location.latitude) +
                          "," +
                          encodeURIComponent(complaint.location.longitude)
                        : encodeURIComponent(complaint.location.address)
                    }">
                       <i class="bi bi-geo"></i> View Location
                     </a>`
                  : ""
              }
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
      </div>
    `;
  });
}

// Highlight handling: scroll to and pulse a card by ID if ?highlight= is present
function handleHighlightFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const highlightId = params.get("highlight");

    // Show a notice if we redirected from a duplicate submission
    try {
      const raw = sessionStorage.getItem("dupNotice");
      if (raw) {
        const info = JSON.parse(raw);
        showAlert(
          "success",
          `${info.message} Redirected to report #${info.id}. Current votes: ${info.vote_count}.`
        );
        sessionStorage.removeItem("dupNotice");
      }
    } catch (_) {}

    if (!highlightId) return;
    const selector = `[data-complaint-id="${highlightId}"]`;
    const el = document.querySelector(selector);
    if (!el) return;

    el.classList.add("highlight-pulse");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Remove the class after a while
    setTimeout(() => el.classList.remove("highlight-pulse"), 4000);
  } catch (e) {
    // ignore
  }
}

function updateCommunityStats(complaints) {
  const total = complaints.length;
  const resolved = complaints.filter((c) => c.status === "resolved").length;
  // Approximate active users as unique usernames in the list
  const active = (() => {
    try {
      const set = new Set(
        complaints
          .map((c) => c.user && c.user.username)
          .filter((u) => typeof u === "string" && u.length > 0)
      );
      return set.size;
    } catch (_) {
      return Math.max(0, Math.floor(total * 0.3));
    }
  })();

  const totalEl = document.getElementById("totalReports");
  if (totalEl) totalEl.textContent = total.toLocaleString();

  const resolvedEl = document.getElementById("resolvedReports");
  if (resolvedEl) resolvedEl.textContent = resolved.toLocaleString();

  const activeEl = document.getElementById("activeUsers");
  if (activeEl) activeEl.textContent = active.toLocaleString();
}

async function voteComplaint(complaintId) {
  const token = localStorage.getItem("token");
  if (!token) {
    showLoginModal();
    return;
  }

  try {
    const response = await apiFetch(`/complaints/vote/${complaintId}`, {
      method: "POST",
    });

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
