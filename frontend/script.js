// Global variables
let videoStream = null;
let token = localStorage.getItem("token");
let currentAnalysis = null; // Store current analysis results

// Centralized API base + fetch helper
const defaultApiBase =
  window.location.hostname && window.location.protocol.startsWith("http")
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000";
const apiBase = localStorage.getItem("apiBase") || defaultApiBase;
window.apiBase = apiBase; // expose for inline scripts

// Enforce logout on new browser session:
// If the app is opened after the browser/tab was closed, sessionStorage is empty.
// On first load of a session, clear any persisted auth so the user must log in again.
(function enforceNewSessionLogout() {
  try {
    const sessionFlag = sessionStorage.getItem("sessionActive");
    if (!sessionFlag) {
      // New browser session detected -> clear any stale login
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      localStorage.removeItem("is_admin");
      token = null;
      sessionStorage.setItem("sessionActive", "1");
    }
  } catch (_) {
    // If storage isn't available, do nothing
  }
})();

async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${apiBase}${path}`;
  const headers = new Headers(options.headers || {});
  // Always accept JSON
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  // Add bearer token if available and not already provided
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const fetchOptions = {
    credentials: "include",
    ...options,
    headers,
  };

  const res = await fetch(url, fetchOptions);
  if (res.status === 401) {
    // Session expired / unauthorized
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    token = null;
    setupUI();
    // Inform the user and prompt login
    try {
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-warning alert-dismissible fade show";
      alertDiv.innerHTML = `
        <i class="bi bi-exclamation-triangle"></i> Your session has expired. Please log in again.
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      const container = document.getElementById("alertContainer");
      if (container) container.appendChild(alertDiv);
      setTimeout(() => alertDiv.remove(), 4000);
    } catch (_) {}
    if (typeof showLoginModal === "function") showLoginModal();
    throw new Error("Unauthorized");
  }
  return res;
}
window.apiFetch = apiFetch;

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Redirect first-time users to welcome page (including index)
  const hasSeenWelcome = localStorage.getItem("hasSeenWelcome");
  const path = window.location.pathname || "";
  const isOnWelcomePage = path.includes("welcome.html");

  if (!hasSeenWelcome && !isOnWelcomePage) {
    window.location.href = "welcome.html";
    return;
  }

  setupUI();

  // Only setup report-specific handlers if we're on a page with those elements
  // This prevents conflicts with dedicated page JS files
  const hasReportElements =
    document.getElementById("complaintForm") &&
    document.getElementById("imageInput") &&
    document.getElementById("analyzeBtn");

  if (hasReportElements) {
    // Let dedicated report.js handle these
    console.log("Report elements found - letting report.js handle them");
    return;
  }

  // Setup general event listeners for other functionality
  setupGeneralEventListeners();
});

function setupGeneralEventListeners() {
  // Dashboard filters (only if they exist)
  document.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document
        .querySelectorAll("[data-sort]")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      if (typeof loadPublicComplaints === "function") {
        loadPublicComplaints();
      }
    });
  });

  const categoryFilter = document.getElementById("categoryFilter");
  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => {
      if (typeof loadPublicComplaints === "function") {
        loadPublicComplaints();
      }
    });
  }

  const timeFilter = document.getElementById("timeFilter");
  if (timeFilter) {
    timeFilter.addEventListener("change", () => {
      if (typeof loadPublicComplaints === "function") {
        loadPublicComplaints();
      }
    });
  }

  // Hook login/register modal forms if present to prevent full page reload
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = loginForm.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await login();
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = registerForm.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await register();
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
}

// UI Setup
function setupUI() {
  const isLoggedIn = !!token;
  const username = localStorage.getItem("username");
  const isAdmin = localStorage.getItem("is_admin") === "1";

  // Update navbar profile section (new approach)
  const navLoginButtons = document.getElementById("navLoginButtons");
  const navUserInfo = document.getElementById("navUserInfo");
  const navUsername = document.getElementById("navUsername");
  const navPoints = document.getElementById("navPoints");

  if (navLoginButtons && navUserInfo) {
    if (isLoggedIn) {
      navLoginButtons.classList.add("d-none");
      navUserInfo.classList.remove("d-none");
      if (navUsername && username) {
        navUsername.textContent = username;
      }
      // Optionally show points next to username if element exists
      refreshNavPoints();
      // Inject Admin link if admin
      const navContainer = document.querySelector(".navbar-nav.ms-auto");
      if (isAdmin && navContainer && !document.getElementById("navAdminLink")) {
        const a = document.createElement("a");
        a.id = "navAdminLink";
        a.className = "nav-link";
        a.href = "admin.html";
        a.textContent = "🛠️ Admin";
        navContainer.appendChild(a);
      }
      // Remove Admin Login link if present (not needed when logged-in admin)
      const adminLoginLink = document.getElementById("navAdminLoginLink");
      if (isAdmin && adminLoginLink) adminLoginLink.remove();
    } else {
      navLoginButtons.classList.remove("d-none");
      navUserInfo.classList.add("d-none");
      const existing = document.getElementById("navAdminLink");
      if (existing) existing.remove();
    }
  }

  // Provide a dedicated "Admin Login" entry for professionalism
  // Visible when not logged in OR logged in as non-admin
  try {
    const navContainer = document.querySelector(".navbar-nav.ms-auto");
    if (navContainer) {
      let adminLoginLink = document.getElementById("navAdminLoginLink");
      const isAdmin = localStorage.getItem("is_admin") === "1";
      if (!isAdmin) {
        if (!adminLoginLink) {
          adminLoginLink = document.createElement("a");
          adminLoginLink.id = "navAdminLoginLink";
          adminLoginLink.className = "nav-link";
          adminLoginLink.href = "#";
          adminLoginLink.textContent = "🔐 Admin Login";
          adminLoginLink.addEventListener("click", (e) => {
            e.preventDefault();
            adminLoginFlow();
          });
          navContainer.appendChild(adminLoginLink);
        } else {
          adminLoginLink.classList.remove("d-none");
        }
      } else if (adminLoginLink) {
        adminLoginLink.remove();
      }
    }
  } catch (_) {}

  // Update auth buttons (legacy - for pages that still use this pattern)
  const authButtons = document.getElementById("authButtons");
  if (authButtons) {
    authButtons.innerHTML = isLoggedIn
      ? `<button class="btn btn-outline-light" onclick="logout()">Logout</button>`
      : `
        <button class="btn btn-outline-light me-2" onclick="showLoginModal()">Login</button>
        <button class="btn btn-light" onclick="showRegisterModal()">Register</button>
      `;
  }

  // Update submit button state (only if it exists)
  const analyzeBtn = document.getElementById("analyzeBtn");
  if (analyzeBtn) {
    analyzeBtn.disabled = !isLoggedIn;
    analyzeBtn.title = isLoggedIn ? "" : "Please login to analyze images";
  }

  // Show/hide sections appropriately (only if they exist)
  const complaintsList = document.getElementById("complaintsList");
  if (complaintsList && !isLoggedIn) {
    complaintsList.innerHTML = `
      <div class="alert alert-info">
        <i class="bi bi-info-circle"></i> Please log in to view your reports.
      </div>
    `;
  }

  const publicComplaintsList = document.getElementById("publicComplaintsList");
  if (publicComplaintsList && !isLoggedIn) {
    publicComplaintsList.innerHTML = `
      <div class="alert alert-info">
        <i class="bi bi-info-circle"></i> Please log in to view community reports.
      </div>
    `;
  }
}
// Helper to refresh navbar points badge
async function refreshNavPoints() {
  const navPoints = document.getElementById("navPoints");
  if (!navPoints) return;
  try {
    const r = await apiFetch("/auth/me");
    if (!r.ok) return;
    const me = await r.json();
    if (typeof me.points === "number") {
      navPoints.textContent = me.points.toString();
      const wrap = navPoints.closest(".d-none");
      if (wrap) wrap.classList.remove("d-none");
    }
  } catch (_) {}
}

// Authentication Functions
async function register() {
  const username = document.getElementById("registerUsername").value;
  const password = document.getElementById("registerPassword").value;

  if (!username || !password) {
    setInlineOrAlert(
      "registerMessage",
      '<div class="alert alert-danger">Please enter both username and password.</div>'
    );
    return;
  }

  try {
    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);
    // Note: Using username as email since the backend expects it

    const response = await apiFetch("/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    const data = await response.json();
    if (response.ok) {
      setInlineOrAlert(
        "registerMessage",
        '<div class="alert alert-success">Registration successful! Please login.</div>',
        "success"
      );
      setTimeout(() => {
        hideBsModal("registerModal");
        showBsModal("loginModal");
      }, 1500);
    } else {
      setInlineOrAlert(
        "registerMessage",
        `<div class="alert alert-danger">${data.detail}</div>`
      );
    }
  } catch (error) {
    setInlineOrAlert(
      "registerMessage",
      '<div class="alert alert-danger">Registration failed. Please try again.</div>'
    );
    console.error("Registration error:", error);
  }
}

async function login() {
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;

  try {
    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

    const response = await apiFetch("/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    const data = await response.json();
    if (response.ok) {
      token = data.access_token;
      localStorage.setItem("token", token);
      localStorage.setItem("username", username); // Store username for profile display
      if (typeof data.is_admin !== "undefined") {
        localStorage.setItem("is_admin", data.is_admin ? "1" : "0");
      }
      // Mark session active (prevents auto-logout within the same tab session)
      try {
        sessionStorage.setItem("sessionActive", "1");
      } catch (_) {}
      hideBsModal("loginModal");

      // Handle admin-required redirect intent (from Admin Login link)
      const requireAdmin = sessionStorage.getItem("requireAdmin") === "1";
      const postLoginRedirect = sessionStorage.getItem("postLoginRedirect");

      if (requireAdmin) {
        // Clear flags regardless
        sessionStorage.removeItem("requireAdmin");
        sessionStorage.removeItem("postLoginRedirect");
        if (data.is_admin) {
          // Go straight to admin dashboard
          window.location.href = postLoginRedirect || "admin.html";
          return; // Stop further UI work on this page
        } else {
          // Inform user that admin access is required
          const alertDiv = document.createElement("div");
          alertDiv.className = "alert alert-danger alert-dismissible fade show";
          alertDiv.innerHTML = `
            <i class="bi bi-shield-lock"></i> Admin access required. You are logged in as a regular user.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          `;
          const container = document.getElementById("alertContainer");
          (container || document.body).appendChild(alertDiv);
          setTimeout(() => alertDiv.remove(), 5000);
        }
      } else if (postLoginRedirect) {
        sessionStorage.removeItem("postLoginRedirect");
        window.location.href = postLoginRedirect;
        return;
      }

      // If this is an admin and no specific redirect is requested, take them to the Admin dashboard by default
      if (data.is_admin) {
        window.location.href = "admin.html";
        return;
      }

      // Update UI and load data
      setupUI();
      await Promise.all([
        loadComplaints(),
        loadPublicComplaints(),
        loadCategories(),
      ]);

      // Show welcome message
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-success alert-dismissible fade show";
      alertDiv.innerHTML = `
        Welcome back, ${username}!
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      document.getElementById("alertContainer").appendChild(alertDiv);
      setTimeout(() => alertDiv.remove(), 5000);
    } else {
      setInlineOrAlert(
        "loginMessage",
        '<div class="alert alert-danger">Login failed. Please check your credentials.</div>'
      );
    }
  } catch (error) {
    setInlineOrAlert(
      "loginMessage",
      '<div class="alert alert-danger">Login failed. Please try again.</div>'
    );
    console.error("Login error:", error);
  }
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("username"); // Also remove stored username
  token = null;
  try {
    localStorage.removeItem("is_admin");
    sessionStorage.removeItem("sessionActive");
    sessionStorage.removeItem("postLoginRedirect");
    sessionStorage.removeItem("requireAdmin");
  } catch (_) {}
  setupUI();

  // Clear both complaint lists
  document.getElementById("complaintsList").innerHTML = `
    <div class="alert alert-info">
      <i class="bi bi-info-circle"></i> Please log in to view your reports.
    </div>
  `;
  document.getElementById("publicComplaintsList").innerHTML = `
    <div class="alert alert-info">
      <i class="bi bi-info-circle"></i> Please log in to view community reports.
    </div>
  `;

  // Show message
  const alertDiv = document.createElement("div");
  alertDiv.className = "alert alert-info alert-dismissible fade show";
  alertDiv.innerHTML = `
    You have been logged out.
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  document.getElementById("alertContainer").appendChild(alertDiv);
  setTimeout(() => alertDiv.remove(), 3000);

  // Reset UI elements
  document.getElementById("categoryFilter").innerHTML =
    '<option value="">All Categories</option>';
  document.getElementById("preview").classList.add("d-none");
  document.getElementById("preview").src = "";
  document.getElementById("resultSection").classList.add("d-none");

  // Navigate back to index (which will redirect to welcome if applicable)
  try {
    window.location.href = "index.html";
  } catch (_) {}
}

// Camera Functions
async function toggleCamera() {
  const video = document.getElementById("video");
  const toggleBtn = document.getElementById("toggleCameraBtn");
  const captureBtn = document.getElementById("captureBtn");

  if (videoStream) {
    stopCamera();
    toggleBtn.textContent = "📸 Use Camera";
    captureBtn.classList.add("d-none");
    video.classList.add("d-none");
  } else {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = videoStream;
      video.classList.remove("d-none");
      toggleBtn.textContent = "❌ Stop Camera";
      captureBtn.classList.remove("d-none");
    } catch (err) {
      alert("Camera access denied or error occurred");
    }
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach((track) => track.stop());
    videoStream = null;
  }
}

function capturePhoto() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  const preview = document.getElementById("preview");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);

  preview.src = canvas.toDataURL("image/jpeg");
  preview.classList.remove("d-none");
  resetAnalysis(); // Reset analysis when new photo is captured

  stopCamera();
  document.getElementById("toggleCameraBtn").textContent = "📸 Use Camera";
  document.getElementById("captureBtn").classList.add("d-none");
  video.classList.add("d-none");
}

function showPreview(file) {
  const preview = document.getElementById("preview");

  // Create object URL and set src
  const objectURL = URL.createObjectURL(file);
  preview.src = objectURL;

  // Ensure the image is loaded before showing
  preview.onload = function () {
    preview.classList.remove("d-none");
    console.log("Preview image loaded and should be visible");
  };

  // Also remove d-none immediately in case onload doesn't fire
  preview.classList.remove("d-none");

  // Reset analysis after showing preview
  setTimeout(() => {
    resetAnalysis();
  }, 100); // Small delay to ensure preview is shown first
}

// Analysis Functions
async function analyzeImage() {
  console.log("analyzeImage function called");

  // PREVENT ANY NAVIGATION during analysis
  const originalOnBeforeUnload = window.onbeforeunload;
  window.onbeforeunload = () => {
    return "Analysis in progress. Are you sure you want to leave?";
  };

  try {
    if (!token) {
      console.log("No token found");
      alert("Please login first to analyze images");
      showLoginModal();
      return;
    }

    const preview = document.getElementById("preview");
    console.log("Preview element:", preview);
    console.log("Preview src:", preview.src);

    if (!preview.src) {
      alert("Please select or capture an image first");
      return;
    }

    const fileInput = document.getElementById("imageInput");
    console.log("File input files:", fileInput.files);

    if (
      !preview.src.startsWith("data:") &&
      (!fileInput.files || !fileInput.files[0])
    ) {
      alert("Please select an image file first");
      return;
    }

    const formData = new FormData();
    const analyzeBtn = document.getElementById("analyzeBtn");

    // First, prepare the image data
    if (preview.src.startsWith("data:")) {
      console.log("Using canvas data");
      // Convert base64 to blob for canvas capture
      const res = await fetch(preview.src);
      const blob = await res.blob();
      formData.append("image", blob, "capture.jpg");
    } else {
      console.log("Using file input");
      // Use file input
      formData.append("image", fileInput.files[0]);
    }

    // Show loading state
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm"></span> Analyzing...';

    console.log("Making fetch request to analyze endpoint");

    const response = await apiFetch("/classifier/analyze", {
      method: "POST",
      body: formData,
    });

    console.log("Response received:", response.status);
    const data = await response.json();
    console.log("Response data:", data);

    if (response.ok) {
      currentAnalysis = data.analysis;

      // Ensure we prevent any navigation after successful response
      window.history.replaceState(null, null, window.location.href);

      const resultShown = showAnalysisResult(data.analysis);

      if (resultShown) {
        // Show success message only after analysis is properly displayed
        setTimeout(() => {
          const alertDiv = document.createElement("div");
          alertDiv.className =
            "alert alert-success alert-dismissible fade show";
          alertDiv.innerHTML = `
            <i class="bi bi-check-circle"></i> Image analyzed successfully! Review the results below.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          `;
          document.getElementById("alertContainer").appendChild(alertDiv);
          setTimeout(() => alertDiv.remove(), 3000);
        }, 500);
      }
    } else {
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-danger alert-dismissible fade show";
      alertDiv.innerHTML = `
        <i class="bi bi-exclamation-circle"></i> ${
          data.detail || "Failed to analyze image"
        }
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      document.getElementById("alertContainer").appendChild(alertDiv);
    }
  } catch (error) {
    console.error("Error in analyzeImage:", error);
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-danger alert-dismissible fade show";
    alertDiv.innerHTML = `
      <i class="bi bi-exclamation-circle"></i> Error analyzing image: ${error.message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.getElementById("alertContainer").appendChild(alertDiv);
  } finally {
    // Restore original navigation handler
    window.onbeforeunload = originalOnBeforeUnload;

    const analyzeBtn = document.getElementById("analyzeBtn");
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = "🔍 Analyze Issue";
  }
}

function showAnalysisResult(analysis) {
  console.log("showAnalysisResult called with:", analysis);

  try {
    // Prevent any potential navigation
    window.history.replaceState(null, null, window.location.href);

    const analysisSection = document.getElementById("analysisSection");
    analysisSection.classList.remove("d-none");
    console.log("Analysis section shown");

    document.getElementById("analyzedCategoryBadge").textContent =
      analysis.category;
    document.getElementById(
      "analyzedConfidenceBadge"
    ).textContent = `Confidence: ${(analysis.confidence * 100).toFixed(1)}%`;
    document.getElementById("analyzedIssueText").textContent =
      analysis.predicted_issue;
    document.getElementById("editableDescription").value = analysis.description;

    const priorityBadge = document.getElementById("analyzedPriorityBadge");
    priorityBadge.textContent = `${analysis.priority} Priority`;
    priorityBadge.className = `badge priority-${analysis.priority.toLowerCase()}`;

    console.log("All analysis result elements updated");

    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    requestAnimationFrame(() => {
      analysisSection.scrollIntoView({ behavior: "smooth", block: "start" });
      console.log("Scrolled to analysis section");

      // Initialize voice input button if it exists
      const voiceBtn = document.getElementById("voiceInputBtn");
      if (voiceBtn) {
        voiceBtn.classList.add("voice-input-btn");
      }
    });

    return true; // Indicate success
  } catch (error) {
    console.error("Error in showAnalysisResult:", error);
    return false;
  }
}

function resetAnalysis() {
  currentAnalysis = null;
  document.getElementById("analysisSection").classList.add("d-none");
  document.getElementById("resultSection").classList.add("d-none");
}

// Voice Input Functions
let recognition = null;
let isRecording = false;

function startVoiceInput() {
  console.log("Voice input requested");

  // Check if speech recognition is supported
  if (
    !("webkitSpeechRecognition" in window) &&
    !("SpeechRecognition" in window)
  ) {
    alert(
      "Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari."
    );
    return;
  }

  const voiceBtn = document.getElementById("voiceInputBtn");
  const textarea = document.getElementById("editableDescription");

  if (isRecording) {
    // Stop recording
    stopVoiceInput();
    return;
  }

  try {
    // Create speech recognition instance
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    // Configure recognition
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // Visual feedback
    voiceBtn.classList.add("recording");
    voiceBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
    voiceBtn.title = "Click to stop recording";
    isRecording = true;

    // Store original text to append to
    const originalText = textarea.value;
    let finalTranscript = "";
    let interimTranscript = "";

    recognition.onresult = (event) => {
      interimTranscript = "";
      finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interimTranscript += transcript;
        }
      }

      // Update textarea with results
      const newText =
        originalText +
        (originalText ? " " : "") +
        finalTranscript +
        interimTranscript;
      textarea.value = newText;
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      let errorMessage = "Voice recognition error: ";

      switch (event.error) {
        case "no-speech":
          errorMessage += "No speech detected. Please try again.";
          break;
        case "audio-capture":
          errorMessage += "Microphone access denied or not available.";
          break;
        case "not-allowed":
          errorMessage +=
            "Microphone permission denied. Please allow microphone access.";
          break;
        default:
          errorMessage += event.error;
      }

      alert(errorMessage);
      stopVoiceInput();
    };

    recognition.onend = () => {
      stopVoiceInput();
    };

    // Start recognition
    recognition.start();

    // Show success message
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-info alert-dismissible fade show";
    alertDiv.innerHTML = `
      <i class="bi bi-mic"></i> Listening... Speak your description now.
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.getElementById("alertContainer").appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 3000);
  } catch (error) {
    console.error("Voice input error:", error);
    alert("Voice input failed. Please try typing instead.");
    stopVoiceInput();
  }
}

function stopVoiceInput() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }

  const voiceBtn = document.getElementById("voiceInputBtn");
  if (voiceBtn) {
    voiceBtn.classList.remove("recording", "processing");
    voiceBtn.innerHTML = '<i class="bi bi-mic"></i>';
    voiceBtn.title = "Click to speak your description";
  }

  isRecording = false;
  console.log("Voice input stopped");
}

// Complaint Functions
async function submitComplaint() {
  if (!token) {
    alert("Please login first to submit a complaint");
    showLoginModal();
    return;
  }

  if (!currentAnalysis) {
    alert("Please analyze the image first before submitting");
    return;
  }

  const preview = document.getElementById("preview");
  if (!preview.src) {
    alert("Please select or capture an image first");
    return;
  }

  const formData = new FormData();
  const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");

  // First, prepare the image data
  if (preview.src.startsWith("data:")) {
    // Convert base64 to blob for canvas capture
    const res = await fetch(preview.src);
    const blob = await res.blob();
    formData.append("image", blob, "capture.jpg");
  } else {
    // Use file input
    const fileInput = document.getElementById("imageInput");
    formData.append("image", fileInput.files[0]);
  }

  // Add the edited description from the analysis preview
  const editedDescription = document.getElementById(
    "editableDescription"
  ).value;
  if (editedDescription !== currentAnalysis.description) {
    formData.append("description", editedDescription);
  }

  // Add location data and show loading state
  confirmSubmitBtn.disabled = true;
  confirmSubmitBtn.innerHTML =
    '<span class="spinner-border spinner-border-sm"></span> Getting location...';

  let locationCaptured = false;

  if ("geolocation" in navigator) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, // Request high accuracy
          timeout: 10000, // 10 second timeout
          maximumAge: 0, // Don't use cached position
        });
      });

      const locationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      // Try to get address using reverse geocoding
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${position.coords.latitude}&lon=${position.coords.longitude}&format=json`
        );
        const data = await response.json();
        locationData.address = data.display_name;
      } catch (error) {
        console.warn("Could not get address:", error);
      }

      formData.append("location", JSON.stringify(locationData));
      locationCaptured = true;

      // Show success message
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-success alert-dismissible fade show";
      alertDiv.innerHTML = `
        <i class="bi bi-geo-alt"></i> Location captured successfully!
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      document.getElementById("alertContainer").appendChild(alertDiv);
      setTimeout(() => alertDiv.remove(), 3000);
    } catch (err) {
      console.warn("Could not get location:", err);
      // Show error message to user
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-warning alert-dismissible fade show";
      alertDiv.innerHTML = `
        <i class="bi bi-exclamation-triangle"></i> Could not get your location. Please enable location access.
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      document.getElementById("alertContainer").appendChild(alertDiv);
      if (!confirm("Continue without location?")) {
        confirmSubmitBtn.disabled = false;
        confirmSubmitBtn.innerHTML = "✅ Submit This Report";
        return;
      }
    }
  } else {
    // Show browser incompatibility message
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-warning alert-dismissible fade show";
    alertDiv.innerHTML = `
      <i class="bi bi-exclamation-triangle"></i> Your browser doesn't support location services.
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.getElementById("alertContainer").appendChild(alertDiv);
  }

  // Update button to show uploading state
  confirmSubmitBtn.innerHTML =
    '<span class="spinner-border spinner-border-sm"></span> Submitting...';

  try {
    const response = await apiFetch("/complaints/raise", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (response.ok) {
      showResult(data.complaint);
      loadComplaints();
      // After successful submission, refresh points badge
      refreshNavPoints();

      // Hide analysis section and show success
      document.getElementById("analysisSection").classList.add("d-none");
      currentAnalysis = null;

      // Show success message
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-success alert-dismissible fade show";
      alertDiv.innerHTML = `
        <i class="bi bi-check-circle"></i> Report submitted successfully!
        ${locationCaptured ? " Location data included." : ""}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      document.getElementById("alertContainer").appendChild(alertDiv);
      setTimeout(() => alertDiv.remove(), 3000);

      // Reset form
      document.getElementById("preview").classList.add("d-none");
      document.getElementById("preview").src = "";
      document.getElementById("imageInput").value = "";
    } else {
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert alert-danger alert-dismissible fade show";
      alertDiv.innerHTML = `
        <i class="bi bi-exclamation-circle"></i> ${
          data.detail || "Failed to submit complaint"
        }
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `;
      document.getElementById("alertContainer").appendChild(alertDiv);
    }
  } catch (error) {
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-danger alert-dismissible fade show";
    alertDiv.innerHTML = `
      <i class="bi bi-exclamation-circle"></i> Error submitting complaint
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.getElementById("alertContainer").appendChild(alertDiv);
    console.error(error);
  } finally {
    confirmSubmitBtn.disabled = false;
    confirmSubmitBtn.innerHTML = "✅ Submit This Report";
  }
}

function showResult(complaint) {
  document.getElementById("resultSection").classList.remove("d-none");
  document.getElementById("categoryBadge").textContent = complaint.category;
  document.getElementById("confidenceBadge").textContent = `Confidence: ${(
    (complaint.ai_metadata?.ai_confidence || 0) * 100
  ).toFixed(1)}%`;
  document.getElementById("descriptionText").textContent =
    complaint.description;
  document.getElementById("statusBadge").textContent = complaint.status;

  const priorityBadge = document.getElementById("priorityBadge");
  priorityBadge.textContent = complaint.priority;
  priorityBadge.className = `badge priority-${complaint.priority.toLowerCase()}`;

  // Add location information if available
  if (
    complaint.location?.address ||
    (complaint.location?.latitude && complaint.location?.longitude)
  ) {
    const locationDiv = document.createElement("div");
    locationDiv.className = "mt-3 text-muted small";
    locationDiv.innerHTML = `
      <i class="bi bi-geo-alt"></i> 
      ${
        complaint.location.address ||
        `Location: ${complaint.location.latitude.toFixed(
          6
        )}, ${complaint.location.longitude.toFixed(6)}`
      }
    `;
    document.getElementById("resultSection").appendChild(locationDiv);
  }

  // Scroll result into view
  document
    .getElementById("resultSection")
    .scrollIntoView({ behavior: "smooth" });
}

async function loadComplaints() {
  if (!token) {
    document.getElementById("complaintsList").innerHTML = `
      <div class="alert alert-warning">
        <i class="bi bi-exclamation-triangle"></i> Please log in to view your reports
      </div>
    `;
    return;
  }

  try {
    const response = await apiFetch("/complaints/my", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();
    if (response.ok) {
      displayComplaints(data.complaints);
    } else {
      throw new Error(data.detail || "Failed to load complaints");
    }
  } catch (error) {
    console.error("Error loading complaints:", error);
    document.getElementById("complaintsList").innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-circle"></i> Error loading your reports. Please try again.
      </div>
    `;
  }
}

function displayComplaints(complaints) {
  const container = document.getElementById("complaintsList");

  // Clear previous content
  container.innerHTML = "";

  if (!complaints || !complaints.length) {
    container.innerHTML = `
      <div class="alert alert-info">
        <i class="bi bi-info-circle"></i> No reports found. Submit your first report above!
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
          </div>
          <span class="badge priority-${complaint.priority.toLowerCase()}">
            ${complaint.priority} Priority
          </span>
        </div>
        
        <img 
          src="${apiBase}${complaint.image_url}" 
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
          </div>
          ${
            complaint.location
              ? `
            <div class="text-muted small">
              <i class="bi bi-geo-alt"></i>
              ${complaint.location.address || "Location recorded"}
            </div>
          `
              : ""
          }
        </div>
      </div>
    `;
  });
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

// Modal Functions

function showLoginModal() {
  showBsModal("loginModal");
}

function showRegisterModal() {
  showBsModal("registerModal");
}

// User Login flow helper: sets redirect to community after login
function userLoginFlow() {
  // If already logged in, just go to community
  if (token) {
    window.location.href = "community.html";
    return;
  }
  sessionStorage.setItem("postLoginRedirect", "community.html");
  sessionStorage.removeItem("requireAdmin");
  showLoginModal();
}

// Admin Login flow helper: opens login (or redirects if already admin)
function adminLoginFlow() {
  const isAdmin = localStorage.getItem("is_admin") === "1";
  if (token && isAdmin) {
    // Already an admin - go to dashboard
    window.location.href = "admin.html";
    return;
  }

  // Set intent to land on admin page after successful admin auth
  sessionStorage.setItem("postLoginRedirect", "admin.html");
  sessionStorage.setItem("requireAdmin", "1");

  // If currently logged in but not admin, inform user they need admin credentials
  if (token && !isAdmin) {
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-info alert-dismissible fade show";
    alertDiv.innerHTML = `
      <i class="bi bi-info-circle"></i> Please sign in with an admin account to continue.
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    const container = document.getElementById("alertContainer");
    (container || document.body).appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 4000);
  }

  showLoginModal();
}

// Make resetAnalysis available globally for HTML onclick
window.resetAnalysis = resetAnalysis;

// Bootstrap 5 modal helpers (no jQuery dependency)
function showBsModal(id) {
  const el = document.getElementById(id);
  if (!el || typeof bootstrap === "undefined") return;
  const modal = bootstrap.Modal.getOrCreateInstance(el);
  modal.show();
}

function hideBsModal(id) {
  const el = document.getElementById(id);
  if (!el || typeof bootstrap === "undefined") return;
  const modal = bootstrap.Modal.getOrCreateInstance(el);
  modal.hide();
}

// Helper to write into an inline message container if present; otherwise show a global alert
function setInlineOrAlert(targetId, html, type = "danger") {
  const el = document.getElementById(targetId);
  if (el) {
    el.innerHTML = html;
    return;
  }
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.innerHTML = `
    ${html}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  const container = document.getElementById("alertContainer");
  (container || document.body).appendChild(alertDiv);
  setTimeout(() => alertDiv.remove(), 4000);
}
