/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineButton = document.getElementById("generateRoutine");
const clearAllProductsButton = document.getElementById("clearAllProducts");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const savedRoutinesList = document.getElementById("savedRoutinesList");

let allProducts = [];
const selectedProducts = new Map();
let activeModalProductId = null;
const SAVED_ROUTINES_KEY = "lorealSavedRoutines";
const SELECTED_PRODUCTS_KEY = "lorealSelectedProductIds";
const MAX_SAVED_ROUTINES = 5;
const OPENAI_MODEL = "gpt-5-mini";
const OPENAI_REASONING_EFFORT = "low";
let currentRoutineText = "";
let followUpThread = [];
let isThinking = false;
let currentRoutineId = null;
let routineGenerationStatusText = "";
let routineStatusIntervalId = null;

function getReasoningEffort() {
  const allowedValues = ["low", "medium", "high"];
  const configuredValue =
    window.OPENAI_REASONING_EFFORT || OPENAI_REASONING_EFFORT;

  if (allowedValues.includes(configuredValue)) {
    return configuredValue;
  }

  return "low";
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  if (allProducts.length > 0) {
    return allProducts;
  }

  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
  return allProducts;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card ${selectedProducts.has(product.id) ? "selected" : ""}" data-product-id="${product.id}">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
      </div>
      <div class="product-card-actions">
        <button type="button" class="learn-more-btn" data-learn-more-id="${product.id}">Learn More</button>
      </div>
    </div>
  `,
    )
    .join("");
}

/* Create modal once and reuse it for product details */
function initializeProductModal() {
  const modalHtml = `
    <div id="productModal" class="product-modal" aria-hidden="true">
      <div class="product-modal-content" role="dialog" aria-modal="true" aria-labelledby="productModalTitle">
        <div class="product-modal-media">
          <img id="productModalImage" src="" alt="">
        </div>
        <div class="product-modal-details">
          <button type="button" id="closeProductModal" class="close-product-modal" aria-label="Close product details modal">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <h3 id="productModalTitle"></h3>
          <p id="productModalDescription"></p>
          <button type="button" id="selectFromModalBtn" class="select-from-modal-btn">
            Select Product
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const modal = document.getElementById("productModal");
  const closeButton = document.getElementById("closeProductModal");
  const selectButton = document.getElementById("selectFromModalBtn");

  closeButton.addEventListener("click", closeProductModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeProductModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("open")) {
      closeProductModal();
    }
  });

  selectButton.addEventListener("click", () => {
    if (activeModalProductId === null) {
      return;
    }

    toggleProductSelection(activeModalProductId);
    closeProductModal();
  });
}

function openProductModal(productId) {
  const product = allProducts.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  activeModalProductId = productId;

  const modal = document.getElementById("productModal");
  const title = document.getElementById("productModalTitle");
  const image = document.getElementById("productModalImage");
  const description = document.getElementById("productModalDescription");
  const selectButton = document.getElementById("selectFromModalBtn");

  title.textContent = product.name;
  image.src = product.image;
  image.alt = product.name;
  description.textContent = product.description;

  if (selectedProducts.has(productId)) {
    selectButton.textContent = "Remove Product";
  } else {
    selectButton.textContent = "Select Product";
  }

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeProductModal() {
  const modal = document.getElementById("productModal");

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  activeModalProductId = null;
}

/* Build prompt data from only the products the user selected */
function getSelectedProductsForPrompt() {
  return Array.from(selectedProducts.values()).map((product) => ({
    id: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    description: product.description,
  }));
}

/* Choose how requests are sent:
   - Local testing: OpenAI API key from secrets.js
   - Deployment: Cloudflare Worker endpoint */
function getAiConfig() {
  const cloudflareWorkerUrl = window.CLOUDFLARE_WORKER_URL;
  const globalApiKey = typeof apiKey !== "undefined" ? apiKey : null;
  const openAiApiKey = window.OPENAI_API_KEY || window.apiKey || globalApiKey;

  if (cloudflareWorkerUrl) {
    return {
      mode: "cloudflare",
      url: cloudflareWorkerUrl,
    };
  }

  if (openAiApiKey) {
    return {
      mode: "openai",
      url: "https://api.openai.com/v1/responses",
      apiKey: openAiApiKey,
    };
  }

  return null;
}

/* Call AI and return text response */
async function requestAiResponse(messages, selectedProductsData, options = {}) {
  const { useWebSearch = false } = options;
  const aiConfig = getAiConfig();
  const reasoningEffort = getReasoningEffort();

  if (!aiConfig) {
    throw new Error(
      "No AI config found. Add OPENAI_API_KEY in secrets.js or set CLOUDFLARE_WORKER_URL for deployment.",
    );
  }

  let response;

  if (aiConfig.mode === "openai") {
    const requestBody = {
      model: OPENAI_MODEL,
      input: messages,
      reasoning: {
        effort: reasoningEffort,
      },
    };

    if (useWebSearch) {
      requestBody.tools = [{ type: "web_search" }];
    }

    response = await fetch(aiConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } else {
    response = await fetch(aiConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        selectedProducts: selectedProductsData,
        reasoning: {
          effort: reasoningEffort,
        },
        reasoningEffort,
      }),
    });
  }

  if (!response.ok) {
    let errorDetails = "";

    try {
      const errorData = await response.json();
      errorDetails = errorData.error?.message || JSON.stringify(errorData);
    } catch {
      errorDetails = await response.text();
    }

    throw new Error(
      `AI request failed with status ${response.status}${errorDetails ? `: ${errorDetails}` : ""}`,
    );
  }

  const data = await response.json();

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (Array.isArray(data.output)) {
    const textParts = data.output
      .flatMap((item) => item.content || [])
      .filter(
        (item) => item.type === "output_text" && typeof item.text === "string",
      )
      .map((item) => item.text);

    if (textParts.length > 0) {
      return textParts.join("");
    }
  }

  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  }

  if (data.output) {
    return data.output;
  }

  throw new Error("AI response format was not recognized.");
}

/* Build and request the initial routine */
async function requestRoutineFromAi(selectedProductsData) {
  const systemMessage = {
    role: "system",
    content:
      "You are a friendly skincare and beauty routine assistant. Use emojis where applicable in a human-like fashion. Build skincare and makeup routines from selected products. Do not diplay  json IDs. Use web search for approximate product pricing. Do not invent or add products not included in the provided JSON. Do not answer non beauty/skincare related questions on clarifications. If the user asks about something not related to the products or routine, politely let them know you can only answer questions about the routine and products. No redundant information",
  };

  const userMessage = {
    role: "user",
    content: `Create a simple daily routine using ONLY these selected products.\n\nSelected products JSON:\n${JSON.stringify(selectedProductsData, null, 2)}\n\nUse web search to verify current product details, price estimates if available, and any important up-to-date guidance. Return a beginner-friendly routine and explainWhy this order works,`,
  };

  return requestAiResponse([systemMessage, userMessage], selectedProductsData, {
    useWebSearch: true,
  });
}

/* Escape plain text before rendering HTML */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* Convert AI output into safe, readable paragraph HTML */
function formatRoutineTextAsHtml(text) {
  const escapedText = escapeHtml(text);

  const makeSafeExternalLink = (url, label = url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

  const linkifyInlineText = (value) => {
    const placeholders = [];

    // Convert markdown-style links first: [Label](https://example.com)
    const withMarkdownLinks = value.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => {
        const token = `__AI_LINK_${placeholders.length}__`;
        placeholders.push(makeSafeExternalLink(url, label));
        return token;
      },
    );

    // Convert plain URLs in AI output to clickable links.
    const withBareLinks = withMarkdownLinks.replace(
      /(^|[\s(>])(https?:\/\/[^\s<]+)/g,
      (_, prefix, rawUrl) => {
        const url = rawUrl.replace(/[),.;!?]+$/, "");
        const trailing = rawUrl.slice(url.length);
        return `${prefix}${makeSafeExternalLink(url)}${trailing}`;
      },
    );

    return placeholders.reduce(
      (acc, link, index) => acc.replace(`__AI_LINK_${index}__`, link),
      withBareLinks,
    );
  };

  const formatInline = (value) =>
    linkifyInlineText(value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"));

  const lines = escapedText.split("\n");
  const htmlParts = [];
  let paragraphLines = [];
  let inList = false;

  const closeParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    htmlParts.push(`<p>${paragraphLines.join("<br>")}</p>`);
    paragraphLines = [];
  };

  const closeList = () => {
    if (!inList) {
      return;
    }

    htmlParts.push("</ul>");
    inList = false;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      closeParagraph();
      closeList();
      return;
    }

    if (line.startsWith("### ")) {
      closeParagraph();
      closeList();
      htmlParts.push(`<h3>${formatInline(line.slice(4).trim())}</h3>`);
      return;
    }

    const listItemMatch = line.match(/^-\s+(.+)/);

    if (listItemMatch) {
      closeParagraph();

      if (!inList) {
        htmlParts.push('<ul class="routine-list">');
        inList = true;
      }

      htmlParts.push(`<li>${formatInline(listItemMatch[1])}</li>`);
      return;
    }

    closeList();
    paragraphLines.push(formatInline(line));
  });

  closeParagraph();
  closeList();

  return htmlParts.join("");
}

/* Render routine + follow-up chat thread */
function renderChatWindow() {
  const sections = [];

  if (routineGenerationStatusText) {
    sections.push(
      `<p class="chat-status-message">${escapeHtml(routineGenerationStatusText)}</p>`,
    );
  }

  if (currentRoutineText) {
    sections.push(
      `<div class="routine-output">${formatRoutineTextAsHtml(currentRoutineText)}</div>`,
    );
  }

  if (followUpThread.length > 0 || isThinking) {
    const messagesHtml = followUpThread
      .map((message) => {
        if (message.role === "user") {
          const userHtml = escapeHtml(message.content).replaceAll("\n", "<br>");
          return `<div class="chat-bubble user"><p>${userHtml}</p></div>`;
        }

        return `<div class="chat-bubble ai">${formatRoutineTextAsHtml(message.content)}</div>`;
      })
      .join("");

    const thinkingHtml = isThinking
      ? '<div class="chat-bubble ai thinking"><p>Thinking...</p></div>'
      : "";

    if (currentRoutineText) {
      sections.push('<hr class="chat-divider">');
    }

    sections.push(
      `<div class="chat-thread">${messagesHtml}${thinkingHtml}</div>`,
    );
  }

  chatWindow.innerHTML = sections.join("");
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function startRoutineGenerationStatus() {
  const statusMessages = [
    "Generating your routine...",
    "Reviewing selected products...",
    "Fetching up-to-date product details...",
    "Fetching current prices...",
    "Finalizing your personalized routine...",
  ];

  let messageIndex = 0;
  routineGenerationStatusText = statusMessages[messageIndex];
  renderChatWindow();

  if (routineStatusIntervalId) {
    clearInterval(routineStatusIntervalId);
  }

  routineStatusIntervalId = setInterval(() => {
    messageIndex = (messageIndex + 1) % statusMessages.length;
    routineGenerationStatusText = statusMessages[messageIndex];
    renderChatWindow();
  }, 7000);
}

function stopRoutineGenerationStatus() {
  if (routineStatusIntervalId) {
    clearInterval(routineStatusIntervalId);
    routineStatusIntervalId = null;
  }

  routineGenerationStatusText = "";
}

/* Return safe, user-friendly chat errors */
function getConsumerErrorMessage() {
  return "We couldn't generate your routine right now. Please try again in a moment.";
}

/* Read saved routines from localStorage */
function getSavedRoutines() {
  try {
    const saved = localStorage.getItem(SAVED_ROUTINES_KEY);

    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to read saved routines:", error);
    return [];
  }
}

/* Save routine list to localStorage */
function setSavedRoutines(routines) {
  try {
    localStorage.setItem(SAVED_ROUTINES_KEY, JSON.stringify(routines));
  } catch (error) {
    console.error("Failed to save routines:", error);
  }
}

/* Save selected product IDs to localStorage */
function saveSelectedProducts() {
  try {
    const selectedIds = Array.from(selectedProducts.keys());
    localStorage.setItem(SELECTED_PRODUCTS_KEY, JSON.stringify(selectedIds));
  } catch (error) {
    console.error("Failed to save selected products:", error);
  }
}

/* Restore selected products from localStorage */
function restoreSelectedProducts() {
  try {
    const savedIdsText = localStorage.getItem(SELECTED_PRODUCTS_KEY);

    if (!savedIdsText) {
      return;
    }

    const savedIds = JSON.parse(savedIdsText);

    if (!Array.isArray(savedIds)) {
      return;
    }

    selectedProducts.clear();

    savedIds.forEach((id) => {
      const productId = Number(id);
      const product = allProducts.find((item) => item.id === productId);

      if (product) {
        selectedProducts.set(productId, product);
      }
    });
  } catch (error) {
    console.error("Failed to restore selected products:", error);
  }
}

/* Create one saved routine record */
function saveRoutine(routineText, selectedProductsData) {
  const savedRoutines = getSavedRoutines();
  const productNames = selectedProductsData.map((product) => product.name);
  const summary = productNames.slice(0, 2).join(" + ");
  const extraCount = Math.max(productNames.length - 2, 0);
  const title =
    extraCount > 0 ? `${summary} + ${extraCount} more` : summary || "Routine";

  const newRoutine = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    title,
    products: productNames,
    routineText,
    thread: [],
  };

  const updated = [newRoutine, ...savedRoutines].slice(0, MAX_SAVED_ROUTINES);
  setSavedRoutines(updated);
  currentRoutineId = newRoutine.id;
  renderSavedRoutines();
}

/* Render local saved routines list */
function renderSavedRoutines() {
  const savedRoutines = getSavedRoutines();

  if (savedRoutines.length === 0) {
    savedRoutinesList.innerHTML = `
      <p class="saved-routines-empty">No saved routines yet.</p>
    `;
    return;
  }

  savedRoutinesList.innerHTML = savedRoutines
    .map((routine) => {
      const formattedDate = new Date(routine.createdAt).toLocaleString();
      return `
        <div class="saved-routine-item-wrapper">
          <button type="button" class="saved-routine-item" data-saved-routine-id="${routine.id}">
            <strong>${routine.title}</strong>
            <span>${formattedDate}</span>
          </button>
          <button type="button" class="delete-routine-btn" data-delete-routine-id="${routine.id}" aria-label="Delete routine">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;
    })
    .join("");
}

/* Open or delete a saved routine */
savedRoutinesList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".delete-routine-btn");

  if (deleteButton) {
    event.stopPropagation();
    const routineId = Number(deleteButton.dataset.deleteRoutineId);
    const savedRoutines = getSavedRoutines();
    const filteredRoutines = savedRoutines.filter(
      (routine) => routine.id !== routineId,
    );
    setSavedRoutines(filteredRoutines);
    renderSavedRoutines();
    return;
  }

  const savedRoutineButton = event.target.closest("[data-saved-routine-id]");

  if (!savedRoutineButton) {
    return;
  }

  const selectedId = Number(savedRoutineButton.dataset.savedRoutineId);
  const savedRoutines = getSavedRoutines();
  const selectedRoutine = savedRoutines.find(
    (routine) => routine.id === selectedId,
  );

  if (!selectedRoutine) {
    chatWindow.textContent = "That saved routine could not be found.";
    return;
  }

  currentRoutineText = selectedRoutine.routineText;
  currentRoutineId = selectedRoutine.id;
  followUpThread = selectedRoutine.thread || [];
  isThinking = false;
  renderChatWindow();
});

/* Generate routine from selected products only */
generateRoutineButton.addEventListener("click", async () => {
  const savedRoutines = getSavedRoutines();

  if (savedRoutines.length >= MAX_SAVED_ROUTINES) {
    chatWindow.innerHTML = `<p style="color: #d9534f; font-weight: 500;">You have reached the maximum of ${MAX_SAVED_ROUTINES} saved routines. Please delete a routine before generating a new one.</p>`;
    return;
  }

  const selectedProductsData = getSelectedProductsForPrompt();

  if (selectedProductsData.length === 0) {
    chatWindow.innerHTML = "Select at least one product first.";
    return;
  }

  generateRoutineButton.disabled = true;
  generateRoutineButton.textContent = "Generating...";
  currentRoutineText = "";
  followUpThread = [];
  currentRoutineId = null;
  startRoutineGenerationStatus();

  try {
    const routineText = await requestRoutineFromAi(selectedProductsData);
    currentRoutineText = routineText;
    saveRoutine(routineText, selectedProductsData);
  } catch (error) {
    console.error("Routine generation failed:", error);
    followUpThread = [
      {
        role: "assistant",
        content: getConsumerErrorMessage(),
      },
    ];
  } finally {
    stopRoutineGenerationStatus();
    renderChatWindow();
    generateRoutineButton.disabled = false;
    generateRoutineButton.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Routine';
  }
});

/* Follow-up chat submission */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const userMessageText = userInput.value.trim();

  if (!userMessageText) {
    return;
  }

  const selectedProductsData = getSelectedProductsForPrompt();

  if (!currentRoutineText && selectedProductsData.length === 0) {
    chatWindow.textContent = "Select products and generate a routine first.";
    return;
  }

  followUpThread.push({
    role: "user",
    content: userMessageText,
  });
  userInput.value = "";
  isThinking = true;
  renderChatWindow();

  try {
    const systemMessage = {
      role: "system",
      content:
        "You are a friendly skincare and beauty routine assistant. Use emojis in a human manner. Answer follow-up questions using only the selected products and existing active routine context. Keep answers concise and beginner-friendly. Do not answer non beauty/skincare related questions. If the user asks about something not related to the products or routine, politely let them know you can only answer questions about the routine and products. No redundant information.",
    };

    const contextMessage = {
      role: "user",
      content: `Context:\nSelected products JSON:\n${JSON.stringify(selectedProductsData, null, 2)}\n\nCurrent routine:\n${currentRoutineText || "No routine generated yet."}`,
    };

    const historyMessages = followUpThread.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

    const aiReply = await requestAiResponse(
      [systemMessage, contextMessage, ...historyMessages],
      selectedProductsData,
      { useWebSearch: false },
    );

    followUpThread.push({
      role: "assistant",
      content: aiReply,
    });

    if (currentRoutineId !== null) {
      const savedRoutines = getSavedRoutines();
      const updatedRoutines = savedRoutines.map((routine) => {
        if (routine.id === currentRoutineId) {
          return { ...routine, thread: followUpThread };
        }
        return routine;
      });
      setSavedRoutines(updatedRoutines);
    }
  } catch (error) {
    console.error("Follow-up request failed:", error);
    followUpThread.push({
      role: "assistant",
      content: getConsumerErrorMessage(),
    });
  } finally {
    isThinking = false;
    renderChatWindow();
  }
});

/* Render the selected products area */
function renderSelectedProducts() {
  const selectedItems = Array.from(selectedProducts.values());

  if (selectedItems.length === 0) {
    selectedProductsList.innerHTML = `
      <div class="selected-empty-state">No products selected yet.</div>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedItems
    .map(
      (product) => `
        <div class="selected-product-card">
          <img src="${product.image}" alt="${product.name}">
          <div class="selected-product-info">
            <h3>${product.name}</h3>
            <p>${product.brand}</p>
          </div>
          <button
            type="button"
            class="remove-selected-product"
            data-remove-product-id="${product.id}"
            aria-label="Remove ${product.name} from selected products"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `,
    )
    .join("");
}

/* Toggle a product in the selected list */
function toggleProductSelection(productId) {
  const product = allProducts.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  if (selectedProducts.has(productId)) {
    selectedProducts.delete(productId);
  } else {
    selectedProducts.set(productId, product);
  }

  saveSelectedProducts();

  renderSelectedProducts();

  if (categoryFilter.value) {
    const filteredProducts = allProducts.filter(
      (item) => item.category === categoryFilter.value,
    );
    displayProducts(filteredProducts);
  }
}

/* Clear all selected products */
function clearAllSelectedProducts() {
  selectedProducts.clear();
  saveSelectedProducts();
  renderSelectedProducts();

  if (categoryFilter.value) {
    const filteredProducts = allProducts.filter(
      (item) => item.category === categoryFilter.value,
    );
    displayProducts(filteredProducts);
  }
}

/* Keep the selected list and the product grid connected */
productsContainer.addEventListener("click", (event) => {
  const learnMoreButton = event.target.closest("[data-learn-more-id]");

  if (learnMoreButton) {
    const productId = Number(learnMoreButton.dataset.learnMoreId);
    openProductModal(productId);
    return;
  }

  const productCard = event.target.closest(".product-card");

  if (!productCard) {
    return;
  }

  const productId = Number(productCard.dataset.productId);
  toggleProductSelection(productId);
});

selectedProductsList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-product-id]");

  if (!removeButton) {
    return;
  }

  const productId = Number(removeButton.dataset.removeProductId);
  selectedProducts.delete(productId);
  saveSelectedProducts();
  renderSelectedProducts();

  if (categoryFilter.value) {
    const filteredProducts = allProducts.filter(
      (item) => item.category === categoryFilter.value,
    );
    displayProducts(filteredProducts);
  }
});

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory,
  );

  displayProducts(filteredProducts);
});

/* Clear all selected products button handler */
clearAllProductsButton.addEventListener("click", () => {
  if (selectedProducts.size > 0) {
    clearAllSelectedProducts();
  }
});

/* Load products and prepare the initial selected state */
loadProducts().then(() => {
  initializeProductModal();
  restoreSelectedProducts();
  renderSelectedProducts();
  renderSavedRoutines();
  renderChatWindow();
});
