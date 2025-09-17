// Load unique categories for filter
async function loadCategories() {
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
  if (!token) return;

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
    }
  } catch (error) {
    console.error("Error loading public complaints:", error);
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
                        <span class="badge bg-${getStatusColor(
                          complaint.status
                        )} ms-2">
                            ${complaint.status.replace("_", " ")}
                        </span>
                        <span class="complaint-author ms-2">
                            <i class="bi bi-person"></i> ${
                              complaint.user.username
                            }
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
                            Reported: ${new Date(
                              complaint.created_at
                            ).toLocaleDateString()}
                            ${
                              complaint.location
                                ? `
                                    <span class="ms-3">
                                        <i class="bi bi-geo-alt"></i>
                                        ${
                                          complaint.location.address ||
                                          "Location recorded"
                                        }
                                    </span>
                                    `
                                : ""
                            }
                        </div>
                        <button 
                            onclick="voteComplaint(${complaint.id})"
                            class="vote-btn ${
                              complaint.has_voted ? "voted" : ""
                            }"
                            data-complaint-id="${complaint.id}"
                        >
                            <i class="bi ${
                              complaint.has_voted
                                ? "bi-hand-thumbs-up-fill"
                                : "bi-hand-thumbs-up"
                            }"></i>
                            <span class="vote-count">${
                              complaint.vote_count
                            }</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
  });
}

async function voteComplaint(complaintId) {
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
      } else {
        btn.classList.remove("voted");
        icon.classList.remove("bi-hand-thumbs-up-fill");
        icon.classList.add("bi-hand-thumbs-up");
      }
    }
  } catch (error) {
    console.error("Error voting:", error);
  }
}
