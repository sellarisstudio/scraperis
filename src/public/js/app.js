/**
 * ScrapMap - Frontend Application
 * Handles search, SSE streaming, results rendering, and exports.
 */

(function () {
  "use strict";

  // ========================
  // Welcome Screen Handler
  // ========================
  const welcomeScreen = document.getElementById("welcome-screen");
  const welcomeStartBtn = document.getElementById("welcome-start-btn");
  const btnResetIntro = document.getElementById("btn-reset-intro");

  if (welcomeScreen && welcomeStartBtn) {
    if (localStorage.getItem("scraperis_intro_dismissed") === "true") {
      welcomeScreen.classList.add("hidden");
    }
    welcomeStartBtn.addEventListener("click", () => {
      welcomeScreen.classList.add("hidden");
      localStorage.setItem("scraperis_intro_dismissed", "true");
    });
  }

  if (btnResetIntro && welcomeScreen) {
    btnResetIntro.addEventListener("click", () => {
      localStorage.removeItem("scraperis_intro_dismissed");
      welcomeScreen.classList.remove("hidden");
      const navScraperBtn = document.getElementById("nav-scraper-btn");
      if (navScraperBtn) navScraperBtn.click();
    });
  }

  // ========================
  // DOM References
  // ========================
  const searchForm = document.getElementById("search-form");
  const searchQuery = document.getElementById("search-query");
  const searchLocation = document.getElementById("search-location");
  const maxResultsSlider = document.getElementById("max-results");
  const sliderValue = document.getElementById("slider-value");
  const btnScrape = document.getElementById("btn-scrape");
  const btnText = document.getElementById("btn-text");
  const btnSpinner = document.getElementById("btn-spinner");

  const searchModeInput = document.getElementById("search-mode");
  const modeMapsBtn = document.getElementById("mode-maps-btn");
  const modeSearchBtn = document.getElementById("mode-search-btn");
  const searchExtraFields = document.getElementById("search-extra-fields");
  const searchPlatformSelect = document.getElementById("search-platform");
  const searchPlatformCustom = document.getElementById(
    "search-platform-custom",
  );
  const searchContactInput = document.getElementById("search-contact");
  const searchTargetSelect = document.getElementById("search-target");
  const configSerpApiKeyInput = document.getElementById("config-serpapi-key");
  const configHeadlessInput = document.getElementById("config-headless");
  const configCaptchaTimeoutInput = document.getElementById("config-captcha-timeout");
  const configPersistentProfileInput = document.getElementById("config-persistent-profile");
  const configShowMapVisualInput = document.getElementById("config-show-map-visual");
  const labelQuery = document.getElementById("label-query");
  const hintQuery = document.getElementById("hint-query");

  const progressSection = document.getElementById("progress-section");
  const progressBar = document.getElementById("progress-bar");
  const progressPercent = document.getElementById("progress-percent");
  const progressStatusText = document.getElementById("progress-status-text");
  const statusDot = document.getElementById("status-dot");
  const progressLogs = document.getElementById("progress-logs");
  const statFound = document.getElementById("stat-found");
  const statQuery = document.getElementById("stat-query");
  const statLocation = document.getElementById("stat-location");

  const btnExportBackup = document.getElementById("btn-export-backup");
  const btnTriggerImport = document.getElementById("btn-trigger-import");
  const inputImportBackup = document.getElementById("input-import-backup");

  const resultsSection = document.getElementById("results-section");
  const resultsTbody = document.getElementById("results-tbody");
  const resultsThead = document.getElementById("results-thead");
  const resultsCount = document.getElementById("results-count");
  const emptyState = document.getElementById("empty-state");

  const btnExportCsv = document.getElementById("btn-export-csv");
  const btnExportExcel = document.getElementById("btn-export-excel");
  const btnSaveAllBasket = document.getElementById("btn-save-all-basket");

  const btnBasketExportCsv = document.getElementById("btn-basket-export-csv");
  const btnBasketExportExcel = document.getElementById(
    "btn-basket-export-excel",
  );
  const btnBasketClear = document.getElementById("btn-basket-clear");
  const basketGroupsContainer = document.getElementById(
    "basket-groups-container",
  );
  const basketCount = document.getElementById("basket-count");
  const basketEmptyState = document.getElementById("basket-empty-state");
  const chkBasketSelectAll = document.getElementById("chk-basket-select-all");
  const basketSelectionBar = document.getElementById("basket-selection-bar");

  const toastContainer = document.getElementById("toast-container");



  const resultsPagination = document.getElementById("results-pagination");
  const resultsPageInfo = document.getElementById("results-page-info");
  const btnResultsPrev = document.getElementById("btn-results-prev");
  const btnResultsNext = document.getElementById("btn-results-next");

  // ========================
  // State
  // ========================
  let currentJobId = null;
  let eventSource = null;
  let results = [];
  let sortColumn = null;
  let sortDirection = "asc";
  let activeScraperMode = "maps";
  let savedLeads = [];
  let uncheckedDates = new Set();
  let sequenceActive = false;
  let subJobResults = [];
  let cancelRequested = false;

  let resultsPage = 1;
  const resultsPerPage = 50;
  const basketPages = {}; // Store current page for each date group, key = dateKey
  const basketPerPage = 50;

  // ========================
  // IndexedDB Helpers
  // ========================
  let dbInstance = null;

  function getDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("ScraperisDB", 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("leads")) {
          db.createObjectStore("leads", { keyPath: "phone" });
        }
      };

      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  // ========================
  // Helper: Get Current Date/Time in Jakarta Timezone
  // ========================
  function getJakartaDateTime() {
    const now = new Date();
    const jakartaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    return jakartaTime.toISOString();
  }

  function getAllLeadsFromDB() {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("leads", "readonly");
        const store = transaction.objectStore("leads");
        const request = store.getAll();

        request.onsuccess = (e) => {
          resolve(e.target.result || []);
        };

        request.onerror = (e) => {
          reject(e.target.error);
        };
      });
    });
  }

  function addLeadToDB(lead) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("leads", "readwrite");
        const store = transaction.objectStore("leads");
        const request = store.put(lead);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    });
  }

  function addLeadsBatchToDB(leads) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("leads", "readwrite");
        const store = transaction.objectStore("leads");

        leads.forEach((lead) => {
          store.put(lead);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      });
    });
  }

  function deleteLeadFromDB(phone) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("leads", "readwrite");
        const store = transaction.objectStore("leads");
        const request = store.delete(phone);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    });
  }

  function deleteLeadsBatchFromDB(phones) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("leads", "readwrite");
        const store = transaction.objectStore("leads");

        phones.forEach((phone) => {
          store.delete(phone);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      });
    });
  }

  function clearAllLeadsFromDB() {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("leads", "readwrite");
        const store = transaction.objectStore("leads");
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    });
  }



  // ========================
  // Sidebar View Switcher
  // ========================
  const navScraperBtn = document.getElementById("nav-scraper-btn");
  const navBasketBtn = document.getElementById("nav-basket-btn");
  const navConfigBtn = document.getElementById("nav-config-btn");
  const navAboutBtn = document.getElementById("nav-about-btn");
  const navLicenseBtn = document.getElementById("nav-license-btn");
  const viewScraper = document.getElementById("view-scraper");
  const viewBasket = document.getElementById("view-basket");
  const viewConfig = document.getElementById("view-config");
  const viewAbout = document.getElementById("view-about");
  const viewLicense = document.getElementById("view-license");

  const switchView = (activeBtn, activeView) => {
    document.querySelectorAll(".a-nav-item").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll(".view-panel").forEach((view) => view.classList.remove("active"));
    activeBtn.classList.add("active");
    activeView.classList.add("active");
  };

  navScraperBtn.addEventListener("click", () => switchView(navScraperBtn, viewScraper));
  navBasketBtn.addEventListener("click", () => switchView(navBasketBtn, viewBasket));
  navConfigBtn.addEventListener("click", () => switchView(navConfigBtn, viewConfig));
  navAboutBtn.addEventListener("click", () => switchView(navAboutBtn, viewAbout));
  navLicenseBtn.addEventListener("click", () => switchView(navLicenseBtn, viewLicense));

  // ========================
  // Configuration Tab Switcher
  // ========================
  const configTabs = document.querySelectorAll(".a-config-tab");
  const configTabContents = document.querySelectorAll(".o-config-tab-content");

  configTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.getAttribute("data-tab");

      configTabs.forEach((t) => t.classList.remove("active"));
      configTabContents.forEach((c) => c.classList.remove("active"));

      tab.classList.add("active");
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add("active");
      }
    });
  });


  // ========================
  // Configuration State
  // ========================
  function saveConfig() {
    const mapsCols = [];
    document
      .querySelectorAll("#config-maps-columns .a-checkbox-input")
      .forEach((cb) => {
        if (cb.checked) mapsCols.push(cb.value);
      });
    const searchCols = [];
    document
      .querySelectorAll("#config-search-columns .a-checkbox-input")
      .forEach((cb) => {
        if (cb.checked) searchCols.push(cb.value);
      });
    const basketCols = [];
    document
      .querySelectorAll("#config-basket-columns .a-checkbox-input")
      .forEach((cb) => {
        if (cb.checked) basketCols.push(cb.value);
      });

    localStorage.setItem("scraperis_config_maps", JSON.stringify(mapsCols));
    localStorage.setItem("scraperis_config_search", JSON.stringify(searchCols));
    localStorage.setItem("scraperis_config_basket", JSON.stringify(basketCols));

    if (configSerpApiKeyInput) {
      localStorage.setItem("scraperis_serpapi_key", configSerpApiKeyInput.value);
    }
    if (configHeadlessInput) {
      localStorage.setItem("scraperis_config_headless", configHeadlessInput.checked);
    }
    if (configCaptchaTimeoutInput) {
      localStorage.setItem("scraperis_config_captcha_timeout", configCaptchaTimeoutInput.value);
    }
    if (configPersistentProfileInput) {
      localStorage.setItem("scraperis_config_persistent_profile", configPersistentProfileInput.checked);
    }
    if (configShowMapVisualInput) {
      localStorage.setItem("scraperis_config_show_map_visual", configShowMapVisualInput.checked);
    }
  }

  function loadConfig() {
    try {
      const mapsSaved =
        localStorage.getItem("scraperis_config_maps") ||
        localStorage.getItem("scrapmap_config_maps");
      if (mapsSaved) {
        const mapsCols = JSON.parse(mapsSaved);
        document
          .querySelectorAll("#config-maps-columns .a-checkbox-input")
          .forEach((cb) => {
            cb.checked = mapsCols.includes(cb.value);
          });
      }

      const searchSaved =
        localStorage.getItem("scraperis_config_search") ||
        localStorage.getItem("scrapmap_config_search");
      if (searchSaved) {
        const searchCols = JSON.parse(searchSaved);
        document
          .querySelectorAll("#config-search-columns .a-checkbox-input")
          .forEach((cb) => {
            cb.checked = searchCols.includes(cb.value);
          });
      }

      const basketSaved =
        localStorage.getItem("scraperis_config_basket") ||
        localStorage.getItem("scrapmap_config_basket");
      if (basketSaved) {
        const basketCols = JSON.parse(basketSaved);
        document
          .querySelectorAll("#config-basket-columns .a-checkbox-input")
          .forEach((cb) => {
            cb.checked = basketCols.includes(cb.value);
          });
      }

      const serpApiKeySaved = localStorage.getItem("scraperis_serpapi_key");
      if (serpApiKeySaved && configSerpApiKeyInput) {
        configSerpApiKeyInput.value = serpApiKeySaved;
      }
      const headlessSaved = localStorage.getItem("scraperis_config_headless");
      if (headlessSaved !== null && configHeadlessInput) {
        configHeadlessInput.checked = headlessSaved === "true";
      }
      const captchaTimeoutSaved = localStorage.getItem("scraperis_config_captcha_timeout");
      if (captchaTimeoutSaved && configCaptchaTimeoutInput) {
        configCaptchaTimeoutInput.value = captchaTimeoutSaved;
      }
      const persistentProfileSaved = localStorage.getItem("scraperis_config_persistent_profile");
      if (persistentProfileSaved !== null && configPersistentProfileInput) {
        configPersistentProfileInput.checked = persistentProfileSaved === "true";
      }
      const showMapVisualSaved = localStorage.getItem("scraperis_config_show_map_visual");
      if (showMapVisualSaved !== null && configShowMapVisualInput) {
        configShowMapVisualInput.checked = showMapVisualSaved === "true";
      }
    } catch (err) {
      console.error("Error loading config:", err);
    }
  }

  function getCheckedColumns(mode) {
    let selector = "#config-maps-columns";
    if (mode === "search") {
      selector = "#config-search-columns";
    } else if (mode === "basket") {
      selector = "#config-basket-columns";
    }
    const cols = [];
    document.querySelectorAll(`${selector} .a-checkbox-input`).forEach((cb) => {
      if (cb.checked) cols.push(cb.value);
    });
    return cols;
  }

  // Bind checkbox changes
  document.querySelectorAll(".a-checkbox-input").forEach((cb) => {
    cb.addEventListener("change", saveConfig);
  });

  if (configSerpApiKeyInput) {
    configSerpApiKeyInput.addEventListener("input", saveConfig);
  }

  if (configCaptchaTimeoutInput) {
    configCaptchaTimeoutInput.addEventListener("input", saveConfig);
  }

  // Load config on startup
  loadConfig();

  // ========================
  // Mode Selector Toggle
  // ========================
  modeMapsBtn.addEventListener("click", () => {
    switchMode("maps");
  });

  modeSearchBtn.addEventListener("click", () => {
    switchMode("search");
  });

  function switchMode(mode) {
    if (sequenceActive) return; // Prevent switching mode while scraping
    if (mode === activeScraperMode) return;
    activeScraperMode = mode;
    searchModeInput.value = mode;

    if (mode === "maps") {
      modeMapsBtn.classList.add("active");
      modeSearchBtn.classList.remove("active");
      searchExtraFields.style.display = "none";

      labelQuery.textContent = "🔍 Business Keyword";
      hintQuery.textContent =
        "What type of business are you looking for? (One keyword per line)";
      searchQuery.placeholder = "e.g. Kedai kopi\nCoffee shop\nCafe";
    } else {
      modeMapsBtn.classList.remove("active");
      modeSearchBtn.classList.add("active");
      searchExtraFields.style.display = "grid";

      labelQuery.textContent = "🔍 Search Keyword (Category)";
      hintQuery.textContent =
        "What business category/niche to look for? (One keyword per line)";
      searchQuery.placeholder = "e.g. Coffee\nEsteh\nToko";
    }
  }

  // Handle custom platform option
  searchPlatformSelect.addEventListener("change", () => {
    if (searchPlatformSelect.value === "custom") {
      searchPlatformCustom.style.display = "block";
      searchPlatformCustom.required = true;
    } else {
      searchPlatformCustom.style.display = "none";
      searchPlatformCustom.required = false;
    }
  });

  // ========================
  // Slider
  // ========================
  maxResultsSlider.addEventListener("input", () => {
    sliderValue.textContent = maxResultsSlider.value;
  });

  // ========================
  // Search Form
  // ========================
  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (sequenceActive) {
      // Handle stop request
      cancelRequested = true;
      showToast("Stopping scrape sequence...", "info");

      if (currentJobId) {
        try {
          await fetch(`/api/scrape/${currentJobId}`, { method: "DELETE" });
        } catch (err) {
          console.error("Error canceling current job:", err);
        }
      }

      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      sequenceActive = false;
      setFormLoading(false);

      progressStatusText.textContent = "Scraping stopped by user.";
      statusDot.className = "status-dot error";

      if (results.length > 0) {
        btnExportCsv.disabled = false;
        btnExportExcel.disabled = false;
        btnSaveAllBasket.disabled = false;
      }
      return;
    }

    const queries = searchQuery.value
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);
    const locations = searchLocation.value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const maxResults = parseInt(maxResultsSlider.value);
    const mode = searchModeInput.value;
    const autoSaveBasket =
      document.getElementById("chk-auto-save-basket")?.checked || false;
    const skipNoPhoneVal =
      document.getElementById("chk-skip-no-phone")?.checked ?? true;
    const headlessVal = configHeadlessInput ? configHeadlessInput.checked : true;
    const captchaTimeoutVal = configCaptchaTimeoutInput ? parseInt(configCaptchaTimeoutInput.value) || 60 : 60;
    const usePersistentVal = configPersistentProfileInput ? configPersistentProfileInput.checked : true;

    let platform = "";
    let contactPrefix = "";
    let searchTarget = "";
    let serpApiKey = "";

    if (mode === "search") {
      searchTarget = searchTargetSelect ? searchTargetSelect.value : "google";
      serpApiKey = configSerpApiKeyInput ? configSerpApiKeyInput.value.trim() : "";

      if (searchTarget === "serpapi" && !serpApiKey) {
        showToast("Please enter your SerpApi API Key in the Configuration Panel.", "error");
        return;
      }

      platform =
        searchPlatformSelect.value === "custom"
          ? searchPlatformCustom.value.trim()
          : searchPlatformSelect.value;
      contactPrefix = searchContactInput.value.trim();

      if (!platform) {
        showToast("Please specify a platform.", "error");
        return;
      }
    }

    if (queries.length === 0 || locations.length === 0) {
      showToast("Please fill in both keywords and locations.", "error");
      return;
    }

    // Set state
    sequenceActive = true;
    cancelRequested = false;
    setFormLoading(true);

    // Reset global results and UI
    results = [];
    resultsTbody.innerHTML = "";
    progressLogs.innerHTML = "";
    progressBar.style.width = "0%";
    progressBar.classList.remove("done");
    progressPercent.textContent = "0%";
    statusDot.className = "status-dot";
    progressStatusText.textContent = "Starting sequence...";
    statFound.textContent = "0";
    statQuery.textContent =
      mode === "search" ? `${platform} -> ${queries[0]}` : queries[0];
    statLocation.textContent = locations[0];
    emptyState.style.display = "none";

    // Render appropriate table header
    renderTableHeader(mode);

    // Show sections
    progressSection.classList.add("active");
    resultsSection.classList.add("active");

    // Disable export
    btnExportCsv.disabled = true;
    btnExportExcel.disabled = true;
    btnSaveAllBasket.disabled = true;

    // Scroll to progress
    progressSection.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const totalSteps = queries.length * locations.length;
      let currentStep = 0;

      for (let qIdx = 0; qIdx < queries.length; qIdx++) {
        const query = queries[qIdx];

        for (let lIdx = 0; lIdx < locations.length; lIdx++) {
          const location = locations[lIdx];

          if (cancelRequested) {
            break;
          }

          currentStep++;

          // Update status stats
          statQuery.textContent =
            mode === "search" ? `${platform} -> ${query}` : query;
          statLocation.textContent = location;
          progressStatusText.textContent = `Scraping [${currentStep}/${totalSteps}]: ${query} in ${location}...`;

          addLogEntry(`--------------------------------------------------`);
          addLogEntry(
            `🚀 [${currentStep}/${totalSteps}] Scraping: "${query}" in "${location}"`,
          );
          addLogEntry(`--------------------------------------------------`);

          // Start current sub-job and wait for it
          subJobResults = [];

          const success = await runSubJob(
            query,
            location,
            maxResults,
            mode,
            platform,
            contactPrefix,
            currentStep,
            totalSteps,
            searchTarget,
            serpApiKey,
            headlessVal,
            captchaTimeoutVal,
            usePersistentVal,
            skipNoPhoneVal,
          );

          if (cancelRequested) {
            break;
          }

          if (success) {
            addLogEntry(
              `✅ Finished scraping "${query}" in "${location}". Found ${subJobResults.length} leads.`,
            );

            // Auto save to basket if enabled
            if (autoSaveBasket && subJobResults.length > 0) {
              addLogEntry(
                `📥 Auto-saving ${subJobResults.length} leads to Leads Basket...`,
              );
              saveSubJobLeadsToBasket(subJobResults);
            }
          } else {
            addLogEntry(
              `⚠️ Sub-job failed or ended with warning for "${query}" in "${location}".`,
            );
          }
        }
        if (cancelRequested) {
          break;
        }
      }

      // Sequence completed or stopped
      sequenceActive = false;
      setFormLoading(false);

      if (cancelRequested) {
        progressStatusText.textContent = "Scraping sequence stopped.";
        statusDot.className = "status-dot error";
        showToast("Scraping sequence stopped.", "warning");
      } else {
        progressBar.classList.add("done");
        statusDot.classList.add("done");
        progressStatusText.textContent = `Scraping complete! Found ${results.length} total businesses.`;
        updateProgress(100);
        showToast(
          `All jobs completed! Found ${results.length} total leads.`,
          "success",
        );
      }

      if (results.length > 0) {
        btnExportCsv.disabled = false;
        btnExportExcel.disabled = false;
        btnSaveAllBasket.disabled = false;
      }
    } catch (err) {
      sequenceActive = false;
      setFormLoading(false);
      showToast(err.message, "error");
      progressStatusText.textContent = "Error: " + err.message;
      statusDot.className = "status-dot error";

      if (results.length > 0) {
        btnExportCsv.disabled = false;
        btnExportExcel.disabled = false;
        btnSaveAllBasket.disabled = false;
      }
    }
  });

  function runSubJob(
    query,
    location,
    maxResults,
    mode,
    platform,
    contactPrefix,
    currentStep,
    totalSteps,
    searchTarget,
    serpApiKey,
    headless,
    captchaTimeout,
    usePersistent,
    skipNoPhone = true,
  ) {
    return new Promise(async (resolve) => {
      try {
        const response = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            location,
            maxResults,
            mode,
            platform,
            contactPrefix,
            searchTarget,
            serpApiKey,
            headless,
            captchaTimeout,
            usePersistent,
            skipNoPhone,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          addLogEntry(`❌ Server error: ${err.error}`);
          resolve(false);
          return;
        }

        const data = await response.json();
        currentJobId = data.id;

        // Connect SSE with resolver
        connectSubJobSSE(currentJobId, resolve, currentStep, totalSteps);
      } catch (err) {
        addLogEntry(`❌ Connection error: ${err.message}`);
        resolve(false);
      }
    });
  }

  function connectSubJobSSE(jobId, resolve, currentStep, totalSteps) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/scrape/${jobId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSubJobSSEEvent(payload, resolve, currentStep, totalSteps);
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      resolve(false);
    };
  }

  function handleSubJobSSEEvent(payload, resolve, currentStep, totalSteps) {
    const { event, data } = payload;

    switch (event) {
      case "init":
        if (data.progress) {
          updateSubJobProgress(data.progress, currentStep, totalSteps);
        }
        if (data.results && data.results.length > 0) {
          data.results.forEach((r) => {
            const isDuplicate = results.some(
              (item) =>
                (activeScraperMode === "search" &&
                  item.url === r.url &&
                  item.title === r.title) ||
                (activeScraperMode === "maps" &&
                  item.name === r.name &&
                  item.address === r.address),
            );
            if (!isDuplicate) {
              addResultRow(r);
              subJobResults.push(r);
            }
          });
        }
        if (data.logs) {
          data.logs.forEach((log) => addLogEntry(log.message));
        }
        break;

      case "progress":
        updateSubJobProgress(data.progress, currentStep, totalSteps);
        if (data.message) addLogEntry(data.message);
        break;

      case "result":
        const r = data.result;
        const isDuplicate = results.some(
          (item) =>
            (activeScraperMode === "search" &&
              item.url === r.url &&
              item.title === r.title) ||
            (activeScraperMode === "maps" &&
              item.name === r.name &&
              item.address === r.address),
        );
        if (!isDuplicate) {
          addResultRow(r);
          subJobResults.push(r);
          statFound.textContent = results.length;
        }
        break;

      case "status":
        if (data.status === "completed") {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          resolve(true);
        } else if (data.status === "failed") {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          resolve(false);
        }
        break;

      case "error":
        addLogEntry(`❌ Scraper error: ${data.error}`);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        resolve(false);
        break;

      case "done":
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        resolve(true);
        break;
    }
  }

  function updateSubJobProgress(subPercent, currentStep, totalSteps) {
    const overallPercent =
      ((currentStep - 1 + subPercent / 100) / totalSteps) * 100;
    const p = Math.min(Math.round(overallPercent), 100);
    progressBar.style.width = p + "%";
    progressPercent.textContent = p + "%";
  }

  function buildBasketItem(lead, savedAt) {
    const rawPhone = lead.phone ? String(lead.phone).trim() : "";
    const uniqueKey = rawPhone || `NO_PHONE_${(lead.name || lead.title || 'lead').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let desc = lead.description || "";
    const leadName = lead.name || lead.title || "";
    if (!desc && leadName) {
      const catText = (lead.category || lead.platform) ? `usaha di bidang ${lead.category || lead.platform}` : 'bisnis';
      const locText = (lead.address && lead.address !== "—") ? `beralamat di ${lead.address}` : (lead.daerah ? `berlokasi di daerah ${lead.daerah}` : '');
      desc = `${leadName} merupakan ${catText}${locText ? ` yang ${locText}` : ''}.`;
      if (rawPhone && !rawPhone.startsWith("NO_PHONE_")) {
        desc += ` Untuk informasi lebih lanjut atau pemesanan dapat menghubungi nomor telepon ${rawPhone}.`;
      }
      if (lead.socialMedia) {
        desc += ` Akun media sosial resmi: ${lead.socialMedia}.`;
      } else if (lead.website) {
        desc += ` Website resmi: ${lead.website}.`;
      }
      desc = desc.trim();
    }

    return {
      name: lead.name || lead.title || "—",
      category: lead.category || lead.platform || "—",
      daerah: lead.daerah || "",
      rating: lead.rating != null ? lead.rating : null,
      reviewCount: lead.reviewCount != null ? lead.reviewCount : null,
      phone: uniqueKey,
      email: lead.email || "",
      address: lead.address || lead.snippet || "—",
      website: lead.website || "",
      lat: lead.lat != null ? lead.lat : null,
      lng: lead.lng != null ? lead.lng : null,
      description: desc,
      priceRange: lead.priceRange || "",
      status: lead.status || "",
      claimed: lead.claimed || "",
      socialMedia: lead.socialMedia || "",
      menuUrl: lead.menuUrl || "",
      reservationUrl: lead.reservationUrl || "",
      thumbnail: lead.thumbnail || "",
      plusCode: lead.plusCode || "",
      hours: lead.hours || "",
      source: lead.mapsUrl ? "Maps" : "Search",
      url: lead.mapsUrl || lead.website || lead.url || "",
      mapsUrl: lead.mapsUrl || "",
      savedAt: savedAt || getJakartaDateTime(),
    };
  }

  function saveSubJobLeadsToBasket(subResults) {
    if (!subResults || subResults.length === 0) return;

    const batchItems = [];
    const now = getJakartaDateTime();
    subResults.forEach((lead) => {
      const basketItem = buildBasketItem(lead, now);

      const exists = savedLeads.some((item) => 
        (basketItem.phone.startsWith("NO_PHONE_") 
          ? (item.name === basketItem.name && item.address === basketItem.address)
          : item.phone === basketItem.phone)
      );
      if (!exists) {
        batchItems.push(basketItem);
      }
    });

    if (batchItems.length > 0) {
      addLeadsBatchToDB(batchItems)
        .then(() => {
          savedLeads = savedLeads.concat(batchItems);
          renderBasketTable();
          showToast(
            `Auto-saved ${batchItems.length} new leads to basket!`,
            "success",
          );
        })
        .catch((err) => {
          console.error(err);
        });
    }
  }

  // ========================
  // SSE Connection
  // ========================
  function connectSSE(jobId) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/scrape/${jobId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSSEEvent(payload);
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    eventSource.onerror = () => {
      // SSE connection closed (normal on completion)
      eventSource.close();
      eventSource = null;
    };
  }

  function handleSSEEvent(payload) {
    const { event, data } = payload;

    switch (event) {
      case "init":
        // Initial state sync
        if (data.mode) {
          activeScraperMode = data.mode;
          renderTableHeader(data.mode);
        }
        if (data.progress) updateProgress(data.progress);
        if (data.results && data.results.length > 0) {
          data.results.forEach((r) => addResultRow(r));
        }
        if (data.logs) {
          data.logs.forEach((log) => addLogEntry(log.message));
        }
        break;

      case "progress":
        updateProgress(data.progress);
        if (data.message) addLogEntry(data.message);
        break;

      case "result":
        addResultRow(data.result);
        statFound.textContent = data.totalFound;
        break;

      case "status":
        if (data.status === "completed") {
          onScrapeComplete();
        } else if (data.status === "failed") {
          onScrapeFailed();
        }
        break;

      case "error":
        onScrapeFailed(data.error);
        break;

      case "done":
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        break;
    }
  }

  // ========================
  // Progress Updates
  // ========================
  function updateProgress(percent) {
    const p = Math.min(Math.round(percent), 100);
    progressBar.style.width = p + "%";
    progressPercent.textContent = p + "%";
  }

  function addLogEntry(message) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const now = new Date();
    const time = now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span>${escapeHtml(message)}</span>
    `;

    progressLogs.appendChild(entry);
    progressLogs.scrollTop = progressLogs.scrollHeight;
  }

  function onScrapeComplete() {
    setFormLoading(false);
    progressBar.classList.add("done");
    statusDot.classList.add("done");
    progressStatusText.textContent = `Scraping complete! Found ${results.length} businesses.`;
    updateProgress(100);

    if (results.length > 0) {
      btnExportCsv.disabled = false;
      btnExportExcel.disabled = false;
      btnSaveAllBasket.disabled = false;
    }

    showToast(`Done! ${results.length} businesses extracted.`, "success");
  }

  function onScrapeFailed(error) {
    setFormLoading(false);
    statusDot.classList.add("error");
    progressStatusText.textContent =
      "Scraping failed" + (error ? ": " + error : "");
    showToast("Scraping failed. Please try again.", "error");

    // Still enable export if we got some results
    if (results.length > 0) {
      btnExportCsv.disabled = false;
      btnExportExcel.disabled = false;
      btnSaveAllBasket.disabled = false;
    }
  }

  // ========================
  // Table Header Switcher
  // ========================
  function renderTableHeader(mode) {
    if (mode === "search") {
      resultsThead.innerHTML = `
        <tr>
          <th data-sort="index">No <span class="sort-icon">↕</span></th>
          <th data-sort="title">Page Title <span class="sort-icon">↕</span></th>
          <th data-sort="platform">Platform <span class="sort-icon">↕</span></th>
          <th data-sort="phone">Phone <span class="sort-icon">↕</span></th>
          <th data-sort="url">Link <span class="sort-icon">↕</span></th>
          <th data-sort="snippet">Snippet Preview <span class="sort-icon">↕</span></th>
          <th>Action</th>
        </tr>
      `;
    } else {
      resultsThead.innerHTML = `
        <tr>
          <th data-sort="index">No <span class="sort-icon">↕</span></th>
          <th data-sort="name">Business Name <span class="sort-icon">↕</span></th>
          <th data-sort="category">Category <span class="sort-icon">↕</span></th>
          <th data-sort="rating">Rating <span class="sort-icon">↕</span></th>
          <th data-sort="reviewCount">Reviews <span class="sort-icon">↕</span></th>
          <th data-sort="address">Address <span class="sort-icon">↕</span></th>
          <th data-sort="phone">Phone <span class="sort-icon">↕</span></th>
          <th>Website</th>
          <th>Maps</th>
          <th>Action</th>
        </tr>
      `;
    }

    // Rebind sort listeners to new headers
    bindSortHeaders();
  }

  // ========================
  // Results Table Row Insertion
  // ========================
  function addResultRow(result) {
    results.push(result);
    renderResultsTable();
  }

  function renderResultsTable() {
    emptyState.style.display = results.length === 0 ? "block" : "none";
    resultsCount.textContent = `(${results.length})`;

    // Sort results
    const sorted = [...results];
    if (sortColumn) {
      sorted.sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        if (aVal == null) aVal = "";
        if (bVal == null) bVal = "";

        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
        }

        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        if (sortDirection === "asc") {
          return aVal.localeCompare(bVal);
        }
        return bVal.localeCompare(aVal);
      });
    } else {
      // Default: newest first (order descending by index)
      sorted.sort((a, b) => (b.index || 0) - (a.index || 0));
    }

    // Pagination
    const totalPages = Math.ceil(sorted.length / resultsPerPage) || 1;
    if (resultsPage > totalPages) resultsPage = totalPages;
    if (resultsPage < 1) resultsPage = 1;

    const start = (resultsPage - 1) * resultsPerPage;
    const end = Math.min(start + resultsPerPage, sorted.length);
    const paginatedResults = sorted.slice(start, end);

    resultsTbody.innerHTML = "";

    paginatedResults.forEach((r) => {
      const tr = document.createElement("tr");
      if (activeScraperMode === "search") {
        tr.innerHTML = `
          <td>${r.index || ""}</td>
          <td class="cell-name" title="${escapeAttr(r.title)}">${escapeHtml(r.title)}</td>
          <td><span class="cell-category">${escapeHtml(r.platform)}</span></td>
          <td class="cell-phone">${r.phone ? escapeHtml(r.phone) : ""}</td>
          <td class="cell-link">${r.url ? `<a href="${escapeAttr(r.url)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
          <td class="cell-address" title="${escapeAttr(r.snippet)}">${escapeHtml(r.snippet || "—")}</td>
          <td><button type="button" class="a-btn a-btn-accent save-lead-btn" style="padding: 2px 8px; font-size: var(--font-size-xs);"><i data-lucide="plus" class="icon-sm"></i> Basket</button></td>
        `;
      } else {
        const badges = [];
        if (r.daerah) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:var(--color-accent-light, #e0e7ff); color:var(--color-accent, #4f46e5); font-weight:600;">📍 ${escapeHtml(r.daerah)}</span>`);
        if (r.priceRange) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(34, 197, 94, 0.15); color:#16a34a; font-weight:600;">💰 ${escapeHtml(r.priceRange)}</span>`);
        if (r.status) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(234, 179, 8, 0.15); color:#ca8a04; font-weight:600;">🕒 ${escapeHtml(r.status)}</span>`);
        if (r.claimed && r.claimed.includes('Claimed')) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(59, 130, 246, 0.15); color:#2563eb; font-weight:600;">✓ Verified</span>`);
        if (r.socialMedia) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(236, 72, 153, 0.15); color:#db2777; font-weight:600;">🔗 Social</span>`);

        const badgeHtml = badges.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">${badges.join('')}</div>` : '';
        const descHtml = r.description ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:3px; max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(r.description)}">💬 ${escapeHtml(r.description)}</div>` : '';

        tr.innerHTML = `
          <td>${r.index || ""}</td>
          <td class="cell-name" title="${escapeAttr(r.name)}">
            <div style="font-weight:600;">${escapeHtml(r.name)}</div>
            ${badgeHtml}
            ${descHtml}
          </td>
          <td><span class="cell-category" title="${escapeAttr(r.category)}">${escapeHtml(r.category || "—")}</span></td>
          <td class="cell-rating">${r.rating ? `<span class="star">★</span> ${r.rating}` : "—"}</td>
          <td class="cell-reviews">${r.reviewCount != null ? formatNumber(r.reviewCount) : "—"}</td>
          <td class="cell-address" title="${escapeAttr(r.address)}">${escapeHtml(r.address || "—")}</td>
          <td class="cell-phone">${r.phone ? escapeHtml(r.phone) : ""}</td>
          <td class="cell-link">${r.website ? `<a href="${escapeAttr(r.website)}" target="_blank" rel="noopener">Visit ↗</a>` : "—"}</td>
          <td class="cell-link">${r.mapsUrl ? `<a href="${escapeAttr(r.mapsUrl)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
          <td><button type="button" class="a-btn a-btn-accent save-lead-btn" style="padding: 2px 8px; font-size: var(--font-size-xs);"><i data-lucide="plus" class="icon-sm"></i> Basket</button></td>
        `;
      }

      const btn = tr.querySelector(".save-lead-btn");
      if (btn) {
        btn.addEventListener("click", () => {
          saveLeadToBasket(r);
        });
      }

      resultsTbody.appendChild(tr);
    });

    if (window.lucide) {
      window.lucide.createIcons({
        nameAttr: "data-lucide",
        root: resultsTbody,
      });
    }

    // Update pagination controls UI
    if (sorted.length > resultsPerPage) {
      resultsPagination.style.display = "flex";
      resultsPageInfo.textContent = `Showing ${sorted.length ? start + 1 : 0} to ${end} of ${sorted.length} entries`;
      btnResultsPrev.disabled = resultsPage === 1;
      btnResultsNext.disabled = resultsPage === totalPages;
    } else {
      resultsPagination.style.display = "none";
    }
  }

  // ========================
  // Sorting
  // ========================
  function bindSortHeaders() {
    document.querySelectorAll(".results-table th[data-sort]").forEach((th) => {
      // Avoid duplicate binding
      th.replaceWith(th.cloneNode(true));
    });

    document.querySelectorAll(".results-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.sort;

        if (sortColumn === col) {
          sortDirection = sortDirection === "asc" ? "desc" : "asc";
        } else {
          sortColumn = col;
          sortDirection = "asc";
        }

        // Update UI
        document
          .querySelectorAll(".results-table th")
          .forEach((h) => h.classList.remove("sorted"));
        th.classList.add("sorted");
        th.querySelector(".sort-icon").textContent =
          sortDirection === "asc" ? "↑" : "↓";

        // Sort results
        const sorted = [...results].sort((a, b) => {
          let aVal = a[col];
          let bVal = b[col];

          // Handle nulls
          if (aVal == null) aVal = "";
          if (bVal == null) bVal = "";

          // Numeric sort
          if (typeof aVal === "number" && typeof bVal === "number") {
            return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
          }

          // String sort
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
          if (sortDirection === "asc") {
            return aVal.localeCompare(bVal);
          }
          return bVal.localeCompare(aVal);
        });

        // Re-render
        resultsTbody.innerHTML = "";
        sorted.forEach((r) => {
          const tr = document.createElement("tr");
          if (activeScraperMode === "search") {
            tr.innerHTML = `
              <td>${r.index || ""}</td>
              <td class="cell-name" title="${escapeAttr(r.title)}">${escapeHtml(r.title)}</td>
              <td><span class="cell-category">${escapeHtml(r.platform)}</span></td>
              <td class="cell-phone">${r.phone ? escapeHtml(r.phone) : ""}</td>
              <td class="cell-link">${r.url ? `<a href="${escapeAttr(r.url)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
              <td class="cell-address" title="${escapeAttr(r.snippet)}">${escapeHtml(r.snippet || "—")}</td>
              <td><button type="button" class="btn-delete save-lead-btn" style="color: var(--color-accent); border-color: var(--color-accent-light);">➕ Basket</button></td>
            `;
          } else {
            tr.innerHTML = `
              <td>${r.index || ""}</td>
              <td class="cell-name" title="${escapeAttr(r.name)}">${escapeHtml(r.name)}</td>
              <td><span class="cell-category" title="${escapeAttr(r.category)}">${escapeHtml(r.category || "—")}</span></td>
              <td class="cell-rating">${r.rating ? `<span class="star">★</span> ${r.rating}` : "—"}</td>
              <td class="cell-reviews">${r.reviewCount != null ? formatNumber(r.reviewCount) : "—"}</td>
              <td class="cell-address" title="${escapeAttr(r.address)}">${escapeHtml(r.address || "—")}</td>
              <td class="cell-phone">${r.phone ? escapeHtml(r.phone) : ""}</td>
              <td class="cell-link">${r.website ? `<a href="${escapeAttr(r.website)}" target="_blank" rel="noopener">Visit ↗</a>` : "—"}</td>
              <td class="cell-link">${r.mapsUrl ? `<a href="${escapeAttr(r.mapsUrl)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
              <td><button type="button" class="btn-delete save-lead-btn" style="color: var(--color-accent); border-color: var(--color-accent-light);">➕ Basket</button></td>
            `;
          }

          const btn = tr.querySelector(".save-lead-btn");
          if (btn) {
            btn.addEventListener("click", () => {
              saveLeadToBasket(r);
            });
          }

          resultsTbody.appendChild(tr);
        });
      });
    });
  }

  // Initialize sorting binding on startup
  bindSortHeaders();

  // ========================
  // Export
  // ========================
  btnExportCsv.addEventListener("click", () => {
    if (!currentJobId) return;
    const cols = getCheckedColumns(activeScraperMode).join(",");
    window.open(
      `/api/export/${currentJobId}/csv?columns=${encodeURIComponent(cols)}`,
      "_blank",
    );
    showToast("CSV download started!", "success");
  });

  btnExportExcel.addEventListener("click", () => {
    if (!currentJobId) return;
    const cols = getCheckedColumns(activeScraperMode).join(",");
    window.open(
      `/api/export/${currentJobId}/xlsx?columns=${encodeURIComponent(cols)}`,
      "_blank",
    );
    showToast("Excel download started!", "success");
  });

  // ========================
  // Form UI Helpers
  // ========================
  function setFormLoading(loading) {
    searchQuery.disabled = loading;
    searchLocation.disabled = loading;
    maxResultsSlider.disabled = loading;
    modeMapsBtn.disabled = loading;
    modeSearchBtn.disabled = loading;
    searchPlatformSelect.disabled = loading;
    searchPlatformCustom.disabled = loading;
    searchContactInput.disabled = loading;
    if (searchTargetSelect) {
      searchTargetSelect.disabled = loading;
    }
    if (configPersistentProfileInput) {
      configPersistentProfileInput.disabled = loading;
    }

    if (loading) {
      btnScrape.classList.remove("a-btn-primary");
      btnScrape.classList.add("a-btn-danger");
      btnText.innerHTML =
        '<i data-lucide="square" class="icon-sm"></i> Stop Scraping';
      btnSpinner.style.display = "none";

      btnExportCsv.disabled = true;
      btnExportExcel.disabled = true;
      btnSaveAllBasket.disabled = true;
    } else {
      btnScrape.classList.add("a-btn-primary");
      btnScrape.classList.remove("a-btn-danger");
      btnText.innerHTML =
        '<i data-lucide="play" class="icon-sm"></i> Start Scraping';
      btnSpinner.style.display = "none";

      if (results && results.length > 0) {
        btnExportCsv.disabled = false;
        btnExportExcel.disabled = false;
        btnSaveAllBasket.disabled = false;
      }
    }

    if (window.lucide) {
      window.lucide.createIcons({
        nameAttr: "data-lucide",
        root: btnScrape,
      });
    }
  }

  // ========================
  // Toast Notifications
  // ========================
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `m-toast m-toast-${type}`;

    const iconName =
      type === "success"
        ? "check-circle"
        : type === "error"
          ? "alert-triangle"
          : "info";

    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    if (window.lucide) {
      window.lucide.createIcons({
        nameAttr: "data-lucide",
        root: toast,
      });
    }

    // Auto-remove after 4 seconds
    setTimeout(() => {
      toast.classList.add("toast-exit");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ========================
  // Utility Functions
  // ========================
  function escapeHtml(str) {
    if (!str) return "";
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  }

  function escapeAttr(str) {
    if (!str) return "";
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatNumber(num) {
    if (num == null) return "—";
    return num.toLocaleString("id-ID");
  }

  // ========================
  // Keyboard Shortcut
  // ========================
  document.addEventListener("keydown", (e) => {
    // Ctrl+Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (!btnScrape.disabled) {
        searchForm.dispatchEvent(new Event("submit"));
      }
    }
  });

  // ========================
  // Basket Operations & UI
  // ========================
  function saveLeadToBasket(lead) {
    if (!lead) return;

    const basketItem = buildBasketItem(lead);

    const exists = savedLeads.some((item) => 
      (basketItem.phone.startsWith("NO_PHONE_") 
        ? (item.name === basketItem.name && item.address === basketItem.address)
        : item.phone === basketItem.phone)
    );
    if (exists) {
      showToast(
        `Lead ${basketItem.name} sudah ada di basket!`,
        "info",
      );
      return;
    }

    addLeadToDB(basketItem)
      .then(() => {
        savedLeads.push(basketItem);
        renderBasketTable();
        showToast(`Saved to basket: ${basketItem.name}`, "success");
      })
      .catch((err) => {
        console.error(err);
        showToast("Gagal menyimpan ke database.", "error");
      });
  }

  function saveAllLeadsToBasket() {
    if (results.length === 0) return;

    const batchItems = [];
    const now = getJakartaDateTime();
    results.forEach((lead) => {
      const basketItem = buildBasketItem(lead, now);

      const exists = savedLeads.some((item) => 
        (basketItem.phone.startsWith("NO_PHONE_") 
          ? (item.name === basketItem.name && item.address === basketItem.address)
          : item.phone === basketItem.phone)
      );
      if (!exists) {
        batchItems.push(basketItem);
      }
    });

    if (batchItems.length > 0) {
      addLeadsBatchToDB(batchItems)
        .then(() => {
          savedLeads = savedLeads.concat(batchItems);
          renderBasketTable();
          showToast(
            `Berhasil menambahkan ${batchItems.length} lead baru ke basket!`,
            "success",
          );
        })
        .catch((err) => {
          console.error(err);
          showToast("Gagal menyimpan ke database.", "error");
        });
    } else {
      showToast("All leads are already in the basket (duplicates skipped).", "info");
    }
  }

  function formatDateGroup(dateString) {
    if (!dateString || dateString === "Older") return "Older";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return dateString;
    }
  }

  function deleteGroupLeads(dateKey, dateLabel) {
    if (confirm(`Are you sure you want to delete all leads from group "${dateLabel}"?`)) {
      const itemsToDelete = savedLeads.filter((item) => {
        const itemKey = item.savedAt
          ? item.savedAt.substring(0, 10)
          : "Older";
        return itemKey === dateKey;
      });
      const phonesToDelete = itemsToDelete.map((item) => item.phone);

      deleteLeadsBatchFromDB(phonesToDelete)
        .then(() => {
          savedLeads = savedLeads.filter(
            (item) => !phonesToDelete.includes(item.phone),
          );
          renderBasketTable();
          showToast(`Group "${dateLabel}" successfully deleted.`, "info");
        })
        .catch((err) => {
          console.error(err);
          showToast("Failed to delete from database.", "error");
        });
    }
  }

  function renderBasketTable() {
    basketGroupsContainer.innerHTML = "";
    basketCount.textContent = `(${savedLeads.length})`;

    const sidebarBadge = document.getElementById("sidebar-basket-badge");
    if (sidebarBadge) {
      sidebarBadge.textContent = savedLeads.length;
      sidebarBadge.style.display =
        savedLeads.length > 0 ? "inline-block" : "none";
    }

    if (savedLeads.length === 0) {
      basketEmptyState.style.display = "block";
      if (basketSelectionBar) basketSelectionBar.style.display = "none";
      btnBasketExportCsv.disabled = true;
      btnBasketExportExcel.disabled = true;
      btnBasketClear.disabled = true;
      return;
    }

    basketEmptyState.style.display = "none";
    if (basketSelectionBar) basketSelectionBar.style.display = "flex";
    btnBasketExportCsv.disabled = false;
    btnBasketExportExcel.disabled = false;
    btnBasketClear.disabled = false;

    // Group leads by savedAt date part (YYYY-MM-DD)
    const groups = {};
    savedLeads.forEach((item) => {
      const dateKey = item.savedAt
        ? item.savedAt.substring(0, 10)
        : "Older";
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(item);
    });

    // Sort date keys descending (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === "Older") return 1;
      if (b === "Older") return -1;
      return b.localeCompare(a);
    });

    sortedKeys.forEach((dateKey) => {
      const groupLeads = groups[dateKey];
      const dateLabel =
        dateKey === "Older" ? "Older" : formatDateGroup(dateKey);

      // Pagination calculation for date group
      if (!basketPages[dateKey]) basketPages[dateKey] = 1;
      const totalGroupPages = Math.ceil(groupLeads.length / basketPerPage) || 1;
      if (basketPages[dateKey] > totalGroupPages)
        basketPages[dateKey] = totalGroupPages;
      if (basketPages[dateKey] < 1) basketPages[dateKey] = 1;

      const groupStart = (basketPages[dateKey] - 1) * basketPerPage;
      const groupEnd = Math.min(groupStart + basketPerPage, groupLeads.length);
      const paginatedGroupLeads = groupLeads.slice(groupStart, groupEnd);

      const groupDiv = document.createElement("div");
      groupDiv.className = "o-basket-group";
      groupDiv.style.marginBottom = "var(--space-6)";

      const isChecked = !uncheckedDates.has(dateKey);
      groupDiv.innerHTML = `
        <div class="m-basket-group-header" style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); background: var(--color-background); border: 1px solid var(--color-border); border-bottom: none; border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md); font-weight: 600; cursor: pointer; user-select: none;">
          <span style="display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-primary);">
            <input type="checkbox" class="a-checkbox-input basket-group-checkbox" data-date="${dateKey}" ${isChecked ? "checked" : ""} style="margin-right: 8px;" onclick="event.stopPropagation();" />
            <i data-lucide="chevron-down" class="group-collapse-icon icon-sm" style="transition: transform var(--transition-fast);"></i>
            <i data-lucide="calendar" class="icon-accent icon-sm"></i>
            <span>${escapeHtml(dateLabel)}</span>
            <span class="a-badge" style="background: var(--color-accent-light); color: var(--color-accent); font-weight:600;">${groupLeads.length} Leads</span>
          </span>
          <div style="display: flex; align-items: center;" onclick="event.stopPropagation();">
            <button type="button" class="a-btn a-btn-danger remove-group-btn" style="padding: 2px 8px; font-size: var(--font-size-xs);"><i data-lucide="trash-2" class="icon-sm"></i> Delete Group</button>
          </div>
        </div>
        <div class="o-table-scroll" style="border-top-left-radius: 0; border-top-right-radius: 0; border-bottom: none;">
          <table class="o-table">
            <thead>
              <tr>
                <th style="width: 50px;">No</th>
                <th>Name / Title</th>
                <th>Category / Platform</th>
                <th>Phone</th>
                <th>Address / Snippet</th>
                <th>Source</th>
                <th>Link</th>
                <th style="width: 80px; text-align: center;">Action</th>
              </tr>
            </thead>
            <tbody class="basket-group-tbody"></tbody>
          </table>
        </div>
        <!-- Group Pagination Controls -->
        <div class="basket-group-pagination" style="display: ${groupLeads.length > basketPerPage ? "flex" : "none"}; justify-content: space-between; align-items: center; padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border); border-top: none; font-size: var(--font-size-xs); color: var(--color-text-secondary); background: var(--color-surface); border-bottom-left-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md);">
          <span>Showing ${groupLeads.length ? groupStart + 1 : 0} to ${groupEnd} of ${groupLeads.length} leads</span>
          <div style="display: flex; gap: var(--space-2); align-items: center;">
            <button type="button" class="a-btn a-btn-secondary btn-basket-prev" style="padding: 2px 8px; font-size: 10px;" ${basketPages[dateKey] === 1 ? "disabled" : ""}><i data-lucide="chevron-left" class="icon-inline" style="width: 10px; height: 10px;"></i> Prev</button>
            <button type="button" class="a-btn a-btn-secondary btn-basket-next" style="padding: 2px 8px; font-size: 10px;" ${basketPages[dateKey] === totalGroupPages ? "disabled" : ""}>Next <i data-lucide="chevron-right" class="icon-inline" style="width: 10px; height: 10px;"></i></button>
          </div>
        </div>
      `;

      const headerDiv = groupDiv.querySelector(".m-basket-group-header");
      headerDiv.addEventListener("click", () => {
        groupDiv.classList.toggle("collapsed");
        const icon = headerDiv.querySelector(".group-collapse-icon");
        if (groupDiv.classList.contains("collapsed")) {
          icon.style.transform = "rotate(-90deg)";
        } else {
          icon.style.transform = "rotate(0deg)";
        }
      });

      groupDiv
        .querySelector(".remove-group-btn")
        .addEventListener("click", (e) => {
          e.stopPropagation();
          deleteGroupLeads(dateKey, dateLabel);
        });

      const btnPrev = groupDiv.querySelector(".btn-basket-prev");
      const btnNext = groupDiv.querySelector(".btn-basket-next");

      if (btnPrev) {
        btnPrev.addEventListener("click", (e) => {
          e.stopPropagation();
          if (basketPages[dateKey] > 1) {
            basketPages[dateKey]--;
            renderBasketTable();
          }
        });
      }

      if (btnNext) {
        btnNext.addEventListener("click", (e) => {
          e.stopPropagation();
          if (basketPages[dateKey] < totalGroupPages) {
            basketPages[dateKey]++;
            renderBasketTable();
          }
        });
      }

      const cb = groupDiv.querySelector(".basket-group-checkbox");
      if (cb) {
        cb.addEventListener("change", (e) => {
          if (e.target.checked) {
            uncheckedDates.delete(dateKey);
          } else {
            uncheckedDates.add(dateKey);
          }
          updateSelectAllCheckboxState();
        });
      }

      const actualTbody = groupDiv.querySelector(".basket-group-tbody");

      paginatedGroupLeads.forEach((item, index) => {
        const tr = document.createElement("tr");
        const itemNumber = groupStart + index + 1;
        const badges = [];
        if (item.daerah) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:var(--color-accent-light, #e0e7ff); color:var(--color-accent, #4f46e5); font-weight:600;">📍 ${escapeHtml(item.daerah)}</span>`);
        if (item.priceRange) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(34, 197, 94, 0.15); color:#16a34a; font-weight:600;">💰 ${escapeHtml(item.priceRange)}</span>`);
        if (item.status) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(234, 179, 8, 0.15); color:#ca8a04; font-weight:600;">🕒 ${escapeHtml(item.status)}</span>`);
        if (item.claimed && item.claimed.includes('Claimed')) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(59, 130, 246, 0.15); color:#2563eb; font-weight:600;">✓ Verified</span>`);
        if (item.socialMedia) badges.push(`<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(236, 72, 153, 0.15); color:#db2777; font-weight:600;">🔗 Social</span>`);

        const badgeHtml = badges.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">${badges.join('')}</div>` : '';
        const descHtml = item.description ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:3px; max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(item.description)}">💬 ${escapeHtml(item.description)}</div>` : '';

        tr.innerHTML = `
          <td>${itemNumber}</td>
          <td class="cell-name" title="${escapeAttr(item.name)}">
            <div style="font-weight:600;">${escapeHtml(item.name)}</div>
            ${badgeHtml}
            ${descHtml}
          </td>
          <td><span class="cell-category">${escapeHtml(item.category)}</span></td>
          <td class="cell-phone">${item.phone && !item.phone.startsWith("NO_PHONE_") ? escapeHtml(item.phone) : "—"}</td>
          <td class="cell-address" title="${escapeAttr(item.address)}">${escapeHtml(item.address)}</td>
          <td><span class="cell-category" style="background: var(--color-accent-light); color: var(--color-accent); font-weight:600;">${escapeHtml(item.source)}</span></td>
          <td class="cell-link">${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
          <td style="text-align: center;"><button type="button" class="btn-delete remove-basket-btn" style="padding: 2px 8px;"><i data-lucide="trash-2" class="icon-sm"></i> Delete</button></td>
        `;

        tr.querySelector(".remove-basket-btn").addEventListener("click", () => {
          deleteBasketLead(item.phone);
        });

        actualTbody.appendChild(tr);
      });

      basketGroupsContainer.appendChild(groupDiv);

      if (window.lucide) {
        window.lucide.createIcons({
          nameAttr: "data-lucide",
          root: groupDiv,
        });
      }
    });

    updateSelectAllCheckboxState();
  }

  function updateSelectAllCheckboxState() {
    if (!chkBasketSelectAll) return;
    const checkboxes = document.querySelectorAll(".basket-group-checkbox");
    const checkedCheckboxes = document.querySelectorAll(
      ".basket-group-checkbox:checked",
    );

    chkBasketSelectAll.checked =
      checkboxes.length > 0 && checkboxes.length === checkedCheckboxes.length;
    chkBasketSelectAll.indeterminate =
      checkedCheckboxes.length > 0 &&
      checkedCheckboxes.length < checkboxes.length;
  }

  function deleteBasketLead(phone) {
    deleteLeadFromDB(phone)
      .then(() => {
        savedLeads = savedLeads.filter((item) => item.phone !== phone);
        renderBasketTable();
        showToast("Lead deleted from basket.", "info");
      })
      .catch((err) => {
        console.error(err);
        showToast("Failed to delete from database.", "error");
      });
  }

  function clearBasket() {
    if (confirm("Are you sure you want to empty the basket?")) {
      clearAllLeadsFromDB()
        .then(() => {
          savedLeads = [];
          renderBasketTable();
          showToast("Basket successfully cleared.", "info");
        })
        .catch((err) => {
          console.error(err);
          showToast("Failed to clear database.", "error");
        });
    }
  }

  async function exportBasket(format) {
    if (savedLeads.length === 0) return;

    const checkedDates = Array.from(
      document.querySelectorAll(".basket-group-checkbox:checked"),
    ).map((cb) => cb.getAttribute("data-date"));
    if (checkedDates.length === 0) {
      showToast("Select at least one group date to export!", "warning");
      return;
    }

    const leadsToExport = savedLeads.filter((item) => {
      const dateKey = item.savedAt
        ? item.savedAt.substring(0, 10)
        : "Older";
      return checkedDates.includes(dateKey);
    });

    if (leadsToExport.length === 0) {
      showToast(
        "No data to export for the selected date(s).",
        "warning",
      );
      return;
    }

    showToast("Generating export...", "info");

    try {
      const basketCols = getCheckedColumns("basket");

      const sanitizedLeads = leadsToExport.map((item) => ({
        ...item,
        phone: item.phone && !item.phone.startsWith("NO_PHONE_") ? item.phone : "",
      }));

      const response = await fetch(`/api/export/basket/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: sanitizedLeads,
          basketColumns: basketCols,
        }),
      });

      if (!response.ok) {
        console.log(response);
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scrapmap_basket_${Date.now()}.${format === "xlsx" ? "xlsx" : "csv"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast("Basket export download started!", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to export basket: " + err.message, "error");
    }
  }

  // ========================
  // Event Bindings
  // ========================
  if (chkBasketSelectAll) {
    chkBasketSelectAll.addEventListener("change", (e) => {
      const checked = e.target.checked;
      const checkboxes = document.querySelectorAll(".basket-group-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = checked;
        const dateKey = cb.getAttribute("data-date");
        if (checked) {
          uncheckedDates.delete(dateKey);
        } else {
          uncheckedDates.add(dateKey);
        }
      });
    });
  }

  btnSaveAllBasket.addEventListener("click", saveAllLeadsToBasket);
  btnBasketClear.addEventListener("click", clearBasket);

  btnBasketExportCsv.addEventListener("click", () => {
    exportBasket("csv");
  });

  btnBasketExportExcel.addEventListener("click", () => {
    exportBasket("xlsx");
  });

  // ========================
  // Backup & Restore
  // ========================
  if (btnExportBackup) {
    btnExportBackup.addEventListener("click", async () => {
      try {
        showToast("Generating backup...", "info");
        // 1. Get settings from localStorage
        const settings = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith("scraperis_") || key.startsWith("scrapmap_"))) {
            settings[key] = localStorage.getItem(key);
          }
        }

        // 2. Get leads from IndexedDB
        const leads = await getAllLeadsFromDB();

        // 3. Compile backup payload
        const backupPayload = {
          version: 1,
          timestamp: Date.now(),
          settings: settings,
          leads: leads
        };

        // 4. Download file
        const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
          type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const now = new Date();
        const dateStr = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '');
        a.download = `scraperis_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast("Backup downloaded successfully!", "success");
      } catch (err) {
        console.error("Backup export error:", err);
        showToast("Failed to generate backup.", "error");
      }
    });
  }

  if (btnTriggerImport && inputImportBackup) {
    btnTriggerImport.addEventListener("click", () => {
      inputImportBackup.click();
    });

    inputImportBackup.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          if (!data || typeof data !== "object") {
            throw new Error("Invalid backup format.");
          }

          if (!data.settings || !Array.isArray(data.leads)) {
            throw new Error("Missing settings or leads in backup file.");
          }

          const confirmRestore = confirm(
            `Are you sure you want to restore this backup? This will replace your current settings and overwrite your Leads Basket with ${data.leads.length} leads.`
          );
          if (!confirmRestore) {
            inputImportBackup.value = "";
            return;
          }

          showToast("Importing backup...", "info");

          // 1. Restore settings
          Object.keys(data.settings).forEach((key) => {
            localStorage.setItem(key, data.settings[key]);
          });

          // 2. Clear current database and save new leads
          await clearAllLeadsFromDB();
          if (data.leads.length > 0) {
            await addLeadsBatchToDB(data.leads);
          }

          // 3. Reload config in UI
          loadConfig();

          // 4. Reload saved leads variable and table
          const refreshedLeads = await getAllLeadsFromDB();
          savedLeads = refreshedLeads;
          renderBasketTable();

          showToast("Backup successfully imported!", "success");
        } catch (err) {
          console.error("Import error:", err);
          showToast(`Failed to import backup: ${err.message}`, "error");
        } finally {
          inputImportBackup.value = "";
        }
      };
      reader.readAsText(file);
    });
  }



  if (btnResultsPrev) {
    btnResultsPrev.addEventListener("click", () => {
      if (resultsPage > 1) {
        resultsPage--;
        renderResultsTable();
      }
    });
  }

  if (btnResultsNext) {
    btnResultsNext.addEventListener("click", () => {
      const totalPages = Math.ceil(results.length / resultsPerPage);
      if (resultsPage < totalPages) {
        resultsPage++;
        renderResultsTable();
      }
    });
  }

  // Load basket from IndexedDB on startup
  getAllLeadsFromDB()
    .then((leads) => {
      savedLeads = leads;
      renderBasketTable();
    })
    .catch((err) => {
      console.error("Error loading basket from IndexedDB:", err);
      savedLeads = [];
      renderBasketTable();
    });

  // ========================
  // Smooth header shadow on scroll
  // ========================
  const header = document.getElementById("header");
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        if (window.scrollY > 10) {
          header.style.boxShadow = "0 1px 12px rgba(0,0,0,0.06)";
        } else {
          header.style.boxShadow = "none";
        }
        ticking = false;
      });
      ticking = true;
    }
  });
  // ========================
  // Live Map Visualization
  // ========================
  const liveMapContainer = document.getElementById("live-map-container");
  const liveMapCanvas = document.getElementById("live-map-canvas");
  const liveMapLabel = document.getElementById("live-map-label");
  let mapAnimationId = null;
  let mapPoints = [];
  let mapScanAngle = 0;

  function startLiveMap() {
    if (!liveMapCanvas || !liveMapContainer) return;
    
    const showMap = !configShowMapVisualInput || configShowMapVisualInput.checked;
    if (!showMap) {
      liveMapContainer.style.display = "none";
      return;
    }

    liveMapContainer.style.display = "block";
    mapPoints = [];
    mapScanAngle = 0;

    const canvas = liveMapCanvas;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;

    // Pre-generate grid dots (map-like appearance)
    const gridDots = [];
    for (let i = 0; i < 120; i++) {
      gridDots.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.2 + 0.3,
        a: Math.random() * 0.15 + 0.05,
      });
    }

    function addFoundPoint() {
      mapPoints.push({
        x: 40 + Math.random() * (W - 80),
        y: 20 + Math.random() * (H - 50),
        r: 0,
        maxR: 18 + Math.random() * 14,
        alpha: 1,
        born: Date.now(),
        hue: 168 + Math.random() * 20,
      });
      if (mapPoints.length > 30) mapPoints.shift();
    }

    function drawFrame() {
      ctx.clearRect(0, 0, W, H);

      // Background grid dots
      gridDots.forEach((d) => {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(78, 192, 186, ${d.a})`;
        ctx.fill();
      });

      // Scan line (sweeping)
      mapScanAngle += 0.015;
      const scanX = ((Math.sin(mapScanAngle) + 1) / 2) * W;
      const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
      grad.addColorStop(0, "rgba(78, 192, 186, 0)");
      grad.addColorStop(0.5, "rgba(78, 192, 186, 0.12)");
      grad.addColorStop(1, "rgba(78, 192, 186, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(scanX - 40, 0, 80, H);

      // Found points (ripple + glow)
      const now = Date.now();
      mapPoints.forEach((p) => {
        const age = (now - p.born) / 1000;
        p.r = Math.min(p.r + 0.4, p.maxR);
        p.alpha = Math.max(1 - age / 8, 0);

        if (p.alpha <= 0) return;

        // Ripple
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${p.hue}, 70%, 65%, ${p.alpha * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.alpha})`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 8);
        glow.addColorStop(0, `hsla(${p.hue}, 80%, 70%, ${p.alpha * 0.4})`);
        glow.addColorStop(1, `hsla(${p.hue}, 80%, 70%, 0)`);
        ctx.fillStyle = glow;
        ctx.fill();
      });

      mapAnimationId = requestAnimationFrame(drawFrame);
    }

    // Periodically add points while scraping
    const pointInterval = setInterval(() => {
      if (!liveMapContainer || liveMapContainer.style.display === "none") {
        clearInterval(pointInterval);
        return;
      }
      addFoundPoint();
    }, 1200 + Math.random() * 1800);

    drawFrame();
  }

  function stopLiveMap() {
    if (mapAnimationId) {
      cancelAnimationFrame(mapAnimationId);
      mapAnimationId = null;
    }
    if (liveMapLabel) liveMapLabel.textContent = "Complete";
  }

  function updateLiveMapLabel(text) {
    if (liveMapLabel) liveMapLabel.textContent = text;
  }

  // Hook into scraping lifecycle
  const origSetFormLoading = setFormLoading;
  setFormLoading = function (loading) {
    origSetFormLoading(loading);
    if (loading) {
      startLiveMap();
      updateLiveMapLabel("Scanning...");
    } else {
      stopLiveMap();
    }
  };
})();
