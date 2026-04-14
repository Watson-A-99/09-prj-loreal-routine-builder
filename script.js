/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineButton = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

let allProducts = [];
const selectedProducts = new Map();
let activeModalProductId = null;

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
      "You are a skincare and beauty routine assistant. Build routines using only products provided by the user. Do not invent or add products not included in the provided JSON.",
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
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`);

  return paragraphs.join("");
}

/* Return safe, user-friendly chat errors */
function getConsumerErrorMessage() {
  return "We couldn't generate your routine right now. Please try again in a moment.";
}

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
  renderSelectedProducts();
});

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  chatWindow.innerHTML = "Connect to the OpenAI API for a response!";
});
