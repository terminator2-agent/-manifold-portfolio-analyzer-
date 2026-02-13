/**
 * Manifold Markets API wrapper and calculation functions
 * Ported from Python to JavaScript
 */

const API_BASE_URL = 'https://api.manifold.markets/v0';
const MARGIN_RATE_DAILY = 0.0003;  // 0.03% per day
const MARGIN_RATE_ANNUAL = MARGIN_RATE_DAILY * 365;  // ~10.95% annually

/**
 * Get user ID from username
 */
async function getUserId(username) {
    const response = await fetch(`${API_BASE_URL}/user/${username}`);
    
    if (!response.ok) {
        throw new Error(`User "${username}" not found`);
    }
    
    const userData = await response.json();
    return userData.id;
}

/**
 * Get all positions for a user with their market data
 */
async function getUserPositions(userId, onProgress) {
    const url = `${API_BASE_URL}/get-user-contract-metrics-with-contracts`;
    const allMetrics = {};
    const allContracts = [];
    let offset = 0;
    const limit = 100;
    
    while (true) {
        const params = new URLSearchParams({
            userId: userId,
            limit: limit,
            offset: offset,
            perAnswer: 'true'
        });
        
        const response = await fetch(`${url}?${params}`);
        
        if (!response.ok) {
            throw new Error(`Error fetching positions: ${response.status}`);
        }
        
        const data = await response.json();
        const metricsByContract = data.metricsByContract || {};
        const contracts = data.contracts || [];
        
        if (contracts.length === 0) {
            break;
        }
        
        // Merge results
        Object.assign(allMetrics, metricsByContract);
        allContracts.push(...contracts);
        
        if (onProgress) {
            onProgress(`Fetched ${allContracts.length} markets...`);
        }
        
        if (contracts.length < limit) {
            break;
        }
        
        offset += limit;
    }
    
    return {
        metricsByContract: allMetrics,
        contracts: allContracts
    };
}

/**
 * Calculate CPMM shares when buying
 */
function calculateCpmmShares(pool, p, betAmount, outcome) {
    if (betAmount === 0) return 0;
    
    const y = pool.YES || 0;
    const n = pool.NO || 0;
    const k = Math.pow(y, p) * Math.pow(n, 1 - p);
    
    if (outcome === 'YES') {
        return y + betAmount - Math.pow(k * Math.pow(betAmount + n, p - 1), 1 / p);
    } else {
        return n + betAmount - Math.pow(k * Math.pow(betAmount + y, -p), 1 / (1 - p));
    }
}

/**
 * Calculate amount needed to buy a specific number of shares
 * Uses binary search
 */
function calculateAmountToBuyShares(pool, p, shares, outcome) {
    if (shares <= 0) return 0;
    
    const y = pool.YES || 0;
    const n = pool.NO || 0;
    const prob = (y + n) > 0 ? n / (y + n) : 0.5;
    
    let minAmount = outcome === 'YES' ? shares * prob : shares * (1 - prob);
    let maxAmount = shares;
    let mid = 0;
    
    // Binary search
    for (let i = 0; i < 50; i++) {
        mid = (minAmount + maxAmount) / 2;
        const sharesReceived = calculateCpmmShares(pool, p, mid, outcome);
        
        if (Math.abs(sharesReceived - shares) < 0.0001) {
            return mid;
        } else if (sharesReceived < shares) {
            minAmount = mid;
        } else {
            maxAmount = mid;
        }
    }
    
    return mid;
}

/**
 * Calculate sale value using the correct AMM mechanism:
 * To sell YES shares: buy NO shares, then redeem YES+NO pairs
 */
function calculateSaleValue(shares, outcome, pool, p, mechanism) {
    if (!['cpmm-1', 'cpmm-multi-1'].includes(mechanism)) {
        return 0;
    }
    
    const y = pool.YES || 0;
    const n = pool.NO || 0;
    
    if (y <= 0 || n <= 0) return 0;
    
    // To sell: buy opposite shares, then redeem pairs
    const oppositeOutcome = outcome === 'YES' ? 'NO' : 'YES';
    const buyAmount = calculateAmountToBuyShares(pool, p, shares, oppositeOutcome);
    
    // Sale value = shares redeemed - cost to buy opposite
    return Math.max(0, shares - buyAmount);
}

/**
 * Calculate simple/fair sale value (no slippage)
 */
function calculateSimpleSaleValue(shares, probability, outcome) {
    if (outcome === 'YES') {
        return shares * probability;
    } else if (outcome === 'NO') {
        return shares * (1 - probability);
    }
    return 0;
}

/**
 * Calculate annualized return IF the position wins
 */
function calculateReturnIfCorrect(saleValue, shares, closeTime, currentTime) {
    if (!closeTime) return null;
    
    const daysUntilClose = (closeTime - currentTime) / (1000 * 60 * 60 * 24);
    
    if (daysUntilClose <= 0 || saleValue <= 0) return null;
    
    const profitIfCorrect = shares - saleValue;
    const effectiveDays = Math.max(daysUntilClose, 1);
    
    return (profitIfCorrect / saleValue) * (365 / effectiveDays);
}

/**
 * Process raw API data into analyzed positions
 */
function processPositions(rawData) {
    const contracts = rawData.contracts || [];
    const metricsByContract = rawData.metricsByContract || {};
    
    // Create lookup
    const contractsLookup = {};
    contracts.forEach(c => contractsLookup[c.id] = c);
    
    const currentTime = Date.now();
    const positions = [];
    
    for (const [contractId, metricsList] of Object.entries(metricsByContract)) {
        const contract = contractsLookup[contractId];
        if (!contract) continue;
        
        // Skip resolved markets
        if (contract.isResolved) continue;
        
        const mechanism = contract.mechanism || '';
        if (!['cpmm-1', 'cpmm-multi-1'].includes(mechanism)) continue;
        
        for (const metrics of metricsList) {
            const totalShares = metrics.totalShares || {};
            const yesShares = totalShares.YES || 0;
            const noShares = totalShares.NO || 0;
            
            if (yesShares <= 0 && noShares <= 0) continue;
            
            // Get dominant position
            const outcome = yesShares > noShares ? 'YES' : 'NO';
            const shares = yesShares > noShares ? yesShares : noShares;
            
            if (shares < 0.01) continue;
            
            // Get market data
            const closeTime = contract.closeTime;
            const question = contract.question || 'Unknown';
            const slug = contract.slug || '';
            const creatorUsername = contract.creatorUsername || '';
            const url = slug ? `https://manifold.markets/${creatorUsername}/${slug}` : '';
            const p = contract.p || 0.5;
            
            let probability = null;
            let pool = {};
            const answerId = metrics.answerId;
            let answerText = null;
            
            if (mechanism === 'cpmm-1') {
                probability = contract.prob;
                pool = contract.pool || {};
            } else if (mechanism === 'cpmm-multi-1' && answerId) {
                const answers = contract.answers || [];
                for (const ans of answers) {
                    if (ans.id === answerId) {
                        // Skip resolved answers
                        if (ans.resolution !== undefined && ans.resolution !== null) {
                            break;
                        }
                        probability = ans.prob;
                        answerText = ans.text || '';
                        pool = {
                            YES: ans.poolYes || 0,
                            NO: ans.poolNo || 0
                        };
                        break;
                    }
                }
            }
            
            // Fallback probability from pool
            if (probability === null) {
                const yesPool = pool.YES || 0;
                const noPool = pool.NO || 0;
                if (yesPool > 0 && noPool > 0) {
                    probability = noPool / (yesPool + noPool);
                } else {
                    continue;
                }
            }
            
            // Calculate values
            let ammSaleValue = 0;
            if (pool.YES > 0 && pool.NO > 0) {
                ammSaleValue = calculateSaleValue(shares, outcome, pool, p, mechanism);
            }
            
            const fairValue = calculateSimpleSaleValue(shares, probability, outcome);
            const saleValue = ammSaleValue > 0 ? ammSaleValue : fairValue;
            
            // Calculate slippage
            let slippage = 0;
            if (fairValue > 0 && ammSaleValue > 0) {
                slippage = (fairValue - ammSaleValue) / fairValue;
            }
            
            // Calculate return if correct
            const returnIfCorrect = calculateReturnIfCorrect(saleValue, shares, closeTime, currentTime);
            
            // Days until close
            let daysUntilClose = null;
            if (closeTime) {
                daysUntilClose = (closeTime - currentTime) / (1000 * 60 * 60 * 24);
            }
            
            // Calculate partial sell recommendation
            const partialSell = calculatePartialSellRecommendation(
                shares, outcome, pool, p, mechanism
            );

            positions.push({
                contractId,
                question,
                answer: answerText,
                url,
                outcome,
                shares,
                saleValue,
                fairValue,
                slippage,
                probability,
                daysUntilClose,
                returnIfCorrect,
                partialSell
            });
        }
    }
    
    return positions;
}

/**
 * Calculate the optimal partial sell for a position.
 * When selling the full position causes high slippage, find the amount where
 * selling gives the best value-per-share (marginal return drops below threshold).
 * Returns { recommendedSellShares, recommendedSaleValue, partialSlippage, fullSlippage }
 * or null if full sell is fine (slippage < 5%).
 */
function calculatePartialSellRecommendation(shares, outcome, pool, p, mechanism) {
    if (!['cpmm-1', 'cpmm-multi-1'].includes(mechanism)) return null;
    if (!pool || pool.YES <= 0 || pool.NO <= 0) return null;
    if (shares < 1) return null;

    const fullSaleValue = calculateSaleValue(shares, outcome, pool, p, mechanism);
    const fairValue = calculateSimpleSaleValue(shares,
        pool.NO / (pool.YES + pool.NO), outcome);

    if (fairValue <= 0) return null;

    const fullSlippage = (fairValue - fullSaleValue) / fairValue;

    // Only recommend partial sell if full-sell slippage exceeds 5%
    if (fullSlippage < 0.05) return null;

    // Binary search for the sell amount where marginal slippage hits 5%
    // We want the largest amount we can sell with average slippage <= 5%
    const SLIPPAGE_TARGET = 0.05;
    let lo = 0;
    let hi = shares;
    let bestShares = 0;
    let bestValue = 0;

    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const saleVal = calculateSaleValue(mid, outcome, pool, p, mechanism);
        const fairVal = calculateSimpleSaleValue(mid,
            pool.NO / (pool.YES + pool.NO), outcome);

        if (fairVal <= 0) { lo = mid; continue; }

        const slip = (fairVal - saleVal) / fairVal;

        if (slip <= SLIPPAGE_TARGET) {
            bestShares = mid;
            bestValue = saleVal;
            lo = mid;
        } else {
            hi = mid;
        }
    }

    if (bestShares < 1) return null;

    const partialFairValue = calculateSimpleSaleValue(bestShares,
        pool.NO / (pool.YES + pool.NO), outcome);
    const partialSlippage = partialFairValue > 0
        ? (partialFairValue - bestValue) / partialFairValue : 0;

    return {
        recommendedSellShares: Math.round(bestShares * 10) / 10,
        recommendedSaleValue: Math.round(bestValue * 100) / 100,
        partialSlippage: Math.round(partialSlippage * 10000) / 10000,
        fullSlippage: Math.round(fullSlippage * 10000) / 10000,
        percentOfPosition: Math.round((bestShares / shares) * 100)
    };
}

/**
 * Filter positions below margin rate and sort
 */
function getPositionsBelowMarginRate(positions) {
    return positions
        .filter(p => p.returnIfCorrect !== null && p.returnIfCorrect < MARGIN_RATE_ANNUAL)
        .sort((a, b) => (a.returnIfCorrect || 0) - (b.returnIfCorrect || 0));
}

/**
 * Get all positions sorted: below margin first (ascending), then above margin (descending)
 */
function getAllPositionsSorted(positions) {
    const withReturns = positions.filter(p => p.returnIfCorrect !== null);
    
    // Split into below and above margin rate
    const belowMargin = withReturns.filter(p => p.returnIfCorrect < MARGIN_RATE_ANNUAL);
    const aboveMargin = withReturns.filter(p => p.returnIfCorrect >= MARGIN_RATE_ANNUAL);
    
    // Sort below by return ascending (worst first)
    belowMargin.sort((a, b) => (a.returnIfCorrect || 0) - (b.returnIfCorrect || 0));
    
    // Sort above by return descending (best first)
    aboveMargin.sort((a, b) => (b.returnIfCorrect || 0) - (a.returnIfCorrect || 0));
    
    // Combine: below margin first, then above margin
    return [...belowMargin, ...aboveMargin];
}

// Export for use in app.js
window.ManifoldAPI = {
    getUserId,
    getUserPositions,
    processPositions,
    getPositionsBelowMarginRate,
    getAllPositionsSorted,
    calculatePartialSellRecommendation,
    MARGIN_RATE_ANNUAL,
    MARGIN_RATE_DAILY
};
