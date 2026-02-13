/* ============================================
   BAKERY POLINA - APP LOGIC
   Firebase Firestore Integration
   ============================================ */

console.log("Bakery Polina App v2 - Login Removed");

// ---- Firebase Configuration ----


// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ---- Constants ----
const NUM_BATCHES = 6;
const HISTORY_DAYS = 90;
const EDITABLE_RANGE_DAYS = 1;

// ---- State ----
let products = [];
let dailyRecords = {};  // keyed by productId
let currentDate = '';
let editingProductId = null;

// ---- DOM References ----
const dateInput = document.getElementById('dateInput');
const inventoryBody = document.getElementById('inventoryBody');
const emptyState = document.getElementById('emptyState');
const loadingOverlay = document.getElementById('loadingOverlay');
const addProductBtn = document.getElementById('addProductBtn');
const manageProductsBtn = document.getElementById('manageProductsBtn');
const dailyReportBtn = document.getElementById('dailyReportBtn');

const manageProductsModal = document.getElementById('manageProductsModal');
const manageModalCloseBtn = document.getElementById('manageModalCloseBtn');
const manageModalDoneBtn = document.getElementById('manageModalDoneBtn');
const productListContainer = document.getElementById('productListContainer');

// Product Modal
const productModal = document.getElementById('productModal');
const modalTitle = document.getElementById('modalTitle');
const productNameInput = document.getElementById('productNameInput');
const productPriceInput = document.getElementById('productPriceInput');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalSaveBtn = document.getElementById('modalSaveBtn');

// Delete Modal
const deleteModal = document.getElementById('deleteModal');
const deleteProductName = document.getElementById('deleteProductName');
const deleteModalCloseBtn = document.getElementById('deleteModalCloseBtn');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

// Stats
const statTotalProducts = document.querySelector('#statTotalProducts .stat-value');
const statTotalSent = document.querySelector('#statTotalSent .stat-value');
const statTotalRemaining = document.querySelector('#statTotalRemaining .stat-value');
const statTotalSold = document.querySelector('#statTotalSold .stat-value');
const statTotalRevenue = document.querySelector('#statTotalRevenue .stat-value');
const statRemainingValue = document.querySelector('#statRemainingValue .stat-value');

// ---- Utility Functions ----

function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = message;
    toast.className = 'toast ' + type;

    // Trigger show
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-hide
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

function showLoading() {
    loadingOverlay.classList.remove('hidden');
}

// Check if the current date is editable (today, yesterday, or tomorrow)
function isDateEditable() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(currentDate + 'T00:00:00');
    const diffMs = selected - today;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return diffDays >= -EDITABLE_RANGE_DAYS && diffDays <= EDITABLE_RANGE_DAYS;
}

// Get min/max dates for the date picker
function getDateLimits() {
    const today = new Date();
    const minDate = new Date(today);
    minDate.setDate(today.getDate() - HISTORY_DAYS);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + EDITABLE_RANGE_DAYS);
    return {
        min: formatDate(minDate),
        max: formatDate(maxDate)
    };
}

// ---- Auto-Save with Debounce ----
const autoSaveTimers = {};

function autoSaveRow(productId) {
    // Clear any existing timer for this product
    if (autoSaveTimers[productId]) {
        clearTimeout(autoSaveTimers[productId]);
    }

    // Debounce: wait 500ms after last input before saving
    autoSaveTimers[productId] = setTimeout(async () => {
        // Don't save if date is not editable
        if (!isDateEditable()) return;

        try {
            const batches = getRowBatches(productId);
            const remaining = getRowRemaining(productId);
            const totalSent = batches.reduce((sum, v) => sum + v, 0);

            // Validate before saving
            if (remaining > totalSent && totalSent > 0) {
                return; // Don't save invalid data
            }

            await saveDailyRecord(productId, batches, remaining);
            showToast('Saved ✓', 'success');
        } catch (error) {
            console.error('Auto-save error:', error);
            showToast('Auto-save failed', 'error');
        }
    }, 500);
}

// ---- Firebase Operations ----

// Load all products from Firestore
async function loadProducts() {
    try {
        const snapshot = await db.collection('products')
            .orderBy('createdAt', 'asc')
            .get();

        products = [];
        snapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data() });
        });

        return products;
    } catch (error) {
        console.error('Error loading products:', error);
        showToast('Failed to load products', 'error');
        return [];
    }
}

// Load daily records for a specific date
async function loadDailyRecords(date) {
    try {
        const snapshot = await db.collection('dailyRecords')
            .where('date', '==', date)
            .get();

        dailyRecords = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            dailyRecords[data.productId] = { id: doc.id, ...data };
        });

        return dailyRecords;
    } catch (error) {
        console.error('Error loading daily records:', error);
        showToast('Failed to load records', 'error');
        return {};
    }
}

// Add a new product
async function addProduct(name, price) {
    try {
        const docRef = await db.collection('products').add({
            name: name.trim(),
            price: price,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(`"${name}" added successfully!`, 'success');
        return docRef.id;
    } catch (error) {
        console.error('Error adding product:', error);
        showToast('Failed to add product', 'error');
        return null;
    }
}

// Update product name and price
async function updateProduct(productId, newName, newPrice) {
    try {
        await db.collection('products').doc(productId).update({
            name: newName.trim(),
            price: newPrice
        });
        showToast(`Product updated to "${newName}"`, 'success');
    } catch (error) {
        console.error('Error updating product:', error);
        showToast('Failed to update product', 'error');
    }
}

// Delete a product and all related daily records
async function deleteProduct(productId) {
    try {
        // Delete product
        await db.collection('products').doc(productId).delete();

        // Delete all daily records for this product
        const recordsSnapshot = await db.collection('dailyRecords')
            .where('productId', '==', productId)
            .get();

        const batch = db.batch();
        recordsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        showToast('Product deleted successfully', 'success');
    } catch (error) {
        console.error('Error deleting product:', error);
        showToast('Failed to delete product', 'error');
    }
}

// Save/update a daily record
async function saveDailyRecord(productId, batches, remainingQty) {
    const totalSent = batches.reduce((sum, val) => sum + val, 0);
    const soldQty = totalSent - remainingQty;

    const recordData = {
        date: currentDate,
        productId: productId,
        batches: batches,
        totalSent: totalSent,
        remainingQty: remainingQty,
        soldQty: soldQty
    };

    try {
        if (dailyRecords[productId] && dailyRecords[productId].id) {
            // Update existing
            await db.collection('dailyRecords').doc(dailyRecords[productId].id).update(recordData);
        } else {
            // Create new
            const docRef = await db.collection('dailyRecords').add(recordData);
            dailyRecords[productId] = { id: docRef.id, ...recordData };
        }
    } catch (error) {
        console.error('Error saving daily record:', error);
        throw error;
    }
}

// ---- UI Rendering ----

function renderTable() {
    inventoryBody.innerHTML = '';

    const editable = isDateEditable();

    if (products.length === 0) {
        emptyState.classList.add('visible');
        document.querySelector('.table-scroll').style.display = 'none';
        updateStats();
        return;
    }

    emptyState.classList.remove('visible');
    document.querySelector('.table-scroll').style.display = 'block';

    products.forEach(product => {
        const record = dailyRecords[product.id] || null;
        const batches = record ? record.batches : new Array(NUM_BATCHES).fill(0);
        const totalSent = batches.reduce((sum, val) => sum + val, 0);
        const remainingQty = record ? record.remainingQty : 0;
        const soldQty = totalSent - remainingQty;

        const tr = document.createElement('tr');
        tr.dataset.productId = product.id;

        // Product Name Cell
        const tdName = document.createElement('td');
        tdName.className = 'td-item';
        tdName.textContent = product.name;
        tr.appendChild(tdName);

        // Price Cell
        const tdPrice = document.createElement('td');
        tdPrice.className = 'price-value';
        tdPrice.textContent = product.price ? `Rs.${Number(product.price).toFixed(2)}` : '-';
        tr.appendChild(tdPrice);

        // Batch Input Cells
        for (let i = 0; i < NUM_BATCHES; i++) {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'batch-input';
            input.min = '0';
            input.value = batches[i] || '';
            input.placeholder = '0';
            input.dataset.productId = product.id;
            input.dataset.batchIndex = i;
            if (editable) {
                input.addEventListener('input', handleBatchInput);
                input.addEventListener('focus', function () { this.select(); });
            } else {
                input.disabled = true;
                input.classList.add('readonly');
            }
            td.appendChild(input);
            tr.appendChild(td);
        }

        // Total Sent Cell
        const tdTotal = document.createElement('td');
        tdTotal.className = 'total-sent-value';
        tdTotal.id = `total-${product.id}`;
        tdTotal.textContent = totalSent;
        tr.appendChild(tdTotal);

        // Remaining Input Cell
        const tdRemaining = document.createElement('td');
        const remainingInput = document.createElement('input');
        remainingInput.type = 'number';
        remainingInput.className = 'remaining-input';
        remainingInput.min = '0';
        remainingInput.value = remainingQty || '';
        remainingInput.placeholder = '0';
        remainingInput.dataset.productId = product.id;
        if (editable) {
            remainingInput.addEventListener('input', handleRemainingInput);
            remainingInput.addEventListener('focus', function () { this.select(); });
        } else {
            remainingInput.disabled = true;
            remainingInput.classList.add('readonly');
        }
        tdRemaining.appendChild(remainingInput);
        tdRemaining.appendChild(remainingInput);
        tr.appendChild(tdRemaining);

        // Stock Value Cell (New)
        const stockValue = remainingQty * (product.price || 0);
        const tdStockValue = document.createElement('td');
        tdStockValue.className = `stock-value ${stockValue === 0 ? 'zero' : ''}`;
        tdStockValue.id = `stock-value-${product.id}`;
        tdStockValue.textContent = stockValue > 0 ? `Rs.${stockValue.toFixed(2)}` : '-';
        tr.appendChild(tdStockValue);

        // Sold Cell
        const tdSold = document.createElement('td');
        tdSold.className = `sold-value ${soldQty === 0 ? 'zero' : ''}`;
        tdSold.id = `sold-${product.id}`;
        tdSold.textContent = soldQty;
        tr.appendChild(tdSold);

        // Revenue Cell
        const revenue = soldQty * (product.price || 0);
        const tdRevenue = document.createElement('td');
        tdRevenue.className = `revenue-value ${revenue === 0 ? 'zero' : ''}`;
        tdRevenue.id = `revenue-${product.id}`;
        tdRevenue.textContent = revenue > 0 ? `Rs.${revenue.toFixed(2)}` : '-';
        tr.appendChild(tdRevenue);

        // Mark read-only rows visually
        if (!editable) {
            tr.classList.add('readonly-row');
        }

        inventoryBody.appendChild(tr);
    });

    updateStats();
}

// ---- Event Handlers ----

function handleBatchInput(e) {
    const input = e.target;
    let value = parseInt(input.value) || 0;

    // No negative numbers
    if (value < 0) {
        value = 0;
        input.value = 0;
    }

    const productId = input.dataset.productId;
    recalculateRow(productId);
    autoSaveRow(productId);
}

function handleRemainingInput(e) {
    const input = e.target;
    let value = parseInt(input.value) || 0;

    // No negative numbers
    if (value < 0) {
        value = 0;
        input.value = 0;
    }

    const productId = input.dataset.productId;
    recalculateRow(productId);
    autoSaveRow(productId);
}

function getRowBatches(productId) {
    const inputs = document.querySelectorAll(`input.batch-input[data-product-id="${productId}"]`);
    const batches = [];
    inputs.forEach(input => {
        batches.push(parseInt(input.value) || 0);
    });
    return batches;
}

function getRowTotalSent(productId) {
    const batches = getRowBatches(productId);
    return batches.reduce((sum, val) => sum + val, 0);
}

function getRowRemaining(productId) {
    const input = document.querySelector(`input.remaining-input[data-product-id="${productId}"]`);
    return parseInt(input.value) || 0;
}

function recalculateRow(productId) {
    const totalSent = getRowTotalSent(productId);
    const remaining = getRowRemaining(productId);
    const sold = Math.max(0, totalSent - remaining);

    // Update stock value
    const product = products.find(p => p.id === productId);
    const price = product ? (product.price || 0) : 0;

    const stockValue = remaining * price;
    const stockValueEl = document.getElementById(`stock-value-${productId}`);
    if (stockValueEl) {
        stockValueEl.textContent = stockValue > 0 ? `Rs.${stockValue.toFixed(2)}` : '-';
        stockValueEl.className = `stock-value ${stockValue === 0 ? 'zero' : ''}`;
    }

    const totalEl = document.getElementById(`total-${productId}`);
    const soldEl = document.getElementById(`sold-${productId}`);

    if (totalEl) totalEl.textContent = totalSent;
    if (soldEl) {
        soldEl.textContent = sold;
        soldEl.className = `sold-value ${sold === 0 ? 'zero' : ''}`;
    }

    // Update revenue
    const revenue = sold * price;
    const revenueEl = document.getElementById(`revenue-${productId}`);
    if (revenueEl) {
        revenueEl.textContent = revenue > 0 ? `Rs.${revenue.toFixed(2)}` : '-';
        revenueEl.className = `revenue-value ${revenue === 0 ? 'zero' : ''}`;
    }

    // Re-validate and clamp remaining
    const remainingInput = document.querySelector(`input.remaining-input[data-product-id="${productId}"]`);
    if (remaining > totalSent) {
        remainingInput.value = totalSent;
        remainingInput.classList.add('error');
        showToast('Remaining quantity adjusted to limit', 'warning');

        // Recalculate sold with clamped value
        const newSold = Math.max(0, totalSent - totalSent);
        if (soldEl) {
            soldEl.textContent = newSold;
            soldEl.className = `sold-value ${newSold === 0 ? 'zero' : ''}`;
        }

        // Recalculate revenue with clamped value
        const newRevenue = newSold * price;
        if (revenueEl) {
            revenueEl.textContent = newRevenue > 0 ? `Rs.${newRevenue.toFixed(2)}` : '-';
            revenueEl.className = `revenue-value ${newRevenue === 0 ? 'zero' : ''}`;
        }

        // Remove error class after a bit
        setTimeout(() => remainingInput.classList.remove('error'), 1000);
    } else {
        remainingInput.classList.remove('error');
    }

    // Recalculate Stock Value again if clamped
    const finalRemaining = getRowRemaining(productId);
    const finalStockValue = finalRemaining * price;
    if (stockValueEl) {
        stockValueEl.textContent = finalStockValue > 0 ? `Rs.${finalStockValue.toFixed(2)}` : '-';
        stockValueEl.className = `stock-value ${finalStockValue === 0 ? 'zero' : ''}`;
    }

    updateStats();
}

function updateStats() {
    let totalProducts = products.length;
    let totalSent = 0;
    let totalRemaining = 0;
    let totalSold = 0;
    let totalRevenue = 0;
    let totalRemainingValue = 0;

    products.forEach(product => {
        const sent = getRowTotalSent(product.id);
        const remaining = getRowRemaining(product.id);
        const sold = Math.max(0, sent - remaining);
        const price = product.price || 0;

        totalSent += sent;
        totalRemaining += remaining;
        totalSold += sold;
        totalRevenue += sold * price;
        totalRemainingValue += remaining * price;
    });

    animateValue(statTotalProducts, totalProducts);
    animateValue(statTotalSent, totalSent);
    animateValue(statTotalRemaining, totalRemaining);
    animateValue(statTotalSold, totalSold);
    animateValue(statTotalRevenue, Math.round(totalRevenue));
    if (statRemainingValue) animateValue(statRemainingValue, Math.round(totalRemainingValue));
}

function animateValue(element, target) {
    const current = parseInt(element.textContent) || 0;
    if (current === target) return;

    const diff = target - current;
    const duration = 300;
    const steps = 15;
    const stepValue = diff / steps;
    let step = 0;

    const interval = setInterval(() => {
        step++;
        if (step >= steps) {
            element.textContent = target;
            clearInterval(interval);
        } else {
            element.textContent = Math.round(current + stepValue * step);
        }
    }, duration / steps);
}



// ---- Product Modal ----

function openAddModal() {
    editingProductId = null;
    modalTitle.textContent = 'Add Product';
    productNameInput.value = '';
    productPriceInput.value = '';
    productModal.classList.add('active');
    setTimeout(() => productNameInput.focus(), 300);
}

function openEditModal(productId) {
    editingProductId = productId;
    const product = products.find(p => p.id === productId);
    if (!product) return;

    modalTitle.textContent = 'Edit Product';
    productNameInput.value = product.name;
    productPriceInput.value = product.price || '';
    productModal.classList.add('active');
    setTimeout(() => {
        productNameInput.focus();
        productNameInput.select();
    }, 300);
}

function closeProductModal() {
    productModal.classList.remove('active');
    editingProductId = null;
    productNameInput.value = '';
    productPriceInput.value = '';
}

async function handleSaveProduct() {
    const name = productNameInput.value.trim();

    if (!name) {
        showToast('Please enter a product name', 'error');
        productNameInput.focus();
        return;
    }

    // Check duplicate name
    const duplicate = products.find(p =>
        p.name.toLowerCase() === name.toLowerCase() && p.id !== editingProductId
    );
    if (duplicate) {
        showToast('A product with this name already exists', 'error');
        return;
    }

    const price = parseFloat(productPriceInput.value) || 0;

    if (price < 0) {
        showToast('Price cannot be negative', 'error');
        productPriceInput.focus();
        return;
    }

    modalSaveBtn.disabled = true;

    if (editingProductId) {
        // Edit existing
        await updateProduct(editingProductId, name, price);
    } else {
        // Add new
        await addProduct(name, price);
    }

    modalSaveBtn.disabled = false;
    closeProductModal();

    // Reload
    await loadProducts();
    await loadDailyRecords(currentDate);
    renderTable();
    if (manageProductsModal.classList.contains('active')) {
        renderProductList();
    }
}

// ---- Delete Modal ----

let deletingProductId = null;

function openDeleteModal(productId) {
    deletingProductId = productId;
    const product = products.find(p => p.id === productId);
    if (!product) return;

    deleteProductName.textContent = product.name;
    deleteModal.classList.add('active');
}

function closeDeleteModal() {
    deleteModal.classList.remove('active');
    deletingProductId = null;
}

async function handleDeleteProduct() {
    if (!deletingProductId) return;

    deleteConfirmBtn.disabled = true;

    await deleteProduct(deletingProductId);

    deleteConfirmBtn.disabled = false;
    closeDeleteModal();

    // Reload
    await loadProducts();
    await loadDailyRecords(currentDate);
    renderTable();
    if (manageProductsModal.classList.contains('active')) {
        renderProductList();
    }
}

// ---- Manage Products Modal ----

function openManageModal() {
    renderProductList();
    manageProductsModal.classList.add('active');
}

function closeManageModal() {
    manageProductsModal.classList.remove('active');
}

function renderProductList() {
    productListContainer.innerHTML = '';

    if (products.length === 0) {
        productListContainer.innerHTML = '<div class="empty-state visible" style="padding: 2rem;"><p>No products found.</p></div>';
        return;
    }

    products.forEach(product => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'product-list-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'product-list-name';
        nameSpan.textContent = product.name;

        const priceSpan = document.createElement('span');
        priceSpan.className = 'product-list-price';
        priceSpan.textContent = product.price ? `Rs.${Number(product.price).toFixed(2)}` : '-';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'product-list-actions';
        actionsDiv.innerHTML = `
            <button class="btn btn-icon btn-icon-edit" onclick="openEditModal('${product.id}')" title="Edit">✏️</button>
            <button class="btn btn-icon btn-icon-delete" onclick="openDeleteModal('${product.id}')" title="Delete">🗑️</button>
        `;

        itemDiv.appendChild(nameSpan);
        itemDiv.appendChild(priceSpan);
        itemDiv.appendChild(actionsDiv);

        productListContainer.appendChild(itemDiv);
    });
}

// ---- Date Change ----

async function handleDateChange() {
    const newDate = dateInput.value;
    if (!newDate) return;

    currentDate = newDate;
    showLoading();

    await loadDailyRecords(currentDate);
    renderTable();

    hideLoading();
}

// ---- PDF Report Generation ----

// Helper to load font as base64
// Helper to load font as base64 with caching
async function loadFont(url) {
    // Check cache first
    const cacheKey = 'cachedSinhalaFont_v1';
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    // Fetch if not cached
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch font: ${response.statusText}`);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            try {
                localStorage.setItem(cacheKey, base64);
            } catch (e) {
                console.warn('Failed to cache font:', e);
            }
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function generateDailyReport() {
    if (!products.length) {
        showToast('No data to generate report', 'error');
        return;
    }

    const toastId = showToast('Generating PDF... ⏳', 'info');

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        let effectiveFont = 'helvetica';

        // Load Sinhala Font
        try {
            const fontUrl = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansSinhala/NotoSansSinhala-Regular.ttf';
            const fontBase64 = await loadFont(fontUrl);

            doc.addFileToVFS("NotoSansSinhala-Regular.ttf", fontBase64);
            doc.addFont("NotoSansSinhala-Regular.ttf", "NotoSansSinhala", "normal");
            effectiveFont = "NotoSansSinhala";
        } catch (fontError) {
            console.error("Font loading failed:", fontError);
            showToast('Warning: Sinhala font failed to load. Using default font.', 'warning');
        }

        doc.setFont("helvetica");

        // Header
        doc.setFontSize(22);
        doc.setTextColor(41, 128, 185);
        doc.text("Bakery Polina", 14, 20);

        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text("Daily Inventory Report", 14, 30);

        doc.setFontSize(10);
        doc.text(`Date: ${currentDate}`, 14, 38);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 43);

        // Table Data Preparation
        const tableBody = products.map(product => {
            const record = dailyRecords[product.id] || null;
            const batches = record ? record.batches : new Array(NUM_BATCHES).fill(0);
            const totalSent = batches.reduce((a, b) => a + b, 0);
            const remaining = record ? record.remainingQty : 0;
            const sold = totalSent - remaining;
            const revenue = sold * (product.price || 0);

            return [
                product.name,
                (product.price || 0).toFixed(2),
                ...batches,
                totalSent,
                remaining,
                sold,
                revenue.toFixed(2)
            ];
        });

        // Totals Calculation
        let totalSent = 0;
        let totalRemaining = 0;
        let totalSold = 0;
        let totalRevenue = 0;

        products.forEach(product => {
            const record = dailyRecords[product.id];
            if (record) {
                const sent = record.batches.reduce((a, b) => a + b, 0);
                totalSent += sent;
                totalRemaining += record.remainingQty;
                const sold = sent - record.remainingQty;
                totalSold += sold;
                totalRevenue += sold * (product.price || 0);
            }
        });

        // Table Generation
        doc.autoTable({
            startY: 50,
            head: [['Item', 'Price', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'Sent', 'Rem', 'Sold', 'Rev']],
            body: tableBody,
            theme: 'grid',
            styles: {
                font: 'helvetica', // Default to helvetica for numbers/English
                fontStyle: 'normal',
                fontSize: 8,
                cellPadding: 2
            },
            bodyStyles: {
                font: effectiveFont // Use Sinhala font for the body content
            },
            headStyles: {
                fillColor: [41, 128, 185],
                textColor: 255,
                halign: 'center',
                font: 'helvetica' // Headers are English
            },
            columnStyles: {
                0: { cellWidth: 30, halign: 'left' }, // Item
                1: { halign: 'right' }, // Price
                2: { halign: 'center' }, // B1
                3: { halign: 'center' }, // B2
                4: { halign: 'center' }, // B3
                5: { halign: 'center' }, // B4
                6: { halign: 'center' }, // B5
                7: { halign: 'center' }, // B6
                8: { halign: 'center', fontStyle: 'bold' }, // Sent
                9: { halign: 'center', textColor: [192, 57, 43] }, // Rem
                10: { halign: 'center', textColor: [39, 174, 96], fontStyle: 'bold' }, // Sold
                11: { halign: 'right', fontStyle: 'bold' } // Rev
            },
            foot: [[
                'TOTALS', '', '', '', '', '', '', '',
                totalSent, totalRemaining, totalSold, totalRevenue.toFixed(2)
            ]],
            footStyles: {
                fillColor: [241, 245, 249],
                textColor: 50,
                fontStyle: 'bold',
                halign: 'center',
                font: 'helvetica' // Footer totals are numbers/English
            }
        });

        // Summary Section
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(14);
        doc.setTextColor(41, 128, 185);
        doc.text("Summary", 14, finalY);

        doc.setFontSize(10);
        doc.setTextColor(50);
        doc.text(`Total Revenue: Rs. ${totalRevenue.toFixed(2)}`, 14, finalY + 8);
        doc.text(`Total Items Sold: ${totalSold}`, 14, finalY + 13);
        doc.text(`Total Unsold Items: ${totalRemaining}`, 14, finalY + 18);

        // Save
        doc.save(`bakery_report_${currentDate}.pdf`);
        showToast('Report generated successfully! 📄', 'success');

    } catch (error) {
        console.error("PDF Generation Error:", error);
        showToast(`Failed to generate report: ${error.message}`, 'error');
    }
}

// ---- Event Bindings ----

addProductBtn.addEventListener('click', openAddModal);
manageProductsBtn.addEventListener('click', openManageModal);
dailyReportBtn.addEventListener('click', generateDailyReport);

// Product Modal
modalCloseBtn.addEventListener('click', closeProductModal);
modalCancelBtn.addEventListener('click', closeProductModal);
modalSaveBtn.addEventListener('click', handleSaveProduct);
productNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSaveProduct();
});

// Delete Modal
deleteModalCloseBtn.addEventListener('click', closeDeleteModal);
deleteCancelBtn.addEventListener('click', closeDeleteModal);
deleteConfirmBtn.addEventListener('click', handleDeleteProduct);

// Date Change
dateInput.addEventListener('change', handleDateChange);

// Close modals on overlay click
productModal.addEventListener('click', (e) => {
    if (e.target === productModal) closeProductModal();
});
manageProductsModal.addEventListener('click', (e) => {
    if (e.target === manageProductsModal) closeManageModal();
});
manageModalCloseBtn.addEventListener('click', closeManageModal);
manageModalDoneBtn.addEventListener('click', closeManageModal);
deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
});

// Keyboard: ESC to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeProductModal();
        closeDeleteModal();
        closeManageModal();
    }
});

// ---- Initialization ----

async function init() {
    try {
        // Set today's date
        const today = formatDate(new Date());
        dateInput.value = today;
        currentDate = today;

        // Set date picker limits (90 days back, 1 day forward)
        const limits = getDateLimits();
        dateInput.min = limits.min;
        dateInput.max = limits.max;

        // Load data
        await loadProducts();
        await loadDailyRecords(currentDate);

        // Render
        renderTable();

        // Hide loading
        hideLoading();
    } catch (error) {
        console.error('Initialization error:', error);
        hideLoading();
        showToast('Failed to initialize app. Please refresh the page.', 'error');
    }
}

// Mobile & Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Prevent double-tap zoom
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            button.click();
        });
    });

    // Initialize App
    init();
});

