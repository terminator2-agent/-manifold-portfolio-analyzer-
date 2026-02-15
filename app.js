/**
 * Main application logic for Manifold Portfolio Analyzer
 */

// DOM Elements
const usernameInput = document.getElementById('username');
const analyzeBtn = document.getElementById('analyze-btn');
const loadingDiv = document.getElementById('loading');
const loadingDetail = document.getElementById('loading-detail');
const errorDiv = document.getElementById('error');
const resultsDiv = document.getElementById('results');
const positionsBody = document.getElementById('positions-body');

// Store positions for sorting
let currentPositions = [];
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Allow Enter key to trigger analysis
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        analyzePortfolio();
    }
});

// Check URL parameters for username
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const username = params.get('user') || params.get('username');
    if (username) {
        usernameInput.value = username;
        analyzePortfolio();
    }
});

/**
 * Main analysis function
 */
async function analyzePortfolio() {
    let username = usernameInput.value.trim();
    
    // Extract username if user pasted a full URL
    if (username.includes('manifold.markets/')) {
        username = username.split('manifold.markets/')[1].split('/')[0].split('?')[0];
        usernameInput.value = username;
    }
    
    if (!username) {
        showError('Please enter a username');
        return;
    }
    
    // Update URL for sharing
    const newUrl = `${window.location.pathname}?user=${encodeURIComponent(username)}`;
    window.history.pushState({}, '', newUrl);
    
    // Reset UI
    hideError();
    hideResults();
    showLoading();
    setButtonLoading(true);
    
    try {
        // Step 1: Get user ID
        updateLoadingDetail('Looking up user...');
        const userId = await ManifoldAPI.getUserId(username);
        
        // Step 2: Fetch positions
        updateLoadingDetail('Fetching positions...');
        const rawData = await ManifoldAPI.getUserPositions(userId, updateLoadingDetail);
        
        // Step 3: Process positions
        updateLoadingDetail('Analyzing positions...');
        const allPositions = ManifoldAPI.processPositions(rawData);
        
        // Step 4: Get all positions sorted (below margin first)
        const allPositionsSorted = ManifoldAPI.getAllPositionsSorted(allPositions);
        const belowMarginCount = allPositionsSorted.filter(p => p.returnIfCorrect < ManifoldAPI.MARGIN_RATE_ANNUAL).length;
        
        // Display results
        hideLoading();
        displayResults(allPositionsSorted, allPositions.length, belowMarginCount);
        
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonLoading(false);
    }
}

/**
 * Display the results table
 */
function displayResults(positions, totalPositions, belowMarginCount) {
    // Store positions for sorting
    currentPositions = positions;
    
    // Update summary
    document.getElementById('summary-text').textContent = 
        `Showing ${positions.length} positions. ${belowMarginCount} with return below margin rate.`;
    
    // Update stats (only for below-margin positions)
    const belowMarginPositions = positions.filter(p => p.returnIfCorrect < ManifoldAPI.MARGIN_RATE_ANNUAL);
    const totalSaleValue = belowMarginPositions.reduce((sum, p) => sum + p.saleValue, 0);
    const totalPayout = belowMarginPositions.reduce((sum, p) => sum + p.shares, 0);
    
    document.getElementById('stat-positions').textContent = belowMarginCount;
    document.getElementById('stat-recoverable').textContent = `M$${Math.round(totalSaleValue).toLocaleString()}`;
    document.getElementById('stat-payout').textContent = `M$${Math.round(totalPayout).toLocaleString()}`;
    
    // Setup sort handlers (only once)
    setupSortHandlers();
    
    // Build table rows
    renderTableRows(positions);
    
    showResults();
}

/**
 * Setup click handlers for sortable columns
 */
function setupSortHandlers() {
    const headers = document.querySelectorAll('th.sortable');
    headers.forEach(header => {
        // Remove existing listener by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        
        newHeader.addEventListener('click', () => {
            const sortKey = newHeader.dataset.sort;
            
            // Toggle direction if same column, otherwise default to ascending
            if (currentSortColumn === sortKey) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = sortKey;
                currentSortDirection = 'asc';
            }
            
            // Update header styles
            document.querySelectorAll('th.sortable').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
            });
            newHeader.classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            
            // Sort and re-render
            const sorted = sortPositions(currentPositions, sortKey, currentSortDirection);
            renderTableRows(sorted);
        });
    });
}

/**
 * Sort positions by a given key
 */
function sortPositions(positions, key, direction) {
    const sorted = [...positions].sort((a, b) => {
        let aVal, bVal;

        if (key === 'question') {
            aVal = a.question.toLowerCase();
            bVal = b.question.toLowerCase();
        } else if (key === 'payout') {
            aVal = a.shares;
            bVal = b.shares;
        } else if (key === 'partialSell') {
            // Sort by percent to sell (positions with partial sell recommendations first)
            aVal = a.partialSell ? a.partialSell.percentToSell : 0;
            bVal = b.partialSell ? b.partialSell.percentToSell : 0;
        } else {
            aVal = a[key];
            bVal = b[key];
        }
        
        // Handle null/undefined
        if (aVal == null) aVal = 0;
        if (bVal == null) bVal = 0;
        
        if (typeof aVal === 'string') {
            return direction === 'asc' 
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        }
        
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    return sorted;
}

/**
 * Render table rows from positions array
 */
function renderTableRows(positions) {
    positionsBody.innerHTML = '';
    
    positions.forEach((position, index) => {
        const row = document.createElement('tr');
        
        // Truncate question
        let question = position.question;
        if (question.length > 70) {
            question = question.substring(0, 70) + '...';
        }
        
        // Answer text
        let answerHtml = '';
        if (position.answer) {
            let answerText = position.answer;
            if (answerText.length > 50) {
                answerText = answerText.substring(0, 50) + '...';
            }
            answerHtml = `<span class="answer-text">↳ ${escapeHtml(answerText)}</span>`;
        }
        
        // Position badge
        const positionClass = position.outcome === 'YES' ? 'position-yes' : 'position-no';
        
        // Return styling
        const returnPercent = (position.returnIfCorrect * 100).toFixed(3);
        let returnClass = '';
        if (position.returnIfCorrect >= ManifoldAPI.MARGIN_RATE_ANNUAL) {
            returnClass = 'return-good';
        } else if (position.returnIfCorrect < 0.05) {
            returnClass = 'return-very-low';
        } else {
            returnClass = 'return-low';
        }
        
        // Partial sell recommendation
        let partialSellHtml = '<span class="partial-none">—</span>';
        if (position.partialSell) {
            const ps = position.partialSell;
            const targetPct = (ps.targetReturn * 100).toFixed(1);
            partialSellHtml = `
                <span class="partial-recommend" title="Sell ${ps.percentToSell}% to bring remaining return to ${targetPct}%">
                    Sell ${ps.recommendedSellShares} shares (${ps.percentToSell}%)
                    <span class="partial-detail">→ M$${ps.recommendedSaleValue.toFixed(0)} proceeds (${(ps.sellSlippage * 100).toFixed(1)}% slippage)</span>
                    <span class="partial-remaining">Keep ${ps.remainingShares} shares → ${(ps.remainingReturn * 100).toFixed(1)}% return</span>
                </span>`;
        }

        row.innerHTML = `
            <td class="hide-cell"><button class="hide-btn" onclick="hideRow(this)" title="Hide this row">×</button></td>
            <td>${index + 1}</td>
            <td>
                <a href="${escapeHtml(position.url)}" target="_blank" class="market-link">
                    ${escapeHtml(question)}
                </a>
                ${answerHtml}
            </td>
            <td>
                <span class="position-badge ${positionClass}">
                    ${position.shares.toFixed(1)} ${position.outcome}
                </span>
            </td>
            <td class="right">M$${position.saleValue.toFixed(2)}</td>
            <td class="right">M$${position.shares.toFixed(2)}</td>
            <td class="right">${Math.round(position.daysUntilClose || 0)}</td>
            <td class="right ${returnClass}">${returnPercent}%</td>
            <td class="right">${partialSellHtml}</td>
        `;
        
        positionsBody.appendChild(row);
    });
}

// UI Helper functions
function showLoading() {
    loadingDiv.classList.remove('hidden');
}

function hideLoading() {
    loadingDiv.classList.add('hidden');
}

function updateLoadingDetail(text) {
    loadingDetail.textContent = text;
}

function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    errorDiv.classList.add('hidden');
}

function showResults() {
    resultsDiv.classList.remove('hidden');
}

function hideResults() {
    resultsDiv.classList.add('hidden');
}

function setButtonLoading(isLoading) {
    analyzeBtn.disabled = isLoading;
    analyzeBtn.textContent = isLoading ? 'Loading...' : 'Analyze';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function hideRow(button) {
    const row = button.closest('tr');
    row.classList.add('hidden-row');
    updateHiddenCount();
}

function showAllRows() {
    document.querySelectorAll('.hidden-row').forEach(row => {
        row.classList.remove('hidden-row');
    });
    updateHiddenCount();
}

function updateHiddenCount() {
    const hiddenCount = document.querySelectorAll('.hidden-row').length;
    let showAllBtn = document.getElementById('show-all-btn');
    
    if (hiddenCount > 0) {
        if (!showAllBtn) {
            showAllBtn = document.createElement('button');
            showAllBtn.id = 'show-all-btn';
            showAllBtn.className = 'show-all-btn';
            showAllBtn.onclick = showAllRows;
            document.querySelector('.summary').appendChild(showAllBtn);
        }
        showAllBtn.textContent = `Show ${hiddenCount} hidden row${hiddenCount > 1 ? 's' : ''}`;
        showAllBtn.classList.remove('hidden');
    } else if (showAllBtn) {
        showAllBtn.classList.add('hidden');
    }
}
