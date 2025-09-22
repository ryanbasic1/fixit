// Report-specific functionality extracted from script.js
// This handles image upload, camera, AI analysis, voice input, and complaint submission

// Wrap everything in an IIFE to avoid global variable conflicts
(function () {
  "use strict";

  // Local variables for report functionality (no longer global)
  let videoStream = null;
  let currentAnalysis = null;
  let recognition = null;
  let isRecording = false;

  // Initialize report page functionality
  document.addEventListener("DOMContentLoaded", () => {
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

    setupReportPage();
  });

  function showNotLoggedInState() {
    const analyzeBtn = document.getElementById("analyzeBtn");
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = "Please Login to Report Issues";
    }

    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-warning";
    alertDiv.innerHTML = `
    <i class="bi bi-exclamation-triangle"></i> Please log in to report civic issues.
    <div class="mt-2">
      <button class="btn btn-primary btn-sm" onclick="showLoginModal()">Login</button>
      <button class="btn btn-outline-primary btn-sm ms-2" onclick="showRegisterModal()">Register</button>
    </div>
  `;

    const container = document.querySelector(".container .row .col-md-8");
    if (container && container.children.length > 0) {
      container.insertBefore(alertDiv, container.children[1]); // Insert after h2
    }
  }

  function setupReportPage() {
    console.log("Setting up report page...");

    // Remove any existing event listeners to avoid conflicts
    const imageInput = document.getElementById("imageInput");
    const toggleCameraBtn = document.getElementById("toggleCameraBtn");
    const captureBtn = document.getElementById("captureBtn");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");
    const voiceInputBtn = document.getElementById("voiceInputBtn");

    // Check if elements exist
    if (!imageInput || !toggleCameraBtn || !captureBtn || !analyzeBtn) {
      console.error("Required elements not found");
      return;
    }

    // File input handler
    imageInput.onchange = (e) => {
      console.log("File input change event triggered");
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        console.log("File selected:", file.name, file.size);
        showPreview(file);
      }
    };

    // Camera handlers
    toggleCameraBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Toggle camera clicked");
      toggleCamera();
      return false;
    };

    captureBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Capture button clicked");
      capturePhoto();
      return false;
    };

    // Analyze button handler with comprehensive event prevention
    analyzeBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      console.log("Analyze button clicked - preventing all default behaviors");

      try {
        const btn = e.target;
        btn.disabled = true;
        await analyzeImage();
      } catch (error) {
        console.error("Error in analyze button handler:", error);
      } finally {
        const btn = e.target;
        if (btn.disabled) {
          btn.disabled = false;
        }
      }

      return false;
    };

    // Confirm submit handler
    if (confirmSubmitBtn) {
      confirmSubmitBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Confirm submit clicked");
        submitComplaint();
        return false;
      };
    }

    // Voice input handler
    if (voiceInputBtn) {
      voiceInputBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startVoiceInput();
        return false;
      };
    }

    console.log("Report page setup complete");
  }

  // Camera Functions
  async function toggleCamera() {
    console.log("toggleCamera function called");
    const video = document.getElementById("video");
    const toggleBtn = document.getElementById("toggleCameraBtn");
    const captureBtn = document.getElementById("captureBtn");

    console.log("Video element:", video);
    console.log("Toggle button:", toggleBtn);
    console.log("Capture button:", captureBtn);
    console.log("Current videoStream:", videoStream);

    if (videoStream) {
      console.log("Stopping existing camera stream");
      stopCamera();
      toggleBtn.textContent = "📸 Use Camera";
      captureBtn.classList.add("d-none");
      video.classList.add("d-none");
    } else {
      console.log("Starting camera stream");
      try {
        console.log("Requesting user media...");
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        console.log("Got video stream:", videoStream);

        video.srcObject = videoStream;
        video.classList.remove("d-none");
        toggleBtn.textContent = "❌ Stop Camera";
        captureBtn.classList.remove("d-none");
        console.log("Camera setup complete");
      } catch (err) {
        console.error("Camera error:", err);
        showAlert(
          "danger",
          "Camera access denied or error occurred: " + err.message
        );
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
    resetAnalysis();

    stopCamera();
    document.getElementById("toggleCameraBtn").textContent = "📸 Use Camera";
    document.getElementById("captureBtn").classList.add("d-none");
    video.classList.add("d-none");
  }

  function showPreview(file) {
    const preview = document.getElementById("preview");

    const objectURL = URL.createObjectURL(file);
    preview.src = objectURL;

    preview.onload = function () {
      preview.classList.remove("d-none");
      console.log("Preview image loaded and should be visible");
    };

    preview.classList.remove("d-none");

    setTimeout(() => {
      resetAnalysis();
    }, 100);
  }

  // Analysis Functions
  async function analyzeImage() {
    console.log("=== analyzeImage function called ===");

    // Prevent navigation during analysis
    const originalOnBeforeUnload = window.onbeforeunload;
    window.onbeforeunload = () => {
      return "Analysis in progress. Are you sure you want to leave?";
    };

    try {
      const token = localStorage.getItem("token");
      console.log("Token:", token ? "present" : "missing");

      if (!token) {
        console.log("No token found");
        showAlert("warning", "Please login first to analyze images");
        showLoginModal();
        return;
      }

      const preview = document.getElementById("preview");
      console.log("Preview element:", preview);
      console.log("Preview src:", preview?.src);

      if (!preview || !preview.src) {
        console.log("No preview image found");
        showAlert("warning", "Please select or capture an image first");
        return;
      }

      const fileInput = document.getElementById("imageInput");
      console.log("File input files:", fileInput?.files);

      if (
        !preview.src.startsWith("data:") &&
        (!fileInput.files || !fileInput.files[0])
      ) {
        console.log("No valid image source");
        showAlert("warning", "Please select an image file first");
        return;
      }

      const formData = new FormData();
      const analyzeBtn = document.getElementById("analyzeBtn");

      // Prepare image data
      console.log("Preparing image data...");
      if (preview.src.startsWith("data:")) {
        console.log("Using canvas data (camera capture)");
        const res = await fetch(preview.src);
        const blob = await res.blob();
        console.log("Blob created:", blob.size, "bytes");
        formData.append("image", blob, "capture.jpg");
      } else {
        console.log("Using file input");
        formData.append("image", fileInput.files[0]);
      }

      // Show loading state
      analyzeBtn.disabled = true;
      analyzeBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm"></span> Analyzing...';

      console.log("Making fetch request to analyze endpoint...");
      const response = await apiFetch("/classifier/analyze", {
        method: "POST",
        body: formData,
      });

      console.log("Response received. Status:", response.status);
      console.log("Response OK:", response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Response error:", errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log("Response data:", data);

      if (response.ok && data.analysis) {
        currentAnalysis = data.analysis;
        console.log("Analysis successful:", currentAnalysis);

        // Ensure no navigation after successful response
        window.history.replaceState(null, null, window.location.href);

        const resultShown = showAnalysisResult(data.analysis);

        if (resultShown) {
          setTimeout(() => {
            showAlert(
              "success",
              "Image analyzed successfully! Review the results below."
            );
          }, 500);
        }
      } else {
        console.error("Invalid response format:", data);
        showAlert("danger", data.detail || "Invalid response from server");
      }
    } catch (error) {
      console.error("Error in analyzeImage:", error);
      showAlert("danger", `Error analyzing image: ${error.message}`);
    } finally {
      // Restore original navigation handler
      window.onbeforeunload = originalOnBeforeUnload;

      const analyzeBtn = document.getElementById("analyzeBtn");
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = "🔍 Analyze Issue";

      console.log("=== analyzeImage function completed ===");
    }
  }

  function showAnalysisResult(analysis) {
    console.log("showAnalysisResult called with:", analysis);

    try {
      // Prevent navigation
      window.history.replaceState(null, null, window.location.href);

      const analysisSection = document.getElementById("analysisSection");
      analysisSection.classList.remove("d-none");
      console.log("Analysis section shown");

      const categoryBadge = document.getElementById("analyzedCategoryBadge");
      const confidenceBadge = document.getElementById(
        "analyzedConfidenceBadge"
      );
      const issueText = document.getElementById("analyzedIssueText");
      const editableDescription = document.getElementById(
        "editableDescription"
      );
      const voiceBtn = document.getElementById("voiceInputBtn");
      const submitBtn = document.getElementById("confirmSubmitBtn");

      // Populate common fields
      categoryBadge.textContent = analysis.category;
      confidenceBadge.textContent = `Confidence: ${(
        analysis.confidence * 100
      ).toFixed(1)}%`;
      issueText.textContent = analysis.predicted_issue;
      editableDescription.value = analysis.description;

      const priorityBadge = document.getElementById("analyzedPriorityBadge");
      priorityBadge.textContent = `${analysis.priority} Priority`;
      priorityBadge.className = `badge priority-${analysis.priority.toLowerCase()}`;

      // Populate category/subcategory selects
      initCategorySelectors(analysis);

      // Non-civic handling: disable submission and guide the user
      if (analysis.is_civic === false || analysis.category === "non_civic") {
        // Style badges to indicate caution
        categoryBadge.classList.remove("bg-primary");
        categoryBadge.classList.add("bg-warning", "text-dark");

        // Lock editing and voice input for non-civic detections
        editableDescription.disabled = true;
        if (voiceBtn) {
          voiceBtn.disabled = true;
          voiceBtn.title = "Disabled for non-civic images";
        }

        // Disable submit and change button text
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "🚫 Submission Disabled (Not a civic issue)";
        }

        // Friendly guidance toast
        showAlert(
          "warning",
          "This looks non-civic (e.g., selfie, pet, random object). Please capture the actual issue like a pothole, garbage overflow, or broken streetlight."
        );
      } else {
        // Ensure fields are enabled for civic cases
        editableDescription.disabled = false;
        if (voiceBtn) {
          voiceBtn.disabled = false;
          voiceBtn.title = "Click to speak your description";
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "✅ Submit This Report";
        }
      }

      console.log("All analysis result elements updated");

      // Smooth scroll to results
      requestAnimationFrame(() => {
        analysisSection.scrollIntoView({ behavior: "smooth", block: "start" });
        console.log("Scrolled to analysis section");

        // Initialize voice input button
        const voiceBtn2 = document.getElementById("voiceInputBtn");
        if (voiceBtn2) {
          voiceBtn2.classList.add("voice-input-btn");
        }
      });

      return true;
    } catch (error) {
      console.error("Error in showAnalysisResult:", error);
      return false;
    }
  }

  // Load catalog once per session
  let catalogCache = null;
  async function fetchCatalog() {
    if (catalogCache) return catalogCache;
    const res = await apiFetch("/complaints/catalog");
    if (!res.ok) throw new Error("Failed to load categories");
    const data = await res.json();
    catalogCache = data.catalog;
    return catalogCache;
  }

  async function initCategorySelectors(analysis) {
    try {
      const categorySelect = document.getElementById("categorySelect");
      const subcategorySelect = document.getElementById("subcategorySelect");
      if (!categorySelect || !subcategorySelect) return;

      const catalog = await fetchCatalog();
      // Build a map: issue_category -> [entries]
      const byCategory = new Map();
      for (const item of catalog) {
        const key = item.issue_category;
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push(item);
      }

      // Populate category options
      categorySelect.innerHTML = "";
      for (const [cat, items] of byCategory.entries()) {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
      }

      // Helper to populate subcategories for a given category
      function populateSubcats(cat) {
        subcategorySelect.innerHTML = "";
        const items = byCategory.get(cat) || [];
        for (const item of items) {
          const opt = document.createElement("option");
          opt.value = item.subcategory;
          opt.textContent = item.subcategory;
          subcategorySelect.appendChild(opt);
        }
      }

      // Set defaults based on AI suggestion
      categorySelect.value = analysis.category;
      populateSubcats(analysis.category);

      // Try to default subcategory to predicted_issue if present
      const predicted = (analysis.predicted_issue || "").toLowerCase();
      for (const o of subcategorySelect.options) {
        if (o.value.toLowerCase() === predicted) {
          o.selected = true;
          break;
        }
      }

      // Update subcategories when category changes
      categorySelect.onchange = () => {
        populateSubcats(categorySelect.value);
      };
    } catch (e) {
      console.warn("Failed to init category selectors", e);
    }
  }

  function resetAnalysis() {
    currentAnalysis = null;
    document.getElementById("analysisSection").classList.add("d-none");
    document.getElementById("resultSection").classList.add("d-none");

    // Reset disabled states and texts
    const editableDescription = document.getElementById("editableDescription");
    if (editableDescription) editableDescription.disabled = false;
    const voiceBtn = document.getElementById("voiceInputBtn");
    if (voiceBtn) voiceBtn.disabled = false;
    const submitBtn = document.getElementById("confirmSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "✅ Submit This Report";
    }

    // Reset category badge styling
    const categoryBadge = document.getElementById("analyzedCategoryBadge");
    if (categoryBadge) {
      categoryBadge.classList.remove("bg-warning", "text-dark");
      categoryBadge.classList.add("bg-primary");
    }
  }

  // Voice Input Functions
  function startVoiceInput() {
    console.log("Voice input requested");

    // Check browser support
    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      showAlert(
        "warning",
        "Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari."
      );
      return;
    }

    const voiceBtn = document.getElementById("voiceInputBtn");
    const textarea = document.getElementById("editableDescription");

    if (isRecording) {
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

      // Store original text
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

        showAlert("danger", errorMessage);
        stopVoiceInput();
      };

      recognition.onend = () => {
        stopVoiceInput();
      };

      // Start recognition
      recognition.start();

      showAlert("info", "Listening... Speak your description now.");
    } catch (error) {
      console.error("Voice input error:", error);
      showAlert("danger", "Voice input failed. Please try typing instead.");
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

  // Complaint Submission
  async function submitComplaint() {
    const token = localStorage.getItem("token");
    if (!token) {
      showAlert("warning", "Please login first to submit a complaint");
      showLoginModal();
      return;
    }

    if (!currentAnalysis) {
      showAlert("warning", "Please analyze the image first before submitting");
      return;
    }

    // Block submissions for non-civic detections
    if (
      currentAnalysis.is_civic === false ||
      currentAnalysis.category === "non_civic"
    ) {
      showAlert(
        "warning",
        "Submission disabled: the image appears non-civic. Please upload a photo showing an actual civic problem."
      );
      return;
    }

    const preview = document.getElementById("preview");
    if (!preview.src) {
      showAlert("warning", "Please select or capture an image first");
      return;
    }

    const formData = new FormData();
    const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");

    // Prepare image data
    if (preview.src.startsWith("data:")) {
      const res = await fetch(preview.src);
      const blob = await res.blob();
      formData.append("image", blob, "capture.jpg");
    } else {
      const fileInput = document.getElementById("imageInput");
      formData.append("image", fileInput.files[0]);
    }

    // Add edited description
    const editedDescription = document.getElementById(
      "editableDescription"
    ).value;
    if (editedDescription !== currentAnalysis.description) {
      formData.append("description", editedDescription);
    }

    // Category/subcategory override
    const categorySelect = document.getElementById("categorySelect");
    const subcategorySelect = document.getElementById("subcategorySelect");
    if (categorySelect && subcategorySelect) {
      if (
        categorySelect.value &&
        categorySelect.value !== currentAnalysis.category
      ) {
        formData.append("category_override", categorySelect.value);
      }
      const aiSub = (currentAnalysis.predicted_issue || "").toLowerCase();
      if (
        subcategorySelect.value &&
        subcategorySelect.value.toLowerCase() !== aiSub
      ) {
        formData.append("subcategory_override", subcategorySelect.value);
      }
    }

    // Show loading state
    confirmSubmitBtn.disabled = true;
    confirmSubmitBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm"></span> Getting location...';

    let locationCaptured = false;

    // Get location
    if ("geolocation" in navigator) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });

        const locationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };

        // Try to get address
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

        showAlert("success", "Location captured successfully!");
      } catch (err) {
        console.warn("Could not get location:", err);
        showAlert(
          "warning",
          "Could not get your location. Please enable location access."
        );
        if (!confirm("Continue without location?")) {
          confirmSubmitBtn.disabled = false;
          confirmSubmitBtn.innerHTML = "✅ Submit This Report";
          return;
        }
      }
    } else {
      showAlert("warning", "Your browser doesn't support location services.");
    }

    // Update button to show submitting state
    confirmSubmitBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm"></span> Submitting...';

    try {
      const response = await apiFetch("/complaints/raise", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (response.ok && data.duplicate === true && data.duplicate_of) {
        // Store a notice so community page can show it
        try {
          sessionStorage.setItem(
            "dupNotice",
            JSON.stringify({
              id: data.duplicate_of,
              vote_count: data.vote_count,
              message:
                data.message ||
                "Similar report found nearby. We've upvoted the existing report for you.",
            })
          );
        } catch (_) {}

        // Redirect to community with highlight parameter
        window.location.href = `community.html?highlight=${encodeURIComponent(
          data.duplicate_of
        )}`;
        return; // stop further handling
      }
      if (response.ok) {
        showResult(data.complaint);

        // Hide analysis section
        document.getElementById("analysisSection").classList.add("d-none");
        currentAnalysis = null;

        showAlert(
          "success",
          `Report submitted successfully!${
            locationCaptured ? " Location data included." : ""
          }`
        );

        // Reset form
        document.getElementById("preview").classList.add("d-none");
        document.getElementById("preview").src = "";
        document.getElementById("imageInput").value = "";
      } else {
        showAlert("danger", data.detail || "Failed to submit complaint");
      }
    } catch (error) {
      showAlert("danger", "Error submitting complaint");
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

  // Utility function for showing alerts
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
    setTimeout(() => alertDiv.remove(), type === "info" ? 3000 : 5000);
  }

  // Make functions available globally for onclick handlers
  window.resetAnalysis = resetAnalysis;
})(); // End of IIFE wrapper
