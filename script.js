/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineButton = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const savedRoutinesList = document.getElementById("savedRoutinesList");

let allProducts = [];
const selectedProducts = new Map();
let activeModalProductId = null;
const SAVED_ROUTINES_KEY = "lorealSavedRoutines";
const SELECTED_PRODUCTS_KEY = "lorealSelectedProductIds";
const MAX_SAVED_ROUTINES = 10;

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
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: openAiApiKey,
    };
  }

  return null;
}

/* Call AI and return text response */
async function requestRoutineFromAi(selectedProductsData) {
  const aiConfig = getAiConfig();

  if (!aiConfig) {
    throw new Error(
      "No AI config found. Add OPENAI_API_KEY in secrets.js or set CLOUDFLARE_WORKER_URL for deployment.",
    );
  }

  const systemMessage = {
    role: "system",
    content:
      "You are a friendly skincare and beauty routine assistant. Use emojis where applicable. Number the steps for the user. Build routines using only products provided by the user. Do not invent or add products not included in the provided JSON. If a user asks for a product not in the JSON, respond with 'I can only create routines using the products you've selected.' do not answer anything not beauty related,and guid ehe user back on track'",
  };

  const userMessage = {
    role: "user",
    content: `Create a simple daily routine using ONLY these selected products.\n\nSelected products JSON:\n${JSON.stringify(selectedProductsData, null, 2)}\n\nReturn a beginner-friendly routine with sections for Morning, Evening, and Why this order works.`,
  };

  const messages = [systemMessage, userMessage];
  let response;

  if (aiConfig.mode === "openai") {
    response = await fetch(aiConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
      }),
    });
  } else {
    response = await fetch(aiConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        selectedProducts: selectedProductsData,
      }),
    });
  }

  if (!response.ok) {
    throw new Error(`AI request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  }

  if (data.output) {
    return data.output;
  }

  throw new Error("AI response format was not recognized.");
}

/* Convert AI output into safe, readable paragraph HTML */
function formatRoutineTextAsHtml(text) {
  const escapedText = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  const paragraphs = escapedText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => {
      const withBold = paragraph.replace(
        /\*\*(.+?)\*\*/g,
        "<strong>$1</strong>",
      );
      return `<p>${withBold.replaceAll("\n", "<br>")}</p>`;
    });

  return paragraphs.join("");
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
  };

  const updated = [newRoutine, ...savedRoutines].slice(0, MAX_SAVED_ROUTINES);
  setSavedRoutines(updated);
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
        <button type="button" class="saved-routine-item" data-saved-routine-id="${routine.id}">
          <strong>${routine.title}</strong>
          <span>${formattedDate}</span>
        </button>
      `;
    })
    .join("");
}

/* Open a saved routine in the chat window */
savedRoutinesList.addEventListener("click", (event) => {
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

  chatWindow.innerHTML = formatRoutineTextAsHtml(selectedRoutine.routineText);
});

/* Generate routine from selected products only */
generateRoutineButton.addEventListener("click", async () => {
  const selectedProductsData = getSelectedProductsForPrompt();

  if (selectedProductsData.length === 0) {
    chatWindow.innerHTML = "Select at least one product first.";
    return;
  }

  generateRoutineButton.disabled = true;
  generateRoutineButton.textContent = "Generating...";
  chatWindow.innerHTML = "Building your routine from selected products...";

  try {
    const routineText = await requestRoutineFromAi(selectedProductsData);
    chatWindow.innerHTML = formatRoutineTextAsHtml(routineText);
    saveRoutine(routineText, selectedProductsData);
  } catch (error) {
    console.error("Routine generation failed:", error);
    chatWindow.textContent = getConsumerErrorMessage();
  } finally {
    generateRoutineButton.disabled = false;
    generateRoutineButton.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Routine';
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

/* Load products and prepare the initial selected state */
loadProducts().then(() => {
  initializeProductModal();
  restoreSelectedProducts();
  renderSelectedProducts();
  renderSavedRoutines();
});

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  chatWindow.innerHTML = "Connect to the OpenAI API for a response!";
});
